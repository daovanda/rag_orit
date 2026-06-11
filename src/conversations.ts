import { CORS, MAX_HISTORY_CONTENT_CHARS, MAX_HISTORY_MESSAGES, type Env } from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { runAgenticLoop } from "./agent";
import { loadZilcodeSessionFromRequestHeaders, type ZilcodeSessionState } from "./zilcode";
import type { AgentActionState, AIMessage, ChatHistoryMessage, RagSource } from "./types";

const CONVERSATION_PREFIX = "conversation:";
const MAX_STORED_MESSAGES = 200;
const MAX_ACTION_LOGS = 100;

interface StoredMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  tools_called?: string[];
  sources?: RagSource[];
  debug_steps?: DebugStep[];
  action_state?: AgentActionState;
}

interface ActionLogEntry {
  action_id: string;
  created_at: string;
  message_id?: string;
  action_state: AgentActionState;
}

interface ConversationRecord {
  conversation_id: string;
  userid: string;
  sitecode: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: StoredMessage[];
  pending_action?: AgentActionState;
  action_logs: ActionLogEntry[];
}

interface ConversationOwner {
  userid: string;
  sitecode: string;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers ?? {})
    }
  });
}

async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as T
      : {} as T;
  } catch {
    return {} as T;
  }
}

function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.@-]/g, "_") || "unknown";
}

function getOwnerFromSession(state: ZilcodeSessionState | null): ConversationOwner | null {
  if (!state) return null;
  const user = state.session.user ?? {};
  const userid = String(user.userid ?? user.user_id ?? "").trim();
  const sitecode = String(user.sitecode ?? "").trim();
  if (!userid || !sitecode) return null;
  return { userid, sitecode };
}

function requireZilcodeContext(request: Request, env: Env): { state: ZilcodeSessionState; owner: ConversationOwner } | Response {
  const state = loadZilcodeSessionFromRequestHeaders(request, env);
  const owner = getOwnerFromSession(state);
  if (!state || !owner) {
    return jsonResponse({
      success: false,
      error: "Thiếu Zilcode token/context. Hãy gửi Authorization: Bearer <token>, X-Zilcode-UserId và X-Zilcode-SiteCode."
    }, { status: 401 });
  }
  return { state, owner };
}

function ownerPrefix(owner: ConversationOwner): string {
  return `${CONVERSATION_PREFIX}${sanitizeKeyPart(owner.sitecode)}:${sanitizeKeyPart(owner.userid)}:`;
}

function conversationKey(owner: ConversationOwner, conversationId: string): string {
  return `${ownerPrefix(owner)}${sanitizeKeyPart(conversationId)}`;
}

function summarizeConversation(conversation: ConversationRecord): Record<string, unknown> {
  return {
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    userid: conversation.userid,
    sitecode: conversation.sitecode,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    messages_count: conversation.messages.length,
    pending_action: conversation.pending_action
      ? {
        kind: conversation.pending_action.kind,
        plan_id: conversation.pending_action.plan_id,
        status: conversation.pending_action.status,
        requires_confirmation: conversation.pending_action.requires_confirmation
      }
      : undefined
  };
}

async function loadConversation(env: Env, owner: ConversationOwner, conversationId: string): Promise<ConversationRecord | null> {
  const raw = await env.CHUNKS.get(conversationKey(owner, conversationId));
  return raw ? JSON.parse(raw) as ConversationRecord : null;
}

async function saveConversation(env: Env, owner: ConversationOwner, conversation: ConversationRecord): Promise<void> {
  await env.CHUNKS.put(conversationKey(owner, conversation.conversation_id), JSON.stringify(conversation));
}

function truncateMessageContent(content: string): string {
  return content.trim().slice(0, MAX_HISTORY_CONTENT_CHARS);
}

function buildAgentHistory(conversation: ConversationRecord): AIMessage[] {
  const messages = conversation.messages
    .filter((message): message is StoredMessage & ChatHistoryMessage =>
      (message.role === "user" || message.role === "assistant") && Boolean(message.content?.trim())
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => ({
      role: message.role,
      content: truncateMessageContent(message.content)
    }));

  const pendingPlanId = conversation.pending_action?.requires_confirmation
    ? conversation.pending_action.plan_id
    : undefined;

  if (pendingPlanId && !messages.some(message => message.content.includes(pendingPlanId))) {
    return [
      {
        role: "assistant",
        content: `Kế hoạch App Builder đang chờ xác nhận. Plan ID: ${pendingPlanId}. Nếu user xác nhận, hãy apply plan này.`
      },
      ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))
    ];
  }

  return messages;
}

function appendMessage(conversation: ConversationRecord, message: StoredMessage): void {
  conversation.messages = [...conversation.messages, message].slice(-MAX_STORED_MESSAGES);
  conversation.updated_at = message.created_at;
}

function updateConversationActionState(conversation: ConversationRecord, actionState: AgentActionState | undefined, messageId: string): void {
  if (!actionState) return;

  conversation.action_logs = [
    ...conversation.action_logs,
    {
      action_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      message_id: messageId,
      action_state: actionState
    }
  ].slice(-MAX_ACTION_LOGS);

  if (
    actionState.kind === "prepare_change"
    && actionState.valid !== false
    && actionState.requires_confirmation
    && actionState.plan_id
  ) {
    conversation.pending_action = actionState;
    return;
  }

  if (actionState.kind === "apply_change") {
    if (!conversation.pending_action?.plan_id || conversation.pending_action.plan_id === actionState.plan_id) {
      conversation.pending_action = undefined;
    }
  }
}

function responseStatus(actionState: AgentActionState | undefined): string {
  if (!actionState) return "ok";
  if (actionState.kind === "prepare_change" && actionState.requires_confirmation && actionState.valid !== false) {
    return "needs_confirmation";
  }
  if (actionState.kind === "apply_change") {
    return actionState.ok ? "completed" : "action_failed";
  }
  if (actionState.valid === false) return "invalid_plan";
  return actionState.status ?? "ok";
}

export async function handleCreateConversation(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;

  const body = await readJsonBody<{ title?: string }>(request);
  const now = new Date().toISOString();
  const conversation: ConversationRecord = {
    conversation_id: `conv_${crypto.randomUUID()}`,
    userid: context.owner.userid,
    sitecode: context.owner.sitecode,
    title: String(body.title || "Đoạn chat mới").trim().slice(0, 120) || "Đoạn chat mới",
    created_at: now,
    updated_at: now,
    messages: [],
    action_logs: []
  };

  await saveConversation(env, context.owner, conversation);

  return jsonResponse({
    success: true,
    conversation: summarizeConversation(conversation)
  });
}

export async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;

  const keys: { name: string }[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.CHUNKS.list({ prefix: ownerPrefix(context.owner), cursor });
    keys.push(...listed.keys.map(key => ({ name: key.name })));
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  const conversations = await Promise.all(
    keys.map(async key => {
      const raw = await env.CHUNKS.get(key.name);
      return raw ? summarizeConversation(JSON.parse(raw) as ConversationRecord) : null;
    })
  );

  return jsonResponse({
    success: true,
    conversations: conversations
      .filter(Boolean)
      .sort((a, b) => String((b as Record<string, unknown>).updated_at).localeCompare(String((a as Record<string, unknown>).updated_at)))
  });
}

export async function handleGetConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;

  const conversation = await loadConversation(env, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  return jsonResponse({
    success: true,
    conversation
  });
}

export async function handleDeleteConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;

  await env.CHUNKS.delete(conversationKey(context.owner, conversationId));
  return jsonResponse({ success: true, conversation_id: conversationId });
}

export async function handleConversationMessage(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;

  const conversation = await loadConversation(env, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  const body = await readJsonBody<{ message?: string; debug?: boolean }>(request);
  const message = String(body.message ?? "").trim();
  if (!message) {
    return jsonResponse({ success: false, error: "Bắt buộc phải có trường message." }, { status: 400 });
  }

  const debugSteps = body.debug === true ? [] as DebugStep[] : undefined;
  const agentHistory = buildAgentHistory(conversation);

  addDebugStep(debugSteps, "conversation.history_loaded", "ok", "Worker đã tải history server-side cho conversation.", {
    conversation_id: conversationId,
    history_messages: agentHistory.length,
    has_pending_action: Boolean(conversation.pending_action)
  });

  const userMessage: StoredMessage = {
    message_id: crypto.randomUUID(),
    role: "user",
    content: message,
    created_at: new Date().toISOString()
  };

  const result = await runAgenticLoop(message, env, agentHistory, debugSteps, context.state);

  const assistantMessage: StoredMessage = {
    message_id: crypto.randomUUID(),
    role: "assistant",
    content: result.answer,
    created_at: new Date().toISOString(),
    tools_called: result.toolsCalled,
    sources: result.sources,
    debug_steps: debugSteps,
    action_state: result.action_state
  };

  appendMessage(conversation, userMessage);
  appendMessage(conversation, assistantMessage);
  if (conversation.title === "Đoạn chat mới") {
    conversation.title = message.slice(0, 80);
  }
  updateConversationActionState(conversation, result.action_state, assistantMessage.message_id);

  await saveConversation(env, context.owner, conversation);

  return jsonResponse({
    success: true,
    conversation_id: conversation.conversation_id,
    answer: result.answer,
    status: responseStatus(result.action_state),
    message: assistantMessage,
    pending_action: conversation.pending_action,
    action_state: result.action_state,
    tools_called: result.toolsCalled,
    sources: result.sources,
    embedding_debug: result.embedding_debug,
    rag_query_debug: result.rag_query_debug,
    debug_steps: debugSteps
  });
}
