import { CORS, MAX_HISTORY_CONTENT_CHARS, MAX_HISTORY_MESSAGES, type Env } from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { parseAgentMode, runAgenticLoop, sanitizeHistoryContentForModel } from "./agent";
import { runAppBuilderWriteTool } from "./app-builder-write";
import { loadZilcodeSessionFromRequestHeaders, type ZilcodeSessionState } from "./zilcode";
import type { AgentActionState, AgentMode, AIMessage, RagSource } from "./types";

const MAX_STORED_MESSAGES = 200;
const JOB_AUTH_TTL_SECONDS = 60 * 30;
const JOB_POLL_EVENT_LIMIT = 80;
const MAX_JOB_EVENT_PAYLOAD_CHARS = 12_000;

type JobStatus = "queued" | "running" | "waiting_confirmation" | "succeeded" | "failed" | "cancelled" | "expired";
type MessageStatus = "completed" | "generating" | "failed";
type JobKind = "message" | "apply_pending_action";

interface ConversationOwner {
  userid: string;
  sitecode: string;
  roleid: string;
  orgid: string;
  user_key: string;
}

interface ConversationRow {
  conversation_id: string;
  user_key: string;
  userid: string;
  sitecode: string;
  roleid: string | null;
  orgid: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageRow {
  message_id: string;
  conversation_id: string;
  user_key: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  mode: AgentMode | null;
  tools_called_json: string | null;
  sources_json: string | null;
  debug_steps_json: string | null;
  action_state_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  job_id: string;
  conversation_id: string;
  user_key: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  kind: JobKind;
  mode: AgentMode;
  status: JobStatus;
  stage: string | null;
  progress_text: string | null;
  error: string | null;
  idempotency_key: string | null;
  auth_context_json: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  expires_at: string | null;
}

interface PendingActionRow {
  action_id: string;
  conversation_id: string;
  user_key: string;
  job_id: string | null;
  assistant_message_id: string | null;
  plan_id: string;
  status: "waiting_confirmation" | "confirmed" | "cancelled" | "applied" | "failed" | "expired";
  payload_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface JobEventRow {
  event_id: string;
  job_id: string;
  user_key: string;
  seq: number;
  type: string;
  payload_json: string | null;
  created_at: string;
}

interface StoredMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  created_at: string;
  updated_at?: string;
  mode?: AgentMode | null;
  tools_called?: string[];
  sources?: RagSource[];
  debug_steps?: DebugStep[];
  action_state?: AgentActionState;
  error?: string | null;
}

interface JobPayload {
  message?: string;
  debug?: boolean;
  action_id?: string;
  plan_id?: string;
}

interface AgentJobQueueMessage {
  job_id: string;
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

function requireDb(env: Env): D1Database | Response {
  if (env.DB) return env.DB;
  return jsonResponse({
    success: false,
    error: [
      "D1 database binding DB chưa được cấu hình.",
      "Tạo bằng: npx wrangler d1 create ragorit-agent-db",
      "Sau đó thêm binding d1_databases trong wrangler.jsonc và chạy migration."
    ].join(" ")
  }, { status: 500 });
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function toLimitedJson(value: unknown, maxChars: number): string | null {
  const json = toJson(value);
  if (!json || json.length <= maxChars) return json;
  return JSON.stringify({
    truncated: true,
    original_chars: json.length,
    preview: json.slice(0, maxChars)
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.@-]/g, "_") || "unknown";
}

function getOwnerFromSession(state: ZilcodeSessionState | null): ConversationOwner | null {
  if (!state) return null;
  const user = state.session.user ?? {};
  const userid = String(user.userid ?? user.user_id ?? "").trim();
  const sitecode = String(user.sitecode ?? "").trim();
  const roleid = String(state.session.roleid ?? user.roleid ?? "").trim();
  const orgid = String(state.session.orgid ?? user.orgid ?? "0").trim() || "0";
  if (!userid || !sitecode) return null;
  return {
    userid,
    sitecode,
    roleid,
    orgid,
    user_key: [
      sanitizeKeyPart(sitecode),
      sanitizeKeyPart(userid),
      sanitizeKeyPart(roleid || "no-role"),
      sanitizeKeyPart(orgid || "0")
    ].join(":")
  };
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

function summarizeConversation(row: ConversationRow, messagesCount = 0, pendingAction?: PendingActionRow | null): Record<string, unknown> {
  return {
    conversation_id: row.conversation_id,
    title: row.title,
    userid: row.userid,
    sitecode: row.sitecode,
    roleid: row.roleid,
    orgid: row.orgid,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages_count: messagesCount,
    pending_action: pendingAction
      ? serializePendingAction(pendingAction)
      : undefined
  };
}

function serializeMessage(row: MessageRow): StoredMessage {
  return {
    message_id: row.message_id,
    role: row.role,
    content: row.content,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mode: row.mode,
    tools_called: safeJsonParse<string[]>(row.tools_called_json, []),
    sources: safeJsonParse<RagSource[]>(row.sources_json, []),
    debug_steps: safeJsonParse<DebugStep[]>(row.debug_steps_json, []),
    action_state: safeJsonParse<AgentActionState | undefined>(row.action_state_json, undefined),
    error: row.error
  };
}

function serializeJob(row: JobRow, events: JobEventRow[] = []): Record<string, unknown> {
  return {
    job_id: row.job_id,
    conversation_id: row.conversation_id,
    user_message_id: row.user_message_id,
    assistant_message_id: row.assistant_message_id,
    kind: row.kind,
    mode: row.mode,
    status: row.status,
    stage: row.stage,
    progress_text: row.progress_text,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
    expires_at: row.expires_at,
    events: events.map(event => ({
      event_id: event.event_id,
      seq: event.seq,
      type: event.type,
      payload: safeJsonParse<Record<string, unknown> | null>(event.payload_json, null),
      created_at: event.created_at
    }))
  };
}

function serializePendingAction(row: PendingActionRow): Record<string, unknown> {
  return {
    action_id: row.action_id,
    conversation_id: row.conversation_id,
    job_id: row.job_id,
    assistant_message_id: row.assistant_message_id,
    plan_id: row.plan_id,
    status: row.status,
    payload: safeJsonParse<Record<string, unknown> | null>(row.payload_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at
  };
}

async function getConversation(db: D1Database, owner: ConversationOwner, conversationId: string): Promise<ConversationRow | null> {
  return db.prepare(
    `SELECT * FROM conversations
     WHERE conversation_id = ?1 AND user_key = ?2 AND deleted_at IS NULL`
  ).bind(conversationId, owner.user_key).first<ConversationRow>();
}

async function countConversationMessages(db: D1Database, owner: ConversationOwner, conversationId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2`
  ).bind(conversationId, owner.user_key).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function getPendingActionForConversation(
  db: D1Database,
  owner: ConversationOwner,
  conversationId: string
): Promise<PendingActionRow | null> {
  return db.prepare(
    `SELECT * FROM pending_actions
     WHERE conversation_id = ?1 AND user_key = ?2 AND status = 'waiting_confirmation'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(conversationId, owner.user_key).first<PendingActionRow>();
}

async function getMessage(db: D1Database, userKey: string, messageId: string): Promise<MessageRow | null> {
  return db.prepare(
    `SELECT * FROM messages WHERE message_id = ?1 AND user_key = ?2`
  ).bind(messageId, userKey).first<MessageRow>();
}

async function getJob(db: D1Database, userKey: string, jobId: string): Promise<JobRow | null> {
  return db.prepare(
    `SELECT * FROM jobs WHERE job_id = ?1 AND user_key = ?2`
  ).bind(jobId, userKey).first<JobRow>();
}

async function getJobAnyOwner(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare(`SELECT * FROM jobs WHERE job_id = ?1`).bind(jobId).first<JobRow>();
}

async function insertJobEvent(
  db: D1Database,
  job: Pick<JobRow, "job_id" | "user_key">,
  type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const seqRow = await db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM job_events WHERE job_id = ?1`
  ).bind(job.job_id).first<{ next_seq: number }>();
  await db.prepare(
    `INSERT INTO job_events (event_id, job_id, user_key, seq, type, payload_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    `evt_${crypto.randomUUID()}`,
    job.job_id,
    job.user_key,
    Number(seqRow?.next_seq ?? 1),
    type,
    toLimitedJson(payload, MAX_JOB_EVENT_PAYLOAD_CHARS),
    nowIso()
  ).run();
}

async function listJobEvents(db: D1Database, userKey: string, jobId: string): Promise<JobEventRow[]> {
  const result = await db.prepare(
    `SELECT * FROM job_events
     WHERE job_id = ?1 AND user_key = ?2
     ORDER BY seq ASC LIMIT ?3`
  ).bind(jobId, userKey, JOB_POLL_EVENT_LIMIT).all<JobEventRow>();
  return result.results ?? [];
}

async function updateJob(
  db: D1Database,
  job: Pick<JobRow, "job_id" | "user_key">,
  patch: Partial<Pick<JobRow, "status" | "stage" | "progress_text" | "error" | "finished_at" | "auth_context_json">>
): Promise<void> {
  const current = await getJob(db, job.user_key, job.job_id);
  if (!current) return;
  await db.prepare(
    `UPDATE jobs
     SET status = ?1, stage = ?2, progress_text = ?3, error = ?4, finished_at = ?5,
         auth_context_json = ?6, updated_at = ?7
     WHERE job_id = ?8 AND user_key = ?9`
  ).bind(
    patch.status ?? current.status,
    patch.stage ?? current.stage,
    patch.progress_text ?? current.progress_text,
    patch.error ?? current.error,
    patch.finished_at ?? current.finished_at,
    patch.auth_context_json === undefined ? current.auth_context_json : patch.auth_context_json,
    nowIso(),
    job.job_id,
    job.user_key
  ).run();
}

async function setAssistantMessageFailed(
  db: D1Database,
  job: JobRow,
  error: string,
  debugSteps?: DebugStep[]
): Promise<void> {
  if (!job.assistant_message_id) return;
  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'failed', error = ?2, debug_steps_json = ?3, updated_at = ?4
     WHERE message_id = ?5 AND user_key = ?6`
  ).bind(
    `Không xử lý được yêu cầu: ${error}`,
    error,
    toJson(debugSteps ?? []),
    nowIso(),
    job.assistant_message_id,
    job.user_key
  ).run();
}

function truncateMessageContent(content: string): string {
  return sanitizeHistoryContentForModel(content).slice(0, MAX_HISTORY_CONTENT_CHARS);
}

async function buildAgentHistory(db: D1Database, job: JobRow): Promise<AIMessage[]> {
  const currentUserMessage = job.user_message_id
    ? await getMessage(db, job.user_key, job.user_message_id)
    : null;
  const cutoff = currentUserMessage?.created_at ?? nowIso();
  const result = await db.prepare(
    `SELECT * FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2
       AND status = 'completed'
       AND content <> ''
       AND created_at < ?3
     ORDER BY created_at DESC LIMIT ?4`
  ).bind(job.conversation_id, job.user_key, cutoff, MAX_HISTORY_MESSAGES).all<MessageRow>();

  const messages = [...(result.results ?? [])]
    .reverse()
    .filter(message => message.role === "user" || message.role === "assistant")
    .map(message => ({
      role: message.role,
      content: truncateMessageContent(message.content)
    } satisfies AIMessage));

  const pendingAction = await db.prepare(
    `SELECT * FROM pending_actions
     WHERE conversation_id = ?1 AND user_key = ?2 AND status = 'waiting_confirmation'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(job.conversation_id, job.user_key).first<PendingActionRow>();

  if (pendingAction?.plan_id && !messages.some(message => message.content.includes(pendingAction.plan_id))) {
    return [
      {
        role: "assistant",
        content: `Trạng thái App Builder: có pending plan đang chờ xác nhận bằng nút UI. Plan ID: ${pendingAction.plan_id}.`
      },
      ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))
    ];
  }

  return messages;
}

async function updateConversationActionState(
  db: D1Database,
  job: JobRow,
  actionState: AgentActionState | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!actionState) return undefined;

  if (
    actionState.kind === "prepare_change"
    && actionState.valid !== false
    && actionState.requires_confirmation
    && actionState.plan_id
  ) {
    const now = nowIso();
    const pendingAction: PendingActionRow = {
      action_id: `act_${crypto.randomUUID()}`,
      conversation_id: job.conversation_id,
      user_key: job.user_key,
      job_id: job.job_id,
      assistant_message_id: job.assistant_message_id,
      plan_id: actionState.plan_id,
      status: "waiting_confirmation",
      payload_json: toJson(actionState),
      created_at: now,
      updated_at: now,
      expires_at: addSeconds(new Date(), 60 * 30)
    };

    await db.prepare(
      `INSERT INTO pending_actions (
        action_id, conversation_id, user_key, job_id, assistant_message_id, plan_id, status,
        payload_json, created_at, updated_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(
      pendingAction.action_id,
      pendingAction.conversation_id,
      pendingAction.user_key,
      pendingAction.job_id,
      pendingAction.assistant_message_id,
      pendingAction.plan_id,
      pendingAction.status,
      pendingAction.payload_json,
      pendingAction.created_at,
      pendingAction.updated_at,
      pendingAction.expires_at
    ).run();

    return serializePendingAction(pendingAction);
  }

  if (actionState.kind === "apply_change" && actionState.plan_id) {
    await db.prepare(
      `UPDATE pending_actions
       SET status = ?1, updated_at = ?2
       WHERE user_key = ?3 AND plan_id = ?4 AND status IN ('waiting_confirmation', 'confirmed')`
    ).bind(actionState.ok ? "applied" : "failed", nowIso(), job.user_key, actionState.plan_id).run();
  }

  return undefined;
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

async function dispatchJob(env: Env, ctx: ExecutionContext | undefined, jobId: string): Promise<"queue" | "waitUntil" | "manual"> {
  const message: AgentJobQueueMessage = { job_id: jobId };
  if (env.AGENT_JOBS) {
    await env.AGENT_JOBS.send(message);
    return "queue";
  }
  if (ctx) {
    ctx.waitUntil(runConversationJob(env, jobId));
    return "waitUntil";
  }
  return "manual";
}

async function failJob(db: D1Database, job: JobRow, error: unknown, debugSteps?: DebugStep[]): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await setAssistantMessageFailed(db, job, message, debugSteps);
  await updateJob(db, job, {
    status: "failed",
    stage: "failed",
    progress_text: "Job thất bại.",
    error: message,
    finished_at: nowIso(),
    auth_context_json: null
  });
  await insertJobEvent(db, job, "failed", { error: message });
}

function buildApplyChangeAnswer(result: Record<string, unknown>): string {
  if (result.ok === true) {
    return [
      "Đã thực hiện xong kế hoạch App Builder.",
      `Plan ID: ${String(result.plan_id ?? "")}`,
      `Số bước đã ghi: ${String(result.applied_count ?? 0)}.`,
      "",
      "Bước tiếp theo nên làm là đọc lại App Builder graph để kiểm tra thay đổi đã đúng."
    ].join("\n");
  }

  const failed = result.failed_operation && typeof result.failed_operation === "object"
    ? result.failed_operation as Record<string, unknown>
    : null;

  return [
    "Kế hoạch chưa được thực hiện thành công.",
    `Đã ghi được: ${String(result.applied_count ?? 0)} bước.`,
    `Số bước lỗi: ${String(result.failed_count ?? 0)}.`,
    failed ? `Dừng tại: ${String(failed.operation_id ?? "")}.` : "",
    "",
    `Lỗi chính: ${String(failed?.error ?? result.error ?? "Không rõ lỗi.")}`,
    "",
    "Tôi chưa coi thay đổi này là hoàn tất. Cần đọc lại graph, sửa plan theo lỗi trên rồi chuẩn bị kế hoạch mới nếu cần."
  ].filter(Boolean).join("\n");
}

async function runMessageJob(db: D1Database, env: Env, job: JobRow, state: ZilcodeSessionState): Promise<void> {
  const userMessage = job.user_message_id ? await getMessage(db, job.user_key, job.user_message_id) : null;
  if (!userMessage) throw new Error("Không tìm thấy user message cho job.");

  const payload = safeJsonParse<JobPayload>(job.payload_json, {});
  const debugSteps = payload.debug === true ? [] as DebugStep[] : undefined;
  const history = await buildAgentHistory(db, job);

  addDebugStep(debugSteps, "conversation.history_loaded", "ok", "Worker đã tải history server-side cho conversation job.", {
    conversation_id: job.conversation_id,
    job_id: job.job_id,
    mode: job.mode,
    history_messages: history.length
  });

  await updateJob(db, job, {
    status: "running",
    stage: "agent",
    progress_text: "Agent đang xử lý yêu cầu."
  });
  await insertJobEvent(db, job, "agent_started", { mode: job.mode });

  const result = await runAgenticLoop(userMessage.content, env, history, debugSteps, state, job.mode);
  const pendingAction = await updateConversationActionState(db, job, result.action_state);
  const status = responseStatus(result.action_state);
  const now = nowIso();

  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'completed', tools_called_json = ?2, sources_json = ?3,
         debug_steps_json = ?4, action_state_json = ?5, updated_at = ?6
     WHERE message_id = ?7 AND user_key = ?8`
  ).bind(
    result.answer,
    toJson(result.toolsCalled),
    toJson(result.sources ?? []),
    toJson(debugSteps ?? []),
    toJson(result.action_state),
    now,
    job.assistant_message_id,
    job.user_key
  ).run();

  const conversation = await db.prepare(
    `SELECT * FROM conversations WHERE conversation_id = ?1 AND user_key = ?2`
  ).bind(job.conversation_id, job.user_key).first<ConversationRow>();
  if (conversation) {
    const title = conversation.title === "Đoạn chat mới"
      ? userMessage.content.slice(0, 80)
      : conversation.title;
    await db.prepare(
      `UPDATE conversations SET title = ?1, updated_at = ?2 WHERE conversation_id = ?3 AND user_key = ?4`
    ).bind(title, now, job.conversation_id, job.user_key).run();
  }

  const finalStatus: JobStatus = pendingAction ? "waiting_confirmation" : "succeeded";
  await updateJob(db, job, {
    status: finalStatus,
    stage: finalStatus,
    progress_text: pendingAction ? "Đang chờ xác nhận kế hoạch." : "Job đã hoàn tất.",
    finished_at: finalStatus === "succeeded" ? now : null,
    auth_context_json: null
  });
  await insertJobEvent(db, job, finalStatus, {
    status,
    answer_chars: result.answer.length,
    tools_called: result.toolsCalled,
    pending_action: pendingAction
  });
}

async function runApplyPendingActionJob(db: D1Database, env: Env, job: JobRow, state: ZilcodeSessionState): Promise<void> {
  const payload = safeJsonParse<JobPayload>(job.payload_json, {});
  const actionId = String(payload.action_id || "");
  const planId = String(payload.plan_id || "");
  if (!actionId || !planId) throw new Error("Job apply thiếu action_id hoặc plan_id.");

  const pendingAction = await db.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, job.user_key).first<PendingActionRow>();
  if (!pendingAction) throw new Error("Không tìm thấy pending action.");
  if (pendingAction.status !== "confirmed") {
    throw new Error(`Pending action không ở trạng thái confirmed: ${pendingAction.status}.`);
  }

  await updateJob(db, job, {
    status: "running",
    stage: "apply_change",
    progress_text: "Đang thực hiện pending App Builder plan."
  });
  await insertJobEvent(db, job, "apply_started", { action_id: actionId, plan_id: planId });

  const debugSteps: DebugStep[] = [];
  addDebugStep(debugSteps, "pending_action.apply", "start", "Bắt đầu apply pending App Builder action.", {
    action_id: actionId,
    plan_id: planId
  });

  const writeResult = await runAppBuilderWriteTool(env, state.session, "app_builder_apply_change", { plan_id: planId });
  addDebugStep(debugSteps, "pending_action.apply", "ok", "app_builder_apply_change đã trả kết quả.", {
    ok: writeResult.ok,
    status: writeResult.status,
    plan_id: writeResult.plan_id
  });

  const answer = buildApplyChangeAnswer(writeResult);
  const actionState: AgentActionState = {
    kind: "apply_change",
    plan_id: typeof writeResult.plan_id === "string" ? writeResult.plan_id : planId,
    status: typeof writeResult.status === "string" ? writeResult.status : undefined,
    ok: typeof writeResult.ok === "boolean" ? writeResult.ok : undefined,
    applied_count: typeof writeResult.applied_count === "number" ? writeResult.applied_count : undefined,
    failed_count: typeof writeResult.failed_count === "number" ? writeResult.failed_count : undefined,
    skipped_count: typeof writeResult.skipped_count === "number" ? writeResult.skipped_count : undefined,
    error: typeof writeResult.error === "string" ? writeResult.error : undefined,
    updated_at: nowIso()
  };

  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'completed', tools_called_json = ?2, debug_steps_json = ?3,
         action_state_json = ?4, updated_at = ?5
     WHERE message_id = ?6 AND user_key = ?7`
  ).bind(
    answer,
    toJson(["app_builder_apply_change"]),
    toJson(debugSteps),
    toJson(actionState),
    nowIso(),
    job.assistant_message_id,
    job.user_key
  ).run();

  await updateConversationActionState(db, job, actionState);
  const succeeded = writeResult.ok === true;
  await updateJob(db, job, {
    status: succeeded ? "succeeded" : "failed",
    stage: succeeded ? "succeeded" : "failed",
    progress_text: succeeded ? "Apply plan đã hoàn tất." : "Apply plan thất bại.",
    error: succeeded ? null : String(writeResult.error ?? "Apply plan thất bại."),
    finished_at: nowIso(),
    auth_context_json: null
  });
  await insertJobEvent(db, job, succeeded ? "succeeded" : "failed", {
    action_id: actionId,
    plan_id: planId,
    result: writeResult
  });
}

export async function runConversationJob(env: Env, jobId: string): Promise<void> {
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) throw new Error("D1 database binding DB chưa được cấu hình.");
  const db = dbOrResponse;

  const job = await getJobAnyOwner(db, jobId);
  if (!job) throw new Error(`Không tìm thấy job ${jobId}.`);
  if (!["queued", "running"].includes(job.status)) return;

  const authState = safeJsonParse<ZilcodeSessionState | null>(job.auth_context_json, null);
  if (!authState?.session?.token) {
    await failJob(db, job, "Job thiếu auth context hoặc auth context đã bị xóa.");
    return;
  }
  if (job.expires_at && job.expires_at < nowIso()) {
    await updateJob(db, job, {
      status: "expired",
      stage: "expired",
      progress_text: "Job đã hết hạn trước khi chạy.",
      finished_at: nowIso(),
      auth_context_json: null
    });
    await insertJobEvent(db, job, "expired");
    return;
  }

  try {
    if (job.kind === "apply_pending_action") {
      await runApplyPendingActionJob(db, env, job, authState);
    } else {
      await runMessageJob(db, env, job, authState);
    }
  } catch (error) {
    await failJob(db, job, error);
  }
}

export async function handleCreateConversation(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const body = await readJsonBody<{ title?: string }>(request);
  const now = nowIso();
  const conversation: ConversationRow = {
    conversation_id: `conv_${crypto.randomUUID()}`,
    user_key: context.owner.user_key,
    userid: context.owner.userid,
    sitecode: context.owner.sitecode,
    roleid: context.owner.roleid || null,
    orgid: context.owner.orgid || "0",
    title: String(body.title || "Đoạn chat mới").trim().slice(0, 120) || "Đoạn chat mới",
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  await dbOrResponse.prepare(
    `INSERT INTO conversations (
      conversation_id, user_key, userid, sitecode, roleid, orgid, title, created_at, updated_at, deleted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)`
  ).bind(
    conversation.conversation_id,
    conversation.user_key,
    conversation.userid,
    conversation.sitecode,
    conversation.roleid,
    conversation.orgid,
    conversation.title,
    conversation.created_at,
    conversation.updated_at
  ).run();

  return jsonResponse({
    success: true,
    conversation: summarizeConversation(conversation)
  });
}

export async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const result = await dbOrResponse.prepare(
    `SELECT
       c.*,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.user_key = c.user_key) AS messages_count
     FROM conversations c
     WHERE c.user_key = ?1 AND c.deleted_at IS NULL
     ORDER BY c.updated_at DESC`
  ).bind(context.owner.user_key).all<ConversationRow & { messages_count: number }>();

  return jsonResponse({
    success: true,
    conversations: (result.results ?? []).map(row => summarizeConversation(row, Number(row.messages_count ?? 0)))
  });
}

export async function handleGetConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const conversation = await getConversation(dbOrResponse, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  const messagesResult = await dbOrResponse.prepare(
    `SELECT * FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2
     ORDER BY created_at ASC LIMIT ?3`
  ).bind(conversationId, context.owner.user_key, MAX_STORED_MESSAGES).all<MessageRow>();
  const pendingAction = await getPendingActionForConversation(dbOrResponse, context.owner, conversationId);

  return jsonResponse({
    success: true,
    conversation: {
      ...summarizeConversation(conversation, messagesResult.results?.length ?? 0, pendingAction),
      messages: (messagesResult.results ?? []).map(serializeMessage),
      pending_action: pendingAction ? serializePendingAction(pendingAction) : undefined
    }
  });
}

export async function handleDeleteConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  await dbOrResponse.prepare(
    `UPDATE conversations SET deleted_at = ?1, updated_at = ?1
     WHERE conversation_id = ?2 AND user_key = ?3`
  ).bind(nowIso(), conversationId, context.owner.user_key).run();
  return jsonResponse({ success: true, conversation_id: conversationId });
}

export async function handleConversationMessage(
  request: Request,
  env: Env,
  conversationId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  const conversation = await getConversation(db, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  const body = await readJsonBody<{ message?: string; mode?: AgentMode; debug?: boolean; idempotency_key?: string }>(request);
  const message = String(body.message ?? "").trim();
  if (!message) {
    return jsonResponse({ success: false, error: "Bắt buộc phải có trường message." }, { status: 400 });
  }

  const mode = parseAgentMode(body.mode);
  if (!mode) {
    return jsonResponse({ success: false, error: "Mode không hợp lệ. Chỉ hỗ trợ: default, search." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") || String(body.idempotency_key || "").trim() || null;
  if (idempotencyKey) {
    const existing = await db.prepare(
      `SELECT * FROM jobs
       WHERE conversation_id = ?1 AND user_key = ?2 AND idempotency_key = ?3
       ORDER BY created_at DESC LIMIT 1`
    ).bind(conversationId, context.owner.user_key, idempotencyKey).first<JobRow>();
    if (existing) {
      const events = await listJobEvents(db, context.owner.user_key, existing.job_id);
      return jsonResponse({
        success: true,
        status: existing.status,
        conversation_id: conversationId,
        user_message_id: existing.user_message_id,
        assistant_message_id: existing.assistant_message_id,
        job_id: existing.job_id,
        job: serializeJob(existing, events),
        idempotent_replay: true
      }, { status: 202 });
    }
  }

  const activeJob = await db.prepare(
    `SELECT * FROM jobs
     WHERE conversation_id = ?1 AND user_key = ?2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(conversationId, context.owner.user_key).first<JobRow>();
  if (activeJob) {
    return jsonResponse({
      success: false,
      error: "Đoạn chat đang có job chạy. Hãy chờ job hiện tại hoàn tất rồi gửi tiếp.",
      active_job: serializeJob(activeJob)
    }, { status: 409 });
  }
  const now = nowIso();
  const userMessageId = `msg_${crypto.randomUUID()}`;
  const assistantMessageId = `msg_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  const expiresAt = addSeconds(new Date(), JOB_AUTH_TTL_SECONDS);

  await db.batch([
    db.prepare(
      `INSERT INTO messages (
        message_id, conversation_id, user_key, role, content, status, mode,
        tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'user', ?4, 'completed', ?5, NULL, NULL, NULL, NULL, NULL, ?6, ?6)`
    ).bind(userMessageId, conversationId, context.owner.user_key, message, mode, now),
    db.prepare(
      `INSERT INTO messages (
        message_id, conversation_id, user_key, role, content, status, mode,
        tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'assistant', '', 'generating', ?4, NULL, NULL, NULL, NULL, NULL, ?5, ?5)`
    ).bind(assistantMessageId, conversationId, context.owner.user_key, mode, now),
    db.prepare(
      `INSERT INTO jobs (
        job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind, mode, status,
        stage, progress_text, error, idempotency_key, auth_context_json, payload_json,
        created_at, updated_at, finished_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'message', ?6, 'queued',
        'queued', 'Job đã được đưa vào hàng chờ.', NULL, ?7, ?8, ?9,
        ?10, ?10, NULL, ?11)`
    ).bind(
      jobId,
      conversationId,
      context.owner.user_key,
      userMessageId,
      assistantMessageId,
      mode,
      idempotencyKey,
      toJson(context.state),
      toJson({ message, debug: body.debug === true } satisfies JobPayload),
      now,
      expiresAt
    ),
    db.prepare(
      `UPDATE conversations SET updated_at = ?1 WHERE conversation_id = ?2 AND user_key = ?3`
    ).bind(now, conversationId, context.owner.user_key)
  ]);

  const dispatch = await dispatchJob(env, ctx, jobId);
  await insertJobEvent(db, { job_id: jobId, user_key: context.owner.user_key }, "queued", { dispatch });

  return jsonResponse({
    success: true,
    status: "queued",
    conversation_id: conversationId,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    job_id: jobId,
    dispatch
  }, { status: 202 });
}

export async function handleGetJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const job = await getJob(dbOrResponse, context.owner.user_key, jobId);
  if (!job) {
    return jsonResponse({ success: false, error: "Không tìm thấy job." }, { status: 404 });
  }

  const events = await listJobEvents(dbOrResponse, context.owner.user_key, jobId);
  const assistantMessage = job.assistant_message_id
    ? await getMessage(dbOrResponse, context.owner.user_key, job.assistant_message_id)
    : null;

  return jsonResponse({
    success: true,
    job: serializeJob(job, events),
    message: assistantMessage ? serializeMessage(assistantMessage) : null
  });
}

export async function handleGetJobEvents(request: Request, env: Env, jobId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const job = await getJob(dbOrResponse, context.owner.user_key, jobId);
  if (!job) {
    return jsonResponse({ success: false, error: "Không tìm thấy job." }, { status: 404 });
  }

  return jsonResponse({
    success: true,
    job_id: jobId,
    events: (await listJobEvents(dbOrResponse, context.owner.user_key, jobId)).map(event => ({
      event_id: event.event_id,
      seq: event.seq,
      type: event.type,
      payload: safeJsonParse<Record<string, unknown> | null>(event.payload_json, null),
      created_at: event.created_at
    }))
  });
}

export async function handleConfirmPendingAction(
  request: Request,
  env: Env,
  actionId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  const action = await db.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, context.owner.user_key).first<PendingActionRow>();
  if (!action) {
    return jsonResponse({ success: false, error: "Không tìm thấy pending action." }, { status: 404 });
  }
  if (action.status !== "waiting_confirmation") {
    return jsonResponse({ success: false, error: `Pending action không thể xác nhận ở trạng thái ${action.status}.` }, { status: 409 });
  }

  const now = nowIso();
  const userMessageId = `msg_${crypto.randomUUID()}`;
  const assistantMessageId = `msg_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  if (action.expires_at && action.expires_at < nowIso()) {
    const expiredAt = nowIso();
    await db.prepare(
      `UPDATE pending_actions SET status = 'expired', updated_at = ?1 WHERE action_id = ?2 AND user_key = ?3`
    ).bind(expiredAt, actionId, context.owner.user_key).run();
    return jsonResponse({ success: false, error: "Pending action đã hết hạn, hãy tạo lại kế hoạch." }, { status: 409 });
  }

  const userContent = `Xác nhận thực hiện kế hoạch App Builder ${action.plan_id}.`;

  await db.batch([
    db.prepare(
      `UPDATE pending_actions SET status = 'confirmed', updated_at = ?1 WHERE action_id = ?2 AND user_key = ?3`
    ).bind(now, actionId, context.owner.user_key),
    db.prepare(
      `INSERT INTO messages (
        message_id, conversation_id, user_key, role, content, status, mode,
        tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'user', ?4, 'completed', 'default', NULL, NULL, NULL, NULL, NULL, ?5, ?5)`
    ).bind(userMessageId, action.conversation_id, context.owner.user_key, userContent, now),
    db.prepare(
      `INSERT INTO messages (
        message_id, conversation_id, user_key, role, content, status, mode,
        tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'assistant', '', 'generating', 'default', NULL, NULL, NULL, NULL, NULL, ?4, ?4)`
    ).bind(assistantMessageId, action.conversation_id, context.owner.user_key, now),
    db.prepare(
      `INSERT INTO jobs (
        job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind, mode, status,
        stage, progress_text, error, idempotency_key, auth_context_json, payload_json,
        created_at, updated_at, finished_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'apply_pending_action', 'default', 'queued',
        'queued', 'Job apply plan đã được đưa vào hàng chờ.', NULL, NULL, ?6, ?7,
        ?8, ?8, NULL, ?9)`
    ).bind(
      jobId,
      action.conversation_id,
      context.owner.user_key,
      userMessageId,
      assistantMessageId,
      toJson(context.state),
      toJson({ action_id: actionId, plan_id: action.plan_id } satisfies JobPayload),
      now,
      addSeconds(new Date(), JOB_AUTH_TTL_SECONDS)
    ),
    db.prepare(
      `UPDATE conversations SET updated_at = ?1 WHERE conversation_id = ?2 AND user_key = ?3`
    ).bind(now, action.conversation_id, context.owner.user_key)
  ]);

  const dispatch = await dispatchJob(env, ctx, jobId);
  await insertJobEvent(db, { job_id: jobId, user_key: context.owner.user_key }, "queued", { dispatch, action_id: actionId });

  return jsonResponse({
    success: true,
    status: "queued",
    action_id: actionId,
    plan_id: action.plan_id,
    conversation_id: action.conversation_id,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    job_id: jobId,
    dispatch
  }, { status: 202 });
}

export async function handleCancelPendingAction(request: Request, env: Env, actionId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const action = await dbOrResponse.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, context.owner.user_key).first<PendingActionRow>();
  if (!action) {
    return jsonResponse({ success: false, error: "Không tìm thấy pending action." }, { status: 404 });
  }
  if (action.status !== "waiting_confirmation") {
    return jsonResponse({ success: false, error: `Pending action không thể hủy ở trạng thái ${action.status}.` }, { status: 409 });
  }

  await dbOrResponse.prepare(
    `UPDATE pending_actions SET status = 'cancelled', updated_at = ?1 WHERE action_id = ?2 AND user_key = ?3`
  ).bind(nowIso(), actionId, context.owner.user_key).run();

  return jsonResponse({
    success: true,
    action_id: actionId,
    status: "cancelled"
  });
}
