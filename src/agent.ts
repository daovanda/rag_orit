import {
  CHAT_MODEL,
  GENERAL_CHAT_MAX_TOKENS,
  GENERAL_CHAT_MODEL,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_MESSAGES,
  RAG_FINAL_MAX_TOKENS,
  TOOL_RESULT_CONTEXT_MAX_CHARS,
  TOOL_SELECTION_MAX_TOKENS,
  type Env
} from "./config";
import { runChatModel, searchRag } from "./ai";
import { addDebugStep, type DebugStep } from "./debug";
import { TOOLS } from "./tools";
import { asRecord, getStringArg, toArrayValues } from "./utils";
import {
  isAppBuilderGraphTool,
  runAppBuilderGraphTool
} from "./app-builder-graph";
import {
  isAppBuilderWriteTool,
  runAppBuilderWriteTool
} from "./app-builder-write";
import {
  noZilcodeSessionResult,
  type ZilcodeSessionState
} from "./zilcode";
import type {
  AgentActionState,
  AgenticLoopResult,
  AgentMode,
  AIMessage,
  ChatHistoryMessage,
  EmbeddingDebug,
  RagQueryDebug,
  RagSource,
  ToolDefinition,
  ToolCall,
  ToolExecutionResult,
  ToolResultRecord
} from "./types";

const MAX_ITERATIONS = 6;
const SEARCH_MODE_TOOL_NAMES = new Set<string>(["general_chat", "rag_search"]);
const GRAPH_CONTINUE_TOOLS = new Set([
  "app_builder_graph_search"
]);
const COMPREHENSION_CONTEXT_MAX_CHARS = 4000;
const FINAL_ANSWER_ARRAY_LIMIT = 16;
const FINAL_ANSWER_OBJECT_KEY_LIMIT = 28;
const FINAL_ANSWER_RECURSION_LIMIT = 3;
const REQUEST_CONTEXTUALIZER_MAX_TOKENS = 700;

export interface ResolvedReference {
  type?: string;
  id?: string;
  name?: string;
  source?: string;
}

interface ContextualizedRequest {
  valid: boolean;
  rewritten_message: string;
  needs_clarification: boolean;
  clarification_question: string | null;
  resolved_references: ResolvedReference[];
}

export function parseAgentMode(value: unknown): AgentMode | null {
  if (value == null || value === "" || value === "default") return "default";
  if (value === "search") return "search";
  return null;
}

function getToolsForAgentMode(mode: AgentMode): readonly ToolDefinition[] {
  if (mode === "search") {
    return TOOLS.filter(tool => SEARCH_MODE_TOOL_NAMES.has(tool.name));
  }
  return TOOLS;
}

function sanitizeResolvedReferences(value: unknown): ResolvedReference[] {
  return toArrayValues(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .slice(0, 8)
    .map(item => ({
      type: typeof item.type === "string" ? item.type.trim() : undefined,
      id: typeof item.id === "string" || typeof item.id === "number" ? String(item.id).trim() : undefined,
      name: typeof item.name === "string" ? item.name.trim() : undefined,
      source: typeof item.source === "string" ? item.source.trim().slice(0, 160) : undefined
    }))
    .filter(reference => reference.type || reference.id || reference.name);
}

function extractJsonObjectText(text: string): string | null {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

export function parseContextualizedRequest(text: string): ContextualizedRequest | null {
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) return null;

  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const rewrittenMessage = typeof data.rewritten_message === "string"
      ? data.rewritten_message.trim().slice(0, 3000)
      : "";
    if (!rewrittenMessage) return null;

    const needsClarification = data.needs_clarification === true;
    const clarificationQuestion = typeof data.clarification_question === "string"
      ? data.clarification_question.trim().slice(0, 500)
      : "";

    return {
      valid: true,
      rewritten_message: rewrittenMessage,
      needs_clarification: needsClarification,
      clarification_question: needsClarification
        ? clarificationQuestion || "Bạn có thể nói rõ đối tượng hoặc hành động bạn đang muốn nhắc tới không?"
        : null,
      resolved_references: sanitizeResolvedReferences(data.resolved_references)
    };
  } catch {
    return null;
  }
}

function fallbackContextualizedRequest(userMessage: string): ContextualizedRequest {
  return {
    valid: false,
    rewritten_message: userMessage.trim(),
    needs_clarification: false,
    clarification_question: null,
    resolved_references: []
  };
}

function summarizeHistoryForContextualizer(chatHistory: AIMessage[]): string {
  return chatHistory
    .slice(-6)
    .map(message => `${message.role}: ${message.content.slice(0, 500)}`)
    .join("\n");
}

async function contextualizeUserRequest(
  userMessage: string,
  chatHistory: AIMessage[],
  env: Env,
  debugSteps?: DebugStep[]
): Promise<ContextualizedRequest> {
  addDebugStep(debugSteps, "agent.request_contextualizer", "start", "Làm rõ yêu cầu người dùng từ câu hiện tại và lịch sử gần đây.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    model: CHAT_MODEL
  });

  try {
    const response = await runChatModel(CHAT_MODEL, {
      max_tokens: REQUEST_CONTEXTUALIZER_MAX_TOKENS,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Bạn là bộ làm rõ yêu cầu theo ngữ cảnh cho agent Zilcode/App Builder.
Chỉ trả về MỘT JSON object ngắn gọn. Không trả lời trực tiếp người dùng.

Nhiệm vụ duy nhất:
- Đọc câu hiện tại cùng lịch sử hội thoại gần đây.
- Giải quyết các tham chiếu như "nó", "đó", "app vừa rồi", "window này" khi lịch sử chỉ ra duy nhất một đối tượng.
- Viết lại yêu cầu thành một câu độc lập, rõ ràng, vẫn giữ đúng mục đích và mức độ hành động của người dùng.
- Nếu không thể xác định chắc đối tượng hoặc ý định, yêu cầu hỏi lại thay vì tự đoán.

Không chọn tool. Không phân loại intent. Không quyết định đọc/ghi. Không thực hiện hành động.

Schema output bắt buộc:
{
  "rewritten_message": string,
  "needs_clarification": boolean,
  "clarification_question": string | null,
  "resolved_references": [
    {"type": string, "id": string, "name": string, "source": string}
  ]
}

Quy tắc bắt buộc:
- Không thêm ID, tên, đối tượng, giá trị mới hoặc hành động không có căn cứ trong câu hiện tại/lịch sử.
- Giữ nguyên phủ định và mức độ yêu cầu. "Hướng dẫn cách xóa" vẫn là hỏi hướng dẫn, không được viết thành "xóa". "Đừng xóa" không được viết thành yêu cầu xóa.
- Chỉ resolve tham chiếu khi có đúng một đối tượng phù hợp. Nếu có nhiều khả năng, đặt needs_clarification=true.
- Nếu câu hiện tại đã rõ, chỉ viết lại tối thiểu; không mở rộng yêu cầu.
- resolved_references chỉ chứa đối tượng thực sự lấy được từ câu hiện tại hoặc lịch sử. source phải nói ngắn gọn căn cứ lấy thông tin.
- Khi needs_clarification=false, clarification_question phải là null.
- Khi needs_clarification=true, clarification_question phải là một câu hỏi cụ thể và rewritten_message phải mô tả trung lập phần đã hiểu, không tự chọn một khả năng.

Ví dụ:
- Lịch sử nói app 107 là "Quản lý nhà trọ", user nói "đổi nó thành Quản lý phòng trọ" -> rewritten_message: "Đổi tên app có appid 107 từ Quản lý nhà trọ thành Quản lý phòng trọ"; resolve app 107 từ lịch sử.
- User nói "hướng dẫn tôi xóa app" -> rewritten_message vẫn phải là "Hướng dẫn quy trình xóa app", không phải yêu cầu xóa app.
- User nói "xóa nó" nhưng lịch sử có cả app và window -> needs_clarification=true và hỏi user muốn xóa đối tượng nào.
- User nói "hệ thống hiện có gì" -> giữ nguyên ý nghĩa, không tự thêm phạm vi hoặc đối tượng.`
        },
        {
          role: "user",
          content: JSON.stringify({
            history: summarizeHistoryForContextualizer(chatHistory),
            user_message: userMessage
          })
        }
      ]
    }, env);

    const contextualized = parseContextualizedRequest(response.response ?? "") ?? fallbackContextualizedRequest(userMessage);
    addDebugStep(debugSteps, "agent.request_contextualizer", contextualized.valid ? "ok" : "skip", "Đã làm rõ yêu cầu người dùng.", {
      valid: contextualized.valid,
      rewritten_message_chars: contextualized.rewritten_message.length,
      needs_clarification: contextualized.needs_clarification,
      resolved_references: contextualized.resolved_references
    });
    return contextualized;
  } catch (error) {
    const contextualized = fallbackContextualizedRequest(userMessage);
    addDebugStep(debugSteps, "agent.request_contextualizer", "error", "Không làm rõ được yêu cầu; dùng nguyên văn câu người dùng.", {
      error: error instanceof Error ? error.message : String(error),
      rewritten_message_chars: contextualized.rewritten_message.length
    });
    return contextualized;
  }
}

function isInstructionalRequest(message: string): boolean {
  const text = normalizeVietnameseText(message);
  return /(huong dan|chi toi cach|cho toi biet cach|cach de|lam sao|lam the nao|quy trinh|can lam gi|how to)/.test(text);
}

function hasNegatedWriteRequest(message: string): boolean {
  const text = normalizeVietnameseText(message);
  return /(dung|khong|chua|khong duoc|khong can)\s+(?:\S+\s+){0,4}(tao|them|sua|doi ten|cap nhat|xoa|delete|remove|rename|update|create|add|apply|thuc hien)/.test(text);
}

export function isExplicitWriteRequest(message: string): boolean {
  const text = normalizeVietnameseText(message);
  if (!text || isInstructionalRequest(message) || hasNegatedWriteRequest(message)) return false;

  const hasWriteVerb = /(tao|them|sua|doi ten|cap nhat|xoa|delete|remove|rename|update|create|add|apply|thuc hien|tien hanh)/.test(text);
  if (!hasWriteVerb) return false;

  return /^(?:(?:bay gio|xin|ban|hay|vui long|giup toi|thu|ban co the)\s+)*(tao|them|sua|doi ten|cap nhat|xoa|delete|remove|rename|update|create|add|apply|thuc hien|tien hanh)/.test(text)
    || /(toi|minh)\s+(muon|can|yeu cau|nho)\s+(?:\S+\s+){0,4}(tao|them|sua|doi ten|cap nhat|xoa|delete|remove|rename|update|create|add|apply|thuc hien|tien hanh)/.test(text)
    || isPrepareChangeRequest(message);
}

export function isWriteRequestAllowed(
  originalMessage: string,
  clarifiedMessage: string,
  chatHistory: AIMessage[],
  resolvedReferences: ResolvedReference[] = []
): boolean {
  if (isExplicitWriteRequest(originalMessage)) return true;
  if (!isExplicitWriteRequest(clarifiedMessage)) return false;
  if (resolvedReferences.length === 0) return false;

  return chatHistory
    .slice(-6)
    .some(message => message.role === "user" && isExplicitWriteRequest(message.content ?? ""));
}

function isToolCallAllowedByPolicy(
  toolName: string,
  originalMessage: string,
  clarifiedMessage: string,
  chatHistory: AIMessage[],
  resolvedReferences: ResolvedReference[]
): boolean {
  if (toolName === "app_builder_prepare_change") {
    return isWriteRequestAllowed(originalMessage, clarifiedMessage, chatHistory, resolvedReferences);
  }
  if (toolName === "app_builder_apply_change") {
    return isPlanConfirmation(originalMessage) && Boolean(findImmediatePreviousPlanId(chatHistory));
  }
  return true;
}

function hasAppBuilderWriteResult(toolResults: ToolResultRecord[]): boolean {
  return toolResults.some(result => isAppBuilderWriteTool(result.name));
}

async function executeTool(
  tool: ToolCall,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[],
  zilcodeSession?: ZilcodeSessionState | null
): Promise<ToolExecutionResult> {
  switch (tool.name) {
    case "general_chat": {
      const message = getStringArg(tool.arguments, "message");
      if (!message) return { content: "Lỗi: bắt buộc phải có tin nhắn để trả lời." };

      addDebugStep(debugSteps, "tool.general_chat", "start", "Gọi model chat thông thường.", {
        model: GENERAL_CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const response = await runChatModel(GENERAL_CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Bạn là trợ lý hội thoại.
Trả lời trực tiếp bằng cùng ngôn ngữ với người hỏi, trừ khi người hỏi yêu cầu ngôn ngữ khác.
Dùng kiến thức sẵn có cho câu hỏi chung.
Không nhắc đến tool/function nội bộ.`
          },
          ...chatHistory,
          { role: "user", content: message }
        ]
      }, env);

      addDebugStep(debugSteps, "tool.general_chat", "ok", "general_chat trả kết quả.", {
        response_chars: (response.response ?? "").length
      });

      return { content: response.response ?? "Không tạo được câu trả lời." };
    }

    case "rag_search": {
      const query = getStringArg(tool.arguments, "query");
      if (!query) return { content: "Lỗi: bắt buộc phải có câu truy vấn." };
      return searchRag(query, env, chatHistory, debugSteps);
    }

    case "app_builder_graph_overview":
    case "app_builder_graph_search":
    case "app_builder_graph_subgraph":
    case "app_builder_node_detail":
    case "app_builder_creation_schema": {
      if (tool.name !== "app_builder_creation_schema" && !zilcodeSession) {
        return noZilcodeSessionResult();
      }

      addDebugStep(debugSteps, `tool.${tool.name}`, "start", `Gọi ${tool.name}.`, {
        arguments: tool.arguments
      });

      const result = await runAppBuilderGraphTool(
        env,
        zilcodeSession?.session ?? null,
        tool.name,
        tool.arguments
      );
      const graph = asRecord(result.graph);

      addDebugStep(debugSteps, `tool.${tool.name}`, "ok", `${tool.name} tra ket qua.`, {
        mode: result.mode,
        graph_nodes: Array.isArray(graph?.nodes) ? graph.nodes.length : undefined,
        graph_edges: Array.isArray(graph?.edges) ? graph.edges.length : undefined,
        matches_count: result.matches_count,
        has_error: Boolean(result.error)
      });

      return { content: JSON.stringify(result, null, 2) };
    }

    case "app_builder_prepare_change":
    case "app_builder_apply_change": {
      if (!zilcodeSession) return noZilcodeSessionResult();

      addDebugStep(debugSteps, `tool.${tool.name}`, "start", `Gọi ${tool.name}.`, {
        arguments: tool.arguments
      });

      const result = await runAppBuilderWriteTool(
        env,
        zilcodeSession.session,
        tool.name,
        tool.arguments
      );

      addDebugStep(debugSteps, `tool.${tool.name}`, "ok", `${tool.name} tra ket qua.`, {
        mode: result.mode,
        status: result.status,
        ok: result.ok,
        plan_id: result.plan_id,
        has_error: Boolean(result.error)
      });

      return { content: JSON.stringify(result, null, 2) };
    }

    default:
      return { content: `Không nhận diện được công cụ: ${tool.name}` };
  }
}

function formatToolResultsForFinalAnswer(toolResults: ToolResultRecord[]): string {
  return toolResults
    .map((result, index) => [
      `[TOOL_RESULT ${index + 1}: ${result.name}]`,
      compactToolContentForFinalAnswer(result),
      `[END_TOOL_RESULT ${index + 1}]`
    ].join("\n"))
    .join("\n\n");
}

function compactToolContentForFinalAnswer(result: ToolResultRecord): string {
  if (!isAppBuilderGraphTool(result.name)) return result.content;

  try {
    const data = JSON.parse(result.content) as Record<string, unknown>;
    const graph = asRecord(data.graph);
    const nodes = Array.isArray(graph?.nodes)
      ? graph.nodes
        .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object")
        .map(node => ({
          id: node.id,
          type: node.type,
          label: node.label,
          summary: node.summary,
          counts: node.counts,
          has_detail: node.has_detail
        }))
      : undefined;
    const edges = Array.isArray(graph?.edges)
      ? graph.edges
        .filter((edge): edge is Record<string, unknown> => Boolean(edge) && typeof edge === "object")
        .map(edge => ({
          from: edge.from,
          to: edge.to,
          type: edge.type,
          metadata: edge.metadata
        }))
      : undefined;

    const mode = String(data.mode ?? "");
    if (mode === "overview") {
      return JSON.stringify({
        mode,
        description: data.description,
        session: compactSessionForAnswer(asRecord(data.session)),
        scan: data.scan,
        graph_counts: graph ? {
          node_counts: graph.node_counts,
          edge_counts: graph.edge_counts,
          nodes_count: graph.nodes_count,
          edges_count: graph.edges_count
        } : undefined,
        apps: nodes?.filter(node => node.type === "app"),
        root: nodes?.find(node => node.type === "root"),
        answer_facts: compactAnswerFactsForFinalAnswer(data.answer_facts),
        errors: data.errors,
        truncated: data.truncated
      }, null, 2);
    }

    if (mode === "search") {
      return JSON.stringify({
        mode,
        query: data.query,
        types: data.types,
        matches_count: data.matches_count,
        matches: compactRecordArrayForFinalAnswer(data.matches, 12),
        hint: data.hint
      }, null, 2);
    }

    if (mode === "creation_schema") {
      return JSON.stringify({
        mode,
        intent: data.intent,
        status: data.status,
        note: data.note,
        graph_first_rule: data.graph_first_rule,
        create_app_branch: data.create_app_branch,
        edit_existing_branch: data.edit_existing_branch,
        proposed_plan_format: data.proposed_plan_format
      }, null, 2);
    }

    if (mode === "subgraph") {
      return JSON.stringify({
        mode,
        start_node_ids: data.start_node_ids,
        depth: data.depth,
        answer_facts: compactAnswerFactsForFinalAnswer(data.answer_facts),
        graph_summary: graph ? {
          node_counts: graph.node_counts,
          edge_counts: graph.edge_counts,
          nodes_count: graph.nodes_count,
          edges_count: graph.edges_count
        } : undefined,
        graph_counts: data.graph_counts,
        missing_node_ids: data.missing_node_ids,
        cache: data.cache
      }, null, 2);
    }

    if (mode === "detail") {
      return JSON.stringify({
        mode,
        requested_node_id: data.requested_node_id,
        resolved_from: data.resolved_from,
        node: compactValueForFinalAnswer(data.node),
        answer_facts: compactAnswerFactsForFinalAnswer(data.answer_facts),
        detail: compactValueForFinalAnswer(data.detail),
        neighbors: compactValueForFinalAnswer(data.neighbors),
        cache: data.cache
      }, null, 2);
    }

    return JSON.stringify({
      ...data,
      graph: graph ? {
        node_counts: graph.node_counts,
        edge_counts: graph.edge_counts,
        nodes_count: graph.nodes_count,
        edges_count: graph.edges_count,
        nodes,
        edges
      } : undefined
    }, null, 2);
  } catch {
    return result.content;
  }
}

function compactSessionForAnswer(session: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!session) return undefined;
  return {
    base_url: session.base_url,
    user: session.user,
    roleid: session.roleid,
    role_name: session.role_name,
    orgid: session.orgid,
    org_name: session.org_name
  };
}

function compactAnswerFactsForFinalAnswer(value: unknown): unknown {
  const facts = asRecord(value);
  if (!facts) return value;

  return {
    scope: compactValueForFinalAnswer(facts.scope),
    flow_summary: compactScalarArrayForFinalAnswer(facts.flow_summary, 8),
    tables_summary: compactRecordArrayForFinalAnswer(facts.tables_summary, 12),
    windows_summary: compactRecordArrayForFinalAnswer(facts.windows_summary, 12),
    menus_summary: compactRecordArrayForFinalAnswer(facts.menus_summary, 10),
    permissions_summary: compactRecordArrayForFinalAnswer(facts.permissions_summary, 10),
    runtime_summary: compactValueForFinalAnswer(facts.runtime_summary),
    workflow_summary: compactRecordArrayForFinalAnswer(facts.workflow_summary, 10),
    report_summary: compactRecordArrayForFinalAnswer(facts.report_summary, 10),
    map_layer_summary: compactRecordArrayForFinalAnswer(facts.map_layer_summary, 10),
    user_org_summary: compactValueForFinalAnswer(facts.user_org_summary),
    site_summary: compactRecordArrayForFinalAnswer(facts.site_summary, 8),
    archive_summary: compactRecordArrayForFinalAnswer(facts.archive_summary, 10),
    verified_relations: compactRecordArrayForFinalAnswer(facts.verified_relations, 24),
    dependency_summary: compactValueForFinalAnswer(facts.dependency_summary),
    write_contract_summary: compactValueForFinalAnswer(facts.write_contract_summary),
    creation_readiness: compactValueForFinalAnswer(facts.creation_readiness),
    operation_plan_facts: compactValueForFinalAnswer(facts.operation_plan_facts),
    inferred_notes: compactScalarArrayForFinalAnswer(facts.inferred_notes, 8),
    truncated: facts.truncated
  };
}

function compactScalarArrayForFinalAnswer(value: unknown, limit: number): unknown {
  const items = toArrayValues(value);
  if (!items.length) return Array.isArray(value) ? [] : value;

  return {
    count: items.length,
    items: items.slice(0, limit).map(item => String(item)),
    truncated: items.length > limit
  };
}

function compactRecordArrayForFinalAnswer(value: unknown, limit = FINAL_ANSWER_ARRAY_LIMIT): unknown {
  const records = recordArray(value);
  if (!records.length) return Array.isArray(value) ? [] : value;

  return {
    count: records.length,
    items: records.slice(0, limit).map(record => compactValueForFinalAnswer(record, 1)),
    truncated: records.length > limit
  };
}

function compactValueForFinalAnswer(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value
        .slice(0, FINAL_ANSWER_ARRAY_LIMIT)
        .map(item => depth >= FINAL_ANSWER_RECURSION_LIMIT
          ? compactLeafForFinalAnswer(item)
          : compactValueForFinalAnswer(item, depth + 1)),
      truncated: value.length > FINAL_ANSWER_ARRAY_LIMIT
    };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const compact: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, FINAL_ANSWER_OBJECT_KEY_LIMIT)) {
    compact[key] = depth >= FINAL_ANSWER_RECURSION_LIMIT
      ? compactLeafForFinalAnswer(entryValue)
      : compactValueForFinalAnswer(entryValue, depth + 1);
  }
  if (entries.length > FINAL_ANSWER_OBJECT_KEY_LIMIT) {
    compact._truncated_keys = entries.length - FINAL_ANSWER_OBJECT_KEY_LIMIT;
  }
  return compact;
}

function compactLeafForFinalAnswer(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return { count: value.length };
  return { keys: Object.keys(value as Record<string, unknown>).slice(0, FINAL_ANSWER_OBJECT_KEY_LIMIT) };
}

function isUnusableModelAnswer(answer: string): boolean {
  const text = normalizeVietnameseText(answer).replace(/[.!?]+$/g, "").trim();
  return !text
    || text === "khong tao duoc cau tra loi"
    || text === "khong the tao duoc cau tra loi"
    || text === "khong co cau tra loi";
}

function createGraphFactsFallbackAnswer(userMessage: string, toolResults: ToolResultRecord[]): string | null {
  const graphResult = [...toolResults].reverse().find(result => isAppBuilderGraphTool(result.name));
  if (!graphResult) return null;

  try {
    const data = JSON.parse(graphResult.content) as Record<string, unknown>;
    const facts = asRecord(data.answer_facts);
    if (!facts) return null;

    const flowSummary = toArrayValues(facts.flow_summary).map(String).filter(Boolean).slice(0, 5);
    const tables = recordArray(facts.tables_summary);
    const windows = recordArray(facts.windows_summary);
    const menus = recordArray(facts.menus_summary);
    const permissions = recordArray(facts.permissions_summary);
    const workflows = recordArray(facts.workflow_summary);
    const reports = recordArray(facts.report_summary);
    const mapLayers = recordArray(facts.map_layer_summary);
    const sites = recordArray(facts.site_summary);
    const archives = recordArray(facts.archive_summary);
    const relations = recordArray(facts.verified_relations);
    const inferredNotes = toArrayValues(facts.inferred_notes).map(String).filter(Boolean).slice(0, 5);
    const scope = asRecord(facts.scope);
    const nodeTypes = asRecord(scope?.node_types);

    const lines: string[] = [
      "Tôi đã đọc được cấu trúc liên quan trong App Builder. Tóm tắt ngắn từ dữ liệu đã thấy:"
    ];

    if (flowSummary.length) {
      lines.push("", "Đã thấy trong graph:");
      lines.push(...flowSummary.map(item => `- ${item}`));
    }

    const scopeLine = summarizeScopeTypes(nodeTypes);
    if (scopeLine) lines.push(`- Phạm vi đọc gồm: ${scopeLine}.`);
    if (tables.length) lines.push(`- Bảng nổi bật: ${summarizeFactLabels(tables, 6)}.`);
    if (windows.length) lines.push(`- Window nổi bật: ${summarizeFactLabels(windows, 6)}.`);
    if (menus.length) lines.push(`- Menu nổi bật: ${summarizeFactLabels(menus, 5)}.`);
    if (permissions.length) lines.push(`- Quyền/truy cập thấy được: ${summarizeFactLabels(permissions, 5)}.`);
    if (workflows.length) lines.push(`- Workflow thấy được: ${summarizeFactLabels(workflows, 5)}.`);
    if (reports.length) lines.push(`- Report thấy được: ${summarizeFactLabels(reports, 5)}.`);
    if (mapLayers.length) lines.push(`- Map/layer thấy được: ${summarizeFactLabels(mapLayers, 5)}.`);
    if (sites.length) lines.push(`- Site thấy được: ${summarizeFactLabels(sites, 4)}.`);
    if (archives.length) lines.push(`- Archive metadata thấy được: ${summarizeFactLabels(archives, 4)}.`);
    if (relations.length) lines.push(`- Quan hệ đã xác minh: ${relations.length} cạnh quan trọng trong phạm vi đọc.`);

    const normalizedQuestion = normalizeVietnameseText(userMessage);
    if (/(bo sung|de xuat|hoan chinh|toi uu|can them|hop ly)/.test(normalizedQuestion)) {
      lines.push("", "Khuyến nghị thận trọng:");
      if (!menus.length) lines.push("- Chưa thấy menu rõ trong phạm vi này; nên kiểm tra app đã có menu dẫn tới các window chính chưa.");
      if (!permissions.length) lines.push("- Chưa thấy đầy đủ roleapp/rolemenu/access trong phạm vi này; nên rà lại quyền app, quyền menu và quyền bảng trước khi đưa vào dùng thật.");
      if (!relations.length) lines.push("- Chưa thấy nhiều quan hệ đã xác minh; nên mở sâu vào các window/table chính để kiểm tra tab -> table, field -> column và domain/lookup.");
      if (inferredNotes.length) lines.push(...inferredNotes.map(note => `- ${note}`));
      if (menus.length && permissions.length && relations.length && !inferredNotes.length) {
        lines.push("- Nên đi sâu vào từng window chính để kiểm tra field bắt buộc, domain/lookup, menu liên kết và quyền truy cập theo vai trò.");
      }
    } else if (inferredNotes.length) {
      lines.push("", "Suy luận/ghi chú:");
      lines.push(...inferredNotes.map(note => `- ${note}`));
    }

    return lines.join("\n").trim();
  } catch {
    return null;
  }
}

function summarizeScopeTypes(nodeTypes: Record<string, unknown> | null): string {
  if (!nodeTypes) return "";
  return Object.entries(nodeTypes)
    .filter(([, count]) => Number(count) > 0)
    .slice(0, 10)
    .map(([type, count]) => `${String(count)} ${type}`)
    .join(", ");
}

function summarizeFactLabels(records: Record<string, unknown>[], limit: number): string {
  const labels = records
    .slice(0, limit)
    .map(record => String(
      record.label
      ?? record.name
      ?? record.appname
      ?? record.windowname
      ?? record.tablename
      ?? record.menuname
      ?? record.workflowname
      ?? record.stepname
      ?? record.reportname
      ?? record.mapname
      ?? record.layername
      ?? record.sitename
      ?? record.username
      ?? record.fullname
      ?? record.orgname
      ?? record.id
      ?? ""
    ))
    .filter(Boolean);
  const suffix = records.length > labels.length ? `, ... (${records.length} mục)` : "";
  return `${labels.join(", ")}${suffix}`;
}

function createDeterministicChangeAnswer(toolResults: ToolResultRecord[]): string | null {
  const last = [...toolResults].reverse().find(result => isAppBuilderWriteTool(result.name));
  if (!last) return null;

  try {
    const data = JSON.parse(last.content) as Record<string, unknown>;
    if (last.name === "app_builder_prepare_change") {
      if (data.valid === false || data.status === "invalid") {
        const errors = Array.isArray(data.blocking_errors) ? data.blocking_errors : [];
      return [
        "Kế hoạch chưa hợp lệ nên tôi chưa ghi dữ liệu vào Zilcode.",
        "",
        "Lỗi cần xử lý:",
        ...errors.map((error, index) => `${index + 1}. ${String(error)}`),
        "",
        "Hãy bổ sung thông tin hoặc cho phép tôi lập lại plan với cấu trúc rõ hơn."
      ].join("\n").trim();
      }

      const operations = Array.isArray(data.operations)
        ? data.operations.filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object")
        : [];
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];

      return [
        "Tôi đã chuẩn bị kế hoạch App Builder và chưa ghi dữ liệu vào hệ thống.",
        `Plan ID: ${String(data.plan_id ?? "")}`,
        `Tổng số bước: ${operations.length}.`,
        "",
        "Các bước sẽ thực hiện:",
        ...operations.slice(0, 12).map((operation, index) => `${index + 1}. ${String(operation.label ?? operation.id ?? "operation")}`),
        operations.length > 12 ? `... và ${operations.length - 12} bước nữa.` : "",
        warnings.length ? "" : "",
        warnings.length ? "Lưu ý:" : "",
        ...warnings.slice(0, 6).map(warning => `- ${String(warning)}`),
        "",
        "Nếu bạn đồng ý, hãy trả lời: \"có, thực hiện kế hoạch\"."
      ].filter(Boolean).join("\n");
    }

    if (last.name === "app_builder_apply_change") {
      if (data.ok === true) {
        return [
          "Đã thực hiện xong kế hoạch App Builder.",
          `Plan ID: ${String(data.plan_id ?? "")}`,
          `Số bước đã ghi: ${String(data.applied_count ?? 0)}.`,
          "",
          "Bước tiếp theo nên làm là đọc lại App Builder graph để kiểm tra thay đổi đã đúng."
        ].join("\n");
      }

      const results = Array.isArray(data.results)
        ? data.results.filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === "object")
        : [];
      const failedOperation = data.failed_operation && typeof data.failed_operation === "object" && !Array.isArray(data.failed_operation)
        ? data.failed_operation as Record<string, unknown>
        : undefined;
      const failed = failedOperation ?? results.find(result => result.ok === false);
      const appliedOperations = Array.isArray(data.applied_operations)
        ? data.applied_operations.filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object")
        : [];
      const skippedOperations = Array.isArray(data.skipped_operations)
        ? data.skipped_operations.filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object")
        : [];

      return [
        "Kế hoạch chưa được thực hiện thành công.",
        `Đã ghi được: ${String(data.applied_count ?? 0)} bước.`,
        `Số bước lỗi: ${String(data.failed_count ?? 0)}.`,
        `Số bước bị bỏ qua: ${String(data.skipped_count ?? skippedOperations.length)}.`,
        failed ? `Dừng tại: ${String(failed.operation_id ?? "")}.` : "",
        "",
        failed ? `Lỗi chính: ${String(failed.error ?? data.error ?? "Không rõ lỗi.")}` : `Lỗi chính: ${String(data.error ?? "Không rõ lỗi.")}`,
        appliedOperations.length ? "" : "",
        appliedOperations.length ? "Các bước đã ghi cần kiểm tra/cleanup nếu sửa plan:" : "",
        ...appliedOperations.slice(0, 8).map(operation => `- ${String(operation.label ?? operation.operation_id ?? "")}`),
        skippedOperations.length ? "" : "",
        skippedOperations.length ? "Các bước chưa chạy:" : "",
        ...skippedOperations.slice(0, 8).map(operation => `- ${String(operation.label ?? operation.operation_id ?? "")}`),
        "",
        data.pending_plan_deleted === true ? "Plan cũ đã được vô hiệu hóa để tránh apply lặp gây tạo trùng." : "",
        "Tôi chưa coi thay đổi này là hoàn tất. Cần đọc lại graph, sửa plan theo lỗi trên rồi chuẩn bị kế hoạch mới."
      ].filter(Boolean).join("\n");
    }
  } catch {
    return null;
  }

  return null;
}

function extractActionStateFromToolResults(toolResults: ToolResultRecord[]): AgentActionState | undefined {
  const last = [...toolResults].reverse().find(result => isAppBuilderWriteTool(result.name));
  if (!last) return undefined;

  try {
    const data = JSON.parse(last.content) as Record<string, unknown>;
    const planId = typeof data.plan_id === "string" ? data.plan_id : undefined;
    const base: AgentActionState = {
      kind: last.name === "app_builder_apply_change" ? "apply_change" : "prepare_change",
      plan_id: planId,
      status: typeof data.status === "string" ? data.status : undefined,
      updated_at: new Date().toISOString()
    };

    if (last.name === "app_builder_prepare_change") {
      return {
        ...base,
        valid: typeof data.valid === "boolean" ? data.valid : undefined,
        requires_confirmation: typeof data.requires_confirmation === "boolean" ? data.requires_confirmation : undefined,
        summary: data.summary,
        operations: data.operations,
        error: typeof data.error === "string" ? data.error : undefined
      };
    }

    return {
      ...base,
      ok: typeof data.ok === "boolean" ? data.ok : undefined,
      applied_count: typeof data.applied_count === "number" ? data.applied_count : undefined,
      failed_count: typeof data.failed_count === "number" ? data.failed_count : undefined,
      skipped_count: typeof data.skipped_count === "number" ? data.skipped_count : undefined,
      error: typeof data.error === "string" ? data.error : undefined
    };
  } catch {
    return undefined;
  }
}

function withActionState(result: AgenticLoopResult, toolResults: ToolResultRecord[]): AgenticLoopResult {
  const actionState = extractActionStateFromToolResults(toolResults);
  return actionState ? { ...result, action_state: actionState } : result;
}

function isStrongSearchMatch(match: Record<string, unknown> | undefined): boolean {
  if (!match) return false;
  const score = Number(match.score ?? 0);
  return Number.isFinite(score) && score >= 70;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return toArrayValues(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function extractIdSuffix(value: unknown): string {
  const text = String(value ?? "");
  const parts = text.split(":");
  return parts[parts.length - 1] || text;
}

function truncateToolContext(context: string): string {
  if (context.length <= TOOL_RESULT_CONTEXT_MAX_CHARS) return context;

  return [
    context.slice(0, TOOL_RESULT_CONTEXT_MAX_CHARS).trim(),
    "",
    `[SYSTEM_NOTE: Tool context was truncated. Original length: ${context.length} chars.]`
  ].join("\n");
}

function cleanMarkdownArtifacts(answer: string): string {
  return answer
    .replace(/\[\s*\{\s*['"]type['"]\s*:\s*['"]tool['"][\s\S]*?\}\s*\]/g, "")
    .replace(/\{\s*['"]type['"]\s*:\s*['"]tool['"][\s\S]*?\}/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .trim();
}

export function shouldContinueAfterToolResult(toolName: string, toolResult: string, userMessage: string): boolean {
  if (!GRAPH_CONTINUE_TOOLS.has(toolName)) return false;

  const intent = inferGraphQuestionIntent(userMessage);
  if (!["deep_dive", "relationship", "detail", "count", "overview"].includes(intent)) return false;

  try {
    const data = JSON.parse(toolResult) as Record<string, unknown>;
    if (String(data.mode ?? "") !== "search") return false;
    const matchesCount = Number(data.matches_count ?? 0);
    if (matchesCount === 0) return true;
    if (matchesCount === 1) return true;
    const matches = recordArray(data.matches);
    return isStrongSearchMatch(matches[0]);
  } catch {
    return false;
  }
}

function isPlanConfirmation(message: string): boolean {
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/^(co|yes|ok|dong y)$/i.test(text)) return true;
  return /^(co|yes|ok|dong y|thuc hien|hay thuc hien)/.test(text)
    && /(thuc hien|tien hanh|ke hoach|apply|chay|tao|sua|xoa|cap nhat)/.test(text);
}

function findImmediatePreviousPlanId(chatHistory: AIMessage[]): string | null {
  const previous = [...chatHistory].reverse().find(message => message.role === "assistant" && (message.content ?? "").trim());
  const match = previous?.content?.match(/Plan ID:\s*([0-9a-fA-F-]{16,})/);
  return match?.[1] ?? null;
}

function normalizeVietnameseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

type GraphQuestionIntent =
  | "overview"
  | "search_only"
  | "deep_dive"
  | "relationship"
  | "detail"
  | "count"
  | "unknown";

export function inferGraphQuestionIntent(message: string): GraphQuestionIntent {
  const text = normalizeVietnameseText(message);

  if (/(bao nhieu|so luong|count|co may)/.test(text)) return "count";
  if (/(luong|flow|lien ket|ket noi|quan he|dung bang|bang nao|map|lookup|domain)/.test(text)) return "relationship";
  if (/(\bdi sau\b|phan tich|xem ky|xem sau|noi ro|giai thich|mo ta|cau truc|tong quan chi tiet)/.test(text)) return "deep_dive";
  if (/(chi tiet|field|truong|cot|column|tab|menu|cache|quyen|role|access)/.test(text)) return "detail";
  if (/(he thong|tong quan|dang co nhung gi|co nhung gi|danh sach app|cac app|nhung app|ung dung nao|app nao)/.test(text)) return "overview";
  if (/(tim|search|node|id)/.test(text)) return "search_only";

  return "unknown";
}

function extractWindowDeleteIdFromText(value: string): string | null {
  const normalized = normalizeVietnameseText(value);
  const patterns = [
    /\bwindow\s*[:#=]?\s*(\d+)\b/,
    /\bwindow\s*id\s*[:#=]?\s*(\d+)\b/,
    /\bwindowid\s*[:#=]?\s*(\d+)\b/,
    /\bcua so\s*[:#=]?\s*(\d+)\b/,
    /\bcua so\s*id\s*[:#=]?\s*(\d+)\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isDeleteWindowIntent(message: string): boolean {
  const text = normalizeVietnameseText(message);
  return /(xoa|delete|remove)/.test(text)
    && /(window|windowid|cua so)/.test(text)
    && Boolean(extractWindowDeleteIdFromText(message));
}

function isPrepareChangeRequest(message: string): boolean {
  const text = normalizeVietnameseText(message);
  return text.includes("app_builder_prepare_change")
    || text.includes("prepare change")
    || text.includes("prepare_change")
    || text.includes("tao plan")
    || text.includes("chuan bi plan")
    || text.includes("lap plan");
}

function extractCreateAppRequest(message: string): { appName: string } | null {
  const normalized = normalizeVietnameseText(message);
  const wantsCreate = /(tao|them|create|add)/.test(normalized);
  const mentionsApp = /\bapp\b/.test(normalized) || normalized.includes("ung dung");
  if (!wantsCreate || !mentionsApp) return null;
  if (/(window|cua so|table|bang|field|truong|cot|column)/.test(normalized)) {
    return null;
  }

  const quoted = message.match(/["“]([^"”\n]+)["”]/);
  const explicitName = quoted?.[1]?.trim()
    || message.match(/\bapp\s+(?:mới\s+|moi\s+)?([^,.;\n]+?)(?:\s+(?:với|voi|gồm|gom|các|cac|bảng|bang|window|cửa|cua)\b|[,.;]|$)/i)?.[1]?.trim()
    || message.match(/(?:ứng dụng|ung dung)\s+([^,.;\n]+?)(?:\s+(?:với|voi|gồm|gom|các|cac|bảng|bang|window|cửa|cua)\b|[,.;]|$)/i)?.[1]?.trim();

  return { appName: explicitName || "Ứng dụng mới" };
}

function buildCreateAppOperations(request: { appName: string }): Record<string, unknown>[] {
  return [
    {
      id: "create_app_1",
      op: "create_app",
      record: {
        appname: request.appName
      }
    }
  ];
}

function extractCreateWindowRequest(message: string): {
  appName: string;
  windowName: string;
  tableName?: string;
  tabName?: string;
  menuName?: string;
  createFields: boolean;
} | null {
  const normalized = normalizeVietnameseText(message);
  const wantsCreate = /(tao|them|add|create)/.test(normalized);
  const mentionsWindow = /(window|cua so)/.test(normalized);
  if (!wantsCreate || !mentionsWindow) return null;

  const appMatch = message.match(/\bapp\s+["“]?([^"”\n,.;]+?)(?:\s+(?:từ|tu|với|voi|bảng|bang|table|window|cửa|cua)\b|["”]|\s*$|[,.;])/i)
    ?? message.match(/(?:ứng dụng|ung dung)\s+["“]?([^"”\n,.;]+?)(?:\s+(?:từ|tu|với|voi|bảng|bang|table|window|cửa|cua)\b|["”]|\s*$|[,.;])/i);
  const appName = appMatch?.[1]?.trim();
  if (!appName) return null;

  const tableMatch = message.match(/(?:bảng|bang|table)\s+["“]?([^"”\n,.;]+?)(?:["”]|\s+(?:và|va|cùng|cung|kèm|kem|menu|tab|field|trường|truong)\b|[,.;]|$)/i);
  const tableName = tableMatch?.[1]?.trim();
  const explicitWindowMatch = message.match(/(?:window|cửa sổ|cua so)\s+["“]?([^"”\n,.;]+?)(?:["”]|\s+(?:cho|của|cua|từ|tu|với|voi|bảng|bang|table)\b|[,.;]|$)/i)
    ?? message.match(/(?:tên|ten|name)\s+["“]?([^"”\n.,;]+)["”]?/i);
  let explicitWindowName = explicitWindowMatch?.[1]?.trim();
  if (explicitWindowName) {
    explicitWindowName = explicitWindowName.replace(/\s+(?:vào|vao)\s+app\b.*$/i, "").trim();
  }
  const windowName = explicitWindowName
    || (tableName ? `${tableName} Management` : (/m[aã]u/i.test(message) || normalized.includes("mau") ? "Cua so mau" : "Window moi"));
  const tabName = tableName ? tableName : undefined;
  const menuName = windowName;
  const createFields = Boolean(tableName)
    && /(field|fields|truong|trường|cot|cột|tat ca|tất cả|day du|đầy đủ)/.test(normalized);

  return { appName, windowName, tableName, tabName, menuName, createFields };
}

function extractRenameWindowRequest(message: string): { currentName: string; newName: string } | null {
  const normalized = normalizeVietnameseText(message);
  const wantsRename = /(doi ten|sua ten|rename|cap nhat ten|sua)/.test(normalized);
  const mentionsWindow = /(window|cua so)/.test(normalized);
  if (!wantsRename || !mentionsWindow) return null;

  const idMatch = message.match(/(?:window|cửa sổ|cua so)\s+(?:id\s*)?(\d+).*?(?:thành|thanh|sang|to)\s+["“]?([^"”.;,]+)["”]?/i);
  if (idMatch?.[1] && idMatch?.[2]) {
    return {
      currentName: idMatch[1].trim(),
      newName: idMatch[2].trim()
    };
  }

  const patterns = [
    /(?:cửa sổ|cua so|window)\s+["“]?([^"”]+?)["”]?\s+(?:thành|thanh|sang|to)\s+["“]?([^\s"”.,;]+)["”]?/i,
    /(?:đổi tên|doi ten|rename)\s+(?:cửa sổ|cua so|window)\s+["“]?([^"”]+?)["”]?\s+(?:thành|thanh|sang|to)\s+["“]?([^\s"”.,;]+)["”]?/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && match?.[2]) {
      return {
        currentName: match[1].trim(),
        newName: match[2].trim()
      };
    }
  }

  return null;
}

function findLatestRenameWindowRequest(chatHistory: AIMessage[]): { currentName: string; newName: string } | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role !== "user") continue;
    const request = extractRenameWindowRequest(chatHistory[i].content ?? "");
    if (request) return request;
  }
  return null;
}

interface RenameAppTarget {
  appid?: string;
  appName?: string;
}

function isRenameAppIntent(message: string): boolean {
  const normalized = normalizeVietnameseText(message);
  return /(doi ten|sua ten|rename|cap nhat ten)/.test(normalized)
    && /(app|appid|ung dung)/.test(normalized);
}

function extractRenameAppTarget(message: string): RenameAppTarget | null {
  const appidMatch = message.match(/\bapp\s*id\s*[:#=]?\s*(\d+)\b/i)
    ?? message.match(/\bappid\s*[:#=]?\s*(\d+)\b/i)
    ?? message.match(/(?:ứng dụng|ung dung|app)\s+(?:id\s*)?(\d+)\b/i);

  if (appidMatch?.[1]) {
    return { appid: appidMatch[1].trim() };
  }

  const appNameMatch = message.match(/(?:ứng dụng|ung dung|app)\s+["“]?([^"”\n,.;]+?)(?:["”]|\s+(?:thành|thanh|sang|to)\b|[,.;]|$)/i);
  const appName = appNameMatch?.[1]?.trim();
  if (!appName) return null;
  if (/^(id|appid)$/i.test(appName)) return null;
  return { appName };
}

function extractRenameNewName(message: string): string | null {
  const match = message.match(/(?:thành|thanh|sang|to)\s+["“]?([^"”\n.;]+)["”]?/i)
    ?? message.match(/(?:tên mới là|ten moi la|new name is)\s+["“]?([^"”\n.;]+)["”]?/i);
  const value = match?.[1]?.trim();
  if (!value) return null;
  return value.replace(/\s+(?:nhé|nhe|giúp tôi|giup toi)$/i, "").trim() || null;
}

function findLatestRenameAppTarget(chatHistory: AIMessage[]): RenameAppTarget | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role !== "user") continue;
    const content = chatHistory[i].content ?? "";
    if (!isRenameAppIntent(content) && !extractRenameAppTarget(content)) continue;
    const target = extractRenameAppTarget(content);
    if (target) return target;
  }
  return null;
}

function findLatestRenameAppNewName(chatHistory: AIMessage[]): string | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role !== "user") continue;
    const newName = extractRenameNewName(chatHistory[i].content ?? "");
    if (newName) return newName;
  }
  return null;
}

function extractAppNameFromText(message: string): string | null {
  const match = message.match(/\bapp\s+([^\-,.;\n]+)/i)
    ?? message.match(/ung dung\s+([^\-,.;\n]+)/i)
    ?? message.match(/ứng dụng\s+([^(\n,.;-]+)/i);
  return match?.[1]?.trim() || null;
}

function findLatestAppName(chatHistory: AIMessage[]): string | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const appName = extractAppNameFromText(chatHistory[i].content ?? "");
    if (appName) return appName;
  }
  return null;
}

function extractAppOrdinalReference(message: string): number | null {
  const normalized = normalizeVietnameseText(message);
  const match = normalized.match(/(?:ung dung|app)\s*(?:so|thu)?\s*(\d+)/)
    ?? normalized.match(/^so\s*(\d+)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isReadOnlyAppInfoIntent(message: string): boolean {
  const normalized = normalizeVietnameseText(message);
  if (/(tao|them|xoa|delete|remove|sua|doi|cap nhat|update|create|add)/.test(normalized)) return false;
  return /(co gi|chi tiet|bang|table|window|cua so|menu|tab|field|truong|cot|cache|quyen|role|thong tin)/.test(normalized);
}

function resolveAppOrdinalFromHistory(chatHistory: AIMessage[], ordinal: number): { appid?: string; appName?: string } | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role !== "assistant") continue;
    const lines = (message.content ?? "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
      if (!match || Number(match[1]) !== ordinal) continue;

      const raw = match[2].trim();
      const appidMatch = raw.match(/\bappid\s*[=:]\s*([0-9]+)/i);
      const appName = raw
        .replace(/\([^)]*\bappid\s*[=:]\s*[0-9]+[^)]*\)/i, "")
        .replace(/\s+-\s+.*$/, "")
        .replace(/\s*:\s+.*$/, "")
        .replace(/\.$/, "")
        .trim();
      return {
        appid: appidMatch?.[1],
        appName: appName || undefined
      };
    }
  }
  return null;
}

export function sanitizeChatHistory(history: unknown): AIMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter((message): message is ChatHistoryMessage =>
      message
      && typeof message === "object"
      && (message as ChatHistoryMessage).role !== undefined
      && ((message as ChatHistoryMessage).role === "user" || (message as ChatHistoryMessage).role === "assistant")
      && typeof (message as ChatHistoryMessage).content === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_HISTORY_CONTENT_CHARS)
    }))
    .filter(message => message.content.length > 0);
}

function buildComprehensionContext(toolResults: ToolResultRecord[]): string {
  const graphResult = [...toolResults]
    .reverse()
    .find(result => isAppBuilderGraphTool(result.name));

  if (!graphResult) return "";

  try {
    const data = JSON.parse(graphResult.content) as Record<string, unknown>;
    const facts = asRecord(data.answer_facts);
    if (!facts) return "";

    const graph = asRecord(data.graph);
    const nodes = recordArray(graph?.nodes);
    const mini = {
      mode: data.mode,
      flow_summary: toArrayValues(facts.flow_summary)
        .map(String)
        .filter(Boolean)
        .slice(0, 6),
      verified_relations: recordArray(facts.verified_relations)
        .slice(0, 10)
        .map(relation => ({
          from: relation.from,
          type: relation.type,
          to: relation.to
        })),
      inferred_notes: toArrayValues(facts.inferred_notes)
        .map(String)
        .filter(Boolean)
        .slice(0, 4),
      scope: facts.scope,
      app_names: nodes
        .filter(node => node.type === "app")
        .slice(0, 8)
        .map(node => ({
          id: node.id,
          label: node.label,
          summary: node.summary
        }))
    };

    const raw = JSON.stringify(mini, null, 2);
    if (raw.length <= COMPREHENSION_CONTEXT_MAX_CHARS) return raw;
    return `${raw.slice(0, COMPREHENSION_CONTEXT_MAX_CHARS).trim()}\n[truncated]`;
  } catch {
    return "";
  }
}

async function buildComprehension(
  toolContext: string,
  toolResults: ToolResultRecord[],
  env: Env,
  debugSteps?: DebugStep[]
): Promise<string> {
  const comprehensionContext = buildComprehensionContext(toolResults);
  const hasGraphData = comprehensionContext.length > 0;
  const inputContext = hasGraphData
    ? comprehensionContext
    : toolContext.slice(0, COMPREHENSION_CONTEXT_MAX_CHARS);

  addDebugStep(debugSteps, "pipeline.comprehension", "start", "Buoc 1: doc tool/RAG/graph data va tom tat evidence.", {
    tool_context_chars: toolContext.length,
    comprehension_context_chars: inputContext.length,
    source: hasGraphData ? "graph_facts_mini" : "tool_context_fallback"
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: 600,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn là bộ phân tích context cho trợ lý Zilcode/App Builder.
Nhiệm vụ: đọc tool/RAG/graph data bên dưới và tóm tắt thành prose ngắn gọn.

Trả lời theo cấu trúc sau, viết prose thuần, không JSON, không markdown:

NGUỒN DỮ LIỆU: Context đến từ tài liệu RAG, graph App Builder, kết quả write/change, hay nhiều nguồn kết hợp.

NỘI DUNG ĐÃ XÁC MINH: Những thông tin trực tiếp có trong context và liên quan tới câu hỏi.

LIÊN KẾT/FLOW: Nếu context có graph hoặc quan hệ, nêu các luồng đã thấy như app -> window -> tab -> table, menu -> window, role -> app/menu/table. Nếu chỉ là tài liệu hướng dẫn thì nêu quy trình/khái niệm chính từ tài liệu.

ĐIỂM CHƯA RÕ: Những phần context chưa đủ để kết luận, để bước sau không bịa.

Chỉ dùng thông tin có trong tool/RAG/graph data. Không bịa thêm. Chỉ dùng kiến thức chung nếu context thật sự cần diễn giải, và phải nói rõ đó là diễn giải.`
      },
      {
        role: "user",
        content: `Dữ liệu tool/RAG/graph:\n\n${inputContext}\n\nHãy phân tích và tóm tắt evidence theo format yêu cầu.`
      }
    ]
  }, env);

  const comprehension = response.response?.trim() ?? "";
  addDebugStep(debugSteps, "pipeline.comprehension", "ok", "Buoc 1 hoan tat.", {
    chars: comprehension.length,
    model: response.model
  });

  return comprehension;
}

async function buildReasoning(
  comprehension: string,
  userMessage: string,
  env: Env,
  debugSteps?: DebugStep[]
): Promise<string> {
  addDebugStep(debugSteps, "pipeline.reasoning", "start", "Buoc 2: xac dinh can tra loi gi.", {});

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: 400,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn là bộ lập kế hoạch trả lời cho trợ lý Zilcode/App Builder.
Bạn nhận được: (1) hiểu biết đã tóm tắt từ tool/RAG/graph data, (2) câu hỏi của user.

Nhiệm vụ: quyết định câu trả lời nên bao gồm gì. Chưa viết câu trả lời cuối.

Trả lời ngắn gọn theo cấu trúc:

LOẠI CÂU HỎI: flow/liên kết | đối tượng cụ thể | tổng quan | liệt kê | tạo/sửa/xóa | khác.

PHẦN CẦN TRẢ LỜI: Những thông tin nào từ comprehension trực tiếp trả lời câu hỏi.

ĐÃ XÁC MINH: Phần nào có bằng chứng rõ trong tool/RAG/graph data.

CẦN GHI CHÚ: Phần nào là suy luận, phần nào graph chưa đủ để kết luận.

CẤU TRÚC TRẢ LỜI: Nên bắt đầu bằng gì, diễn giải flow như thế nào, có nên liệt kê hay không.`
      },
      {
        role: "user",
        content: `Hiểu biết từ context:\n${comprehension}\n\nCâu hỏi của user: ${userMessage}`
      }
    ]
  }, env);

  const reasoning = response.response?.trim() ?? "";
  addDebugStep(debugSteps, "pipeline.reasoning", "ok", "Buoc 2 hoan tat.", {
    chars: reasoning.length
  });

  return reasoning;
}

async function buildFinalAnswerFromReasoning(
  reasoning: string,
  comprehension: string,
  userMessage: string,
  chatHistory: AIMessage[],
  env: Env,
  debugSteps?: DebugStep[]
): Promise<string> {
  addDebugStep(debugSteps, "pipeline.final_answer", "start", "Buoc 3: viet cau tra loi tu reasoning plan.", {});

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_FINAL_MAX_TOKENS,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Bạn là trợ lý Zilcode/App Builder.
Trả lời bằng ngôn ngữ của user. Nếu user viết tiếng Việt, toàn bộ câu trả lời phải là tiếng Việt.
Không dùng heading hay cụm từ tiếng Anh nếu user viết tiếng Việt.
Không nhắc đến tool/function nội bộ.

Quy tắc Zilcode:
- Quyền có 3 lớp độc lập: roleapp (vào app), rolemenu (vào menu), access (cờ trên table). Không gộp chung.
- n_cache = layout cache UI, không phải cache dữ liệu nghiệp vụ.
- Tên đúng: window / tab / field / menu. Không dùng AD_Window / AD_Tab / AD_Field.
- App Builder metadata khác runtime: SQLCloud/procedure/view là physical database, không apply được bằng App Builder metadata tool nếu không có write contract riêng.

Cách viết:
- Bắt đầu từ dữ liệu đã thấy trong tool/RAG/graph data, rồi mới diễn giải bằng kiến thức chung.
- Được dùng kiến thức chung về no-code/app-builder/ERP/CRUD/workflow để giải thích dễ hiểu, nhưng không dùng để bịa dữ liệu context chưa xác minh.
- Phân biệt rõ phần đã xác minh với phần suy luận/khuyến nghị khi câu trả lời có cả hai.
- Không kể lại JSON, không mở bằng danh sách dài nếu user không hỏi liệt kê.`
      },
      {
        role: "assistant",
        content: `Tôi đã đọc tool/RAG/graph data và hiểu như sau:\n${comprehension}`
      },
      {
        role: "assistant",
        content: `Kế hoạch trả lời:\n${reasoning}`
      },
      ...chatHistory,
      {
        role: "user",
        content: userMessage
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response?.trim() ?? "");
  addDebugStep(debugSteps, "pipeline.final_answer", "ok", "Buoc 3 hoan tat.", {
    chars: answer.length
  });

  return answer;
}

async function createFinalAnswerFromToolResults(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<string> {
  const deterministicAnswer = createDeterministicChangeAnswer(toolResults);
  if (deterministicAnswer) {
    addDebugStep(debugSteps, "tools.final_answer", "ok", "Dung deterministic answer cho write operation.", {
      answer_chars: deterministicAnswer.length
    });
    return deterministicAnswer;
  }

  const toolContext = truncateToolContext(formatToolResultsForFinalAnswer(toolResults));

  addDebugStep(debugSteps, "tools.final_answer", "start", "Bat dau 3-step final answer pipeline.", {
    model: CHAT_MODEL,
    tool_results: toolResults.map(result => result.name),
    context_chars: toolContext.length
  });

  const comprehension = await buildComprehension(toolContext, toolResults, env, debugSteps);
  if (!comprehension) {
    addDebugStep(debugSteps, "pipeline.comprehension", "error", "Comprehension rong, fallback ve answer_facts.", {});
    const fallback = createGraphFactsFallbackAnswer(userMessage, toolResults);
    return fallback ?? "Không tạo được câu trả lời.";
  }

  const reasoning = await buildReasoning(comprehension, userMessage, env, debugSteps);
  const answer = await buildFinalAnswerFromReasoning(
    reasoning,
    comprehension,
    userMessage,
    chatHistory,
    env,
    debugSteps
  );

  if (isUnusableModelAnswer(answer)) {
    addDebugStep(debugSteps, "pipeline.fallback", "ok", "Final answer khong dung duoc, dung answer_facts fallback.", {});
    const fallback = createGraphFactsFallbackAnswer(userMessage, toolResults);
    return fallback ?? "Không tạo được câu trả lời.";
  }

  addDebugStep(debugSteps, "tools.final_answer", "ok", "Pipeline 3 buoc hoan tat.", {
    answer_chars: answer.length
  });

  return answer;
}

export async function runAgenticLoop(
  userMessage: string,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[],
  zilcodeSession?: ZilcodeSessionState | null,
  mode: AgentMode = "default"
): Promise<AgenticLoopResult> {
  const activeTools = getToolsForAgentMode(mode);
  const activeToolNames = new Set<string>(activeTools.map(tool => tool.name));
  const searchOnlyMode = mode === "search";

  addDebugStep(debugSteps, "agent.start", "start", "Bắt đầu agentic loop.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    mode,
    tools: activeTools.map(tool => tool.name)
  });

  const isConfirmation = isPlanConfirmation(userMessage);
  const confirmedPlanId = isConfirmation ? findImmediatePreviousPlanId(chatHistory) : null;
  if (!searchOnlyMode && confirmedPlanId && zilcodeSession) {
    addDebugStep(debugSteps, "agent.confirmation_auto_apply", "start", "User xác nhận pending App Builder plan, tự gọi apply_change.", {
      plan_id: confirmedPlanId
    });

    const toolExecution = await executeTool(
      { name: "app_builder_apply_change", arguments: { plan_id: confirmedPlanId } },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_apply_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_apply_change"]
    }, toolResults);
  }

  const contextualizedRequest = await contextualizeUserRequest(userMessage, chatHistory, env, debugSteps);
  if (contextualizedRequest.needs_clarification) {
    return {
      answer: contextualizedRequest.clarification_question
        ?? "Bạn có thể nói rõ đối tượng hoặc hành động bạn đang muốn nhắc tới không?",
      toolsCalled: []
    };
  }

  const clarifiedUserMessage = contextualizedRequest.rewritten_message || userMessage;
  const writeShortcutAllowed = isWriteRequestAllowed(
    userMessage,
    clarifiedUserMessage,
    chatHistory,
    contextualizedRequest.resolved_references
  ) && !searchOnlyMode;

  const appOrdinal = extractAppOrdinalReference(userMessage) ?? extractAppOrdinalReference(clarifiedUserMessage);
  const ordinalApp = appOrdinal && isReadOnlyAppInfoIntent(clarifiedUserMessage)
    ? resolveAppOrdinalFromHistory(chatHistory, appOrdinal)
    : null;
  if (!searchOnlyMode && ordinalApp && zilcodeSession) {
    addDebugStep(debugSteps, "agent.app_ordinal_resolve", "start", "Resolve ứng dụng theo số thứ tự từ lịch sử hội thoại.", {
      ordinal: appOrdinal,
      appid: ordinalApp.appid,
      app_name: ordinalApp.appName
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_node_detail",
        arguments: ordinalApp.appid
          ? { node_id: `app:${ordinalApp.appid}`, include_neighbors: true, include_fields: false }
          : { query: ordinalApp.appName, include_neighbors: true, include_fields: false }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_node_detail", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return {
      answer,
      toolsCalled: ["app_builder_node_detail"]
    };
  }

  const createAppRequest = extractCreateAppRequest(clarifiedUserMessage);
  if (createAppRequest && zilcodeSession && writeShortcutAllowed) {
    const operations = buildCreateAppOperations(createAppRequest);
    addDebugStep(debugSteps, "agent.create_app_prepare", "start", "Phát hiện intent tạo app, tự tạo pending create_app plan.", {
      app_name: createAppRequest.appName,
      operations_count: operations.length
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "create_app",
          summary: `Tạo app "${createAppRequest.appName}".`,
          operations,
          max_records_per_table: "5000"
        }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_prepare_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    }, toolResults);
  }

  const renameAppIntent = isRenameAppIntent(clarifiedUserMessage);
  const renameAppTarget = extractRenameAppTarget(clarifiedUserMessage) ?? findLatestRenameAppTarget(chatHistory);
  const renameAppNewName = extractRenameNewName(clarifiedUserMessage)
    ?? ((renameAppIntent || isPlanConfirmation(userMessage)) ? findLatestRenameAppNewName(chatHistory) : null);

  if (zilcodeSession && writeShortcutAllowed && (renameAppIntent || (renameAppTarget && renameAppNewName))) {
    if (!renameAppTarget) {
      return {
        answer: "Bạn muốn đổi tên app nào? Hãy gửi appid hoặc tên app hiện tại.",
        toolsCalled: []
      };
    }
    if (!renameAppNewName) {
      const targetLabel = renameAppTarget.appid
        ? `appid ${renameAppTarget.appid}`
        : `app "${renameAppTarget.appName}"`;
      return {
        answer: `Bạn muốn đổi ${targetLabel} thành tên mới nào?`,
        toolsCalled: []
      };
    }

    const targetLabel = renameAppTarget.appid
      ? `appid ${renameAppTarget.appid}`
      : `app "${renameAppTarget.appName}"`;
    addDebugStep(debugSteps, "agent.rename_app_prepare", "start", "Detected app rename intent; creating pending update_app plan.", {
      appid: renameAppTarget.appid,
      app_name: renameAppTarget.appName,
      new_name: renameAppNewName
    });

    const operation: Record<string, unknown> = {
      id: `rename_app_${renameAppTarget.appid ?? renameAppTarget.appName ?? "target"}`,
      op: "update_app",
      record: {
        appname: renameAppNewName
      }
    };
    if (renameAppTarget.appid) {
      operation.id_value = renameAppTarget.appid;
    } else if (renameAppTarget.appName) {
      operation.target_ref = renameAppTarget.appName;
    }

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "rename_app",
          summary: `Đổi tên ${targetLabel} thành "${renameAppNewName}".`,
          operations: [operation],
          max_records_per_table: "5000"
        }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_prepare_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    }, toolResults);
  }

  const renameWindowRequest = extractRenameWindowRequest(clarifiedUserMessage)
    ?? ((normalizeVietnameseText(clarifiedUserMessage).includes("doi ten") || isConfirmation) ? findLatestRenameWindowRequest(chatHistory) : null);
  if (renameWindowRequest && zilcodeSession && writeShortcutAllowed) {
    const appName = extractAppNameFromText(clarifiedUserMessage) ?? findLatestAppName(chatHistory);
    addDebugStep(debugSteps, "agent.rename_window_prepare", "start", "Phát hiện intent đổi tên window, tự tạo pending update_window plan.", {
      current_name: renameWindowRequest.currentName,
      new_name: renameWindowRequest.newName,
      app_name: appName
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "rename_window",
          summary: `Đổi tên cửa sổ "${renameWindowRequest.currentName}" thành "${renameWindowRequest.newName}".`,
          operations: [
            {
              id: `rename_window_${renameWindowRequest.currentName}`,
              op: "update_window",
              target_ref: renameWindowRequest.currentName,
              app_name: appName,
              record: {
                windowname: renameWindowRequest.newName
              }
            }
          ],
          max_records_per_table: "5000"
        }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_prepare_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    }, toolResults);
  }

  const deleteWindowId = isDeleteWindowIntent(clarifiedUserMessage)
    ? extractWindowDeleteIdFromText(clarifiedUserMessage)
    : null;

  if (deleteWindowId && zilcodeSession && writeShortcutAllowed) {
    addDebugStep(debugSteps, "agent.delete_window_prepare", "start", "Phát hiện intent xóa window, tự tạo pending delete plan.", {
      windowid: deleteWindowId
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "delete_window",
          summary: `Xóa vĩnh viễn window ${deleteWindowId} cùng các tab, field và menu liên kết. Không xóa table/column/dữ liệu thật.`,
          operations: [
            {
              id: `delete_window_${deleteWindowId}_cascade`,
              op: "delete_window",
              id_value: deleteWindowId,
              cascade: true,
              include_related: ["tabs", "fields", "menus"]
            }
          ],
          max_records_per_table: "5000"
        }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_prepare_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    }, toolResults);
  }

  const createWindowRequest = extractCreateWindowRequest(clarifiedUserMessage);
  if (createWindowRequest && zilcodeSession && writeShortcutAllowed) {
    addDebugStep(debugSteps, "agent.create_window_prepare", "start", "Phát hiện intent tạo window, tự tạo pending create_window plan.", {
      app_name: createWindowRequest.appName,
      window_name: createWindowRequest.windowName,
      table_name: createWindowRequest.tableName,
      create_fields: createWindowRequest.createFields
    });

    const operations: Record<string, unknown>[] = [
      {
        id: "create_window_1",
        op: "create_window",
        record: {
          app_name: createWindowRequest.appName,
          windowname: createWindowRequest.windowName,
          windowtype: "window"
        }
      }
    ];

    if (createWindowRequest.tableName) {
      operations.push({
        id: "create_tab_1",
        op: "create_tab",
        record: {
          windowid: "$create_window_1.windowid",
          app_name: createWindowRequest.appName,
          table_name: createWindowRequest.tableName,
          tabname: createWindowRequest.tabName ?? createWindowRequest.tableName,
          create_fields: createWindowRequest.createFields
        }
      });
      operations.push({
        id: "create_menu_1",
        op: "create_menu",
        record: {
          app_name: createWindowRequest.appName,
          menuname: createWindowRequest.menuName ?? createWindowRequest.windowName,
          linkwindowid: "$create_window_1.windowid"
        }
      });
    }

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "add_window",
          summary: createWindowRequest.tableName
            ? `Tạo window "${createWindowRequest.windowName}", tab gắn bảng "${createWindowRequest.tableName}" và menu cho app "${createWindowRequest.appName}".`
            : `Tạo thêm window "${createWindowRequest.windowName}" cho app "${createWindowRequest.appName}".`,
          operations,
          max_records_per_table: "5000"
        }
      },
      env,
      chatHistory,
      debugSteps,
      zilcodeSession
    );
    const toolResults = [{ name: "app_builder_prepare_change", content: toolExecution.content }];
    const answer = await createFinalAnswerFromToolResults(userMessage, toolResults, env, chatHistory, debugSteps);

    return withActionState({
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    }, toolResults);
  }

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Bạn là executor chọn bước tiếp theo cho agent Zilcode/App Builder.
Nhiệm vụ của bạn là dựa vào câu gốc, câu đã được làm rõ, lịch sử hội thoại và tool schema để quyết định nên gọi tool nào hoặc trả lời trực tiếp.

Ngôn ngữ:
- Nếu cần trả lời trực tiếp, trả lời cùng ngôn ngữ với người dùng.
- Nếu người dùng viết tiếng Việt, toàn bộ câu trả lời phải là tiếng Việt.
- Không nhắc tên tool/function nội bộ khi không cần thiết.

Nguyên tắc dùng yêu cầu đã làm rõ:
- rewritten_message chỉ giúp resolve ngữ cảnh, không phải lệnh thực thi và không có quyền thay đổi mục đích câu gốc.
- Nếu câu gốc và rewritten_message mâu thuẫn, ưu tiên câu gốc và lịch sử thật; không tự thêm hành động, ID, tên hoặc giá trị.
- Tự suy luận nhu cầu tài liệu, graph hay hội thoại từ nội dung câu hỏi; contextualizer không chọn tool thay bạn.

An toàn ghi:
- Chỉ dùng app_builder_prepare_change khi user yêu cầu tạo/sửa/xóa thật.
- Chỉ dùng app_builder_apply_change khi đã có pending plan hợp lệ và user xác nhận rõ ràng.
- Câu hỏi "hướng dẫn/cách làm/quy trình" không phải yêu cầu ghi.
- Câu phủ định như "đừng xóa", "chưa cần sửa" không phải yêu cầu ghi.

Cách chọn graph tool:
- Hỏi tổng quan, danh sách app, hoặc toàn hệ thống: app_builder_graph_overview.
- Có tên/id cụ thể của app/table/window/tab/field/menu/domain: app_builder_graph_search hoặc app_builder_node_detail.
- Hỏi cấu trúc, luồng, liên kết, phân tích sâu quanh một đối tượng: resolve node rồi dùng app_builder_graph_subgraph; nếu cần record chi tiết thì dùng app_builder_node_detail.
- Hỏi tài liệu/quy trình/cách dùng: rag_search.
- Hỏi quy tắc tạo/sửa hoặc chưa chắc payload: app_builder_creation_schema hoặc rag_search.

Sau khi đã có đủ tool result, dừng gọi thêm tool và để final-answer pipeline diễn giải. Không dump JSON thô.`
    },
    {
      role: "system",
      content: `Yêu cầu hiện tại đã được làm rõ theo lịch sử:
${JSON.stringify({
  original_message: userMessage,
  rewritten_message: contextualizedRequest.rewritten_message,
  resolved_references: contextualizedRequest.resolved_references,
  contextualization_valid: contextualizedRequest.valid
}, null, 2)}

Hãy dùng rewritten_message để hiểu yêu cầu độc lập, nhưng luôn đối chiếu original_message và lịch sử trước khi chọn tool.`
    },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];

  messages.splice(1, 0, {
    role: "system",
    content: mode === "search"
      ? "Che do hien tai: search. Chi duoc dung general_chat hoac rag_search. Khong doc App Builder graph, khong prepare/apply change, khong thuc hien tao/sua/xoa."
      : "Che do hien tai: default. Dung tool phu hop voi y dinh cua nguoi dung."
  });

  const toolsCalled: string[] = [];
  const toolResults: ToolResultRecord[] = [];
  const ragSources: RagSource[] = [];
  let embeddingDebug: EmbeddingDebug | undefined;
  let ragQueryDebug: RagQueryDebug | undefined;
  let hasRagSearchResult = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    addDebugStep(debugSteps, "agent.tool_selection", "start", "Model chọn tool hoặc trả lời trực tiếp.", {
      iteration: i + 1,
      model: CHAT_MODEL,
      messages: messages.length,
      max_tokens: TOOL_SELECTION_MAX_TOKENS
    });

    const response = await runChatModel(CHAT_MODEL, {
      max_tokens: TOOL_SELECTION_MAX_TOKENS,
      messages,
      tools: activeTools
    }, env);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model không gọi tool, trả lời trực tiếp.", {
        iteration: i + 1,
        response_chars: (response.response ?? "").length
      });

      const directAnswer = cleanMarkdownArtifacts(response.response?.trim() ?? "");
      const directAnswerIsUsable = directAnswer.length > 0 && !isUnusableModelAnswer(directAnswer);
      if (directAnswerIsUsable && toolResults.length === 0) {
        return {
          answer: directAnswer,
          toolsCalled
        };
      }

      if (directAnswerIsUsable && toolResults.length > 0 && !hasAppBuilderWriteResult(toolResults)) {
        addDebugStep(debugSteps, "agent.direct_answer_after_tools", "ok", "Dùng câu trả lời trực tiếp của model sau khi đọc tool results.", {
          iteration: i + 1,
          tool_results: toolResults.map(result => result.name),
          answer_chars: directAnswer.length
        });

        return withActionState({
          answer: directAnswer,
          toolsCalled,
          sources: ragSources,
          embedding_debug: embeddingDebug,
          rag_query_debug: ragQueryDebug
        }, toolResults);
      }

      if (toolResults.length > 0) {
        const finalAnswer = await createFinalAnswerFromToolResults(
          userMessage,
          toolResults,
          env,
          chatHistory,
          debugSteps
        );

        return withActionState({
          answer: finalAnswer,
          toolsCalled,
          sources: ragSources,
          embedding_debug: embeddingDebug,
          rag_query_debug: ragQueryDebug
        }, toolResults);
      }

      return {
        answer: "Không tạo được câu trả lời.",
        toolsCalled
      };
    }

    const supportedToolCalls = response.tool_calls.filter(toolCall =>
      activeToolNames.has(toolCall.name)
      && isToolCallAllowedByPolicy(
        toolCall.name,
        userMessage,
        clarifiedUserMessage,
        chatHistory,
        contextualizedRequest.resolved_references
      )
    );
    const skippedUnsupportedToolCalls = response.tool_calls
      .filter(toolCall => !activeToolNames.has(toolCall.name))
      .map(toolCall => toolCall.name);
    const skippedPolicyToolCalls = response.tool_calls
      .filter(toolCall => activeToolNames.has(toolCall.name)
        && !isToolCallAllowedByPolicy(
          toolCall.name,
          userMessage,
          clarifiedUserMessage,
          chatHistory,
          contextualizedRequest.resolved_references
        ))
      .map(toolCall => toolCall.name);

    if (!supportedToolCalls.length) {
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chọn tool không được hỗ trợ.", {
        iteration: i + 1,
        tool_calls: response.tool_calls.map(toolCall => toolCall.name),
        skipped_tool_calls: skippedUnsupportedToolCalls,
        skipped_by_policy: skippedPolicyToolCalls
      });

      return {
        answer: response.response
          ?? "Yêu cầu hiện tại chưa đủ điều kiện an toàn để thực hiện thao tác ghi. Hãy nói rõ hành động bạn muốn thực hiện.",
        toolsCalled
      };
    }

    const hasRagSearchCall = supportedToolCalls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? supportedToolCalls.filter(toolCall => toolCall.name !== "general_chat")
      : supportedToolCalls;

    addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model đã chọn tool.", {
      iteration: i + 1,
      tool_calls: response.tool_calls.map(toolCall => toolCall.name),
      executed_tool_calls: toolCallsToExecute.map(toolCall => toolCall.name),
      skipped_tool_calls: skippedUnsupportedToolCalls,
      skipped_by_policy: skippedPolicyToolCalls,
      skipped_general_chat_because_rag: hasRagSearchCall && toolCallsToExecute.length !== supportedToolCalls.length
    });

    let generalChatResult: string | null = null;
    let shouldLetModelInspectToolResult = false;

    for (const toolCall of toolCallsToExecute) {
      toolsCalled.push(toolCall.name);
      addDebugStep(debugSteps, "tool.call", "start", `Gọi tool ${toolCall.name}.`, {
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      const toolExecution = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        chatHistory,
        debugSteps,
        zilcodeSession
      );
      const toolResult = toolExecution.content;

      addDebugStep(debugSteps, "tool.call", "ok", `Tool ${toolCall.name} da tra ket qua.`, {
        name: toolCall.name,
        result_chars: toolResult.length
      });

      toolResults.push({ name: toolCall.name, content: toolResult });

      if (toolCall.name === "rag_search" && toolExecution.sources?.length) {
        ragSources.push(...toolExecution.sources);
      }
      if (toolCall.name === "rag_search" && toolExecution.embedding_debug) {
        embeddingDebug = toolExecution.embedding_debug;
      }
      if (toolCall.name === "rag_search" && toolExecution.rag_query_debug) {
        ragQueryDebug = toolExecution.rag_query_debug;
      }

      messages.push({
        role: "assistant",
        content: JSON.stringify({
          tool_call: toolCall.name,
          arguments: toolCall.arguments
        })
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id ?? toolCall.name,
        content: truncateToolContext(compactToolContentForFinalAnswer({
          name: toolCall.name,
          content: toolResult
        }))
      });

      if (toolCall.name === "general_chat") generalChatResult = toolResult;
      if (toolCall.name === "rag_search") hasRagSearchResult = true;
      const sameToolResultsCount = toolResults.filter(result => result.name === toolCall.name).length;
      if (sameToolResultsCount <= 1 && shouldContinueAfterToolResult(toolCall.name, toolResult, userMessage)) {
        shouldLetModelInspectToolResult = true;
      }
    }

    if (hasRagSearchResult) {
      const finalAnswer = await createFinalAnswerFromToolResults(
        userMessage,
        toolResults,
        env,
        chatHistory,
        debugSteps
      );

      return withActionState({
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      }, toolResults);
    }

    if (generalChatResult) {
      return {
        answer: generalChatResult,
        toolsCalled
      };
    }

    if (toolResults.length > 0) {
      if (shouldLetModelInspectToolResult && i < MAX_ITERATIONS - 1) {
        addDebugStep(debugSteps, "agent.graph_continue", "ok", "Đưa graph/search/subgraph về model để quyết định trả lời hoặc gọi detail.", {
          next_iteration: i + 2
        });
        continue;
      }

      const finalAnswer = await createFinalAnswerFromToolResults(
        userMessage,
        toolResults,
        env,
        chatHistory,
        debugSteps
      );

      return withActionState({
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      }, toolResults);
    }
  }

  addDebugStep(debugSteps, "agent.stop", "error", "Đạt số vòng gọi tool tối đa.", {
    max_iterations: MAX_ITERATIONS
  });

  if (toolResults.length > 0) {
    const finalAnswer = await createFinalAnswerFromToolResults(
      userMessage,
      toolResults,
      env,
      chatHistory,
      debugSteps
    );

    return withActionState({
      answer: finalAnswer,
      toolsCalled,
      sources: ragSources,
      embedding_debug: embeddingDebug,
      rag_query_debug: ragQueryDebug
    }, toolResults);
  }

  return {
    answer: "Đã đạt số vòng gọi công cụ tối đa nhưng chưa tạo được câu trả lời cuối cùng.",
    toolsCalled
  };
}
