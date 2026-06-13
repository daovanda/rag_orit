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
  AIMessage,
  ChatHistoryMessage,
  EmbeddingDebug,
  RagQueryDebug,
  RagSource,
  ToolCall,
  ToolExecutionResult,
  ToolResultRecord
} from "./types";

const MAX_ITERATIONS = 6;
const AVAILABLE_TOOL_NAMES = new Set<string>(TOOLS.map(tool => tool.name));
const GRAPH_CONTINUE_TOOLS = new Set([
  "app_builder_graph_search"
]);
const FINAL_ANSWER_ARRAY_LIMIT = 16;
const FINAL_ANSWER_OBJECT_KEY_LIMIT = 28;
const FINAL_ANSWER_RECURSION_LIMIT = 3;

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

function extractCreateAppRequest(message: string): { appName: string; template: "order_management" | "basic" } | null {
  const normalized = normalizeVietnameseText(message);
  const wantsCreate = /(tao|them|create|add)/.test(normalized);
  const mentionsApp = /\bapp\b/.test(normalized) || normalized.includes("ung dung");
  if (!wantsCreate || !mentionsApp) return null;
  if (/(window|cua so|table|bang|field|truong|cot|column)/.test(normalized) && !/quan ly don hang|order/.test(normalized)) {
    return null;
  }

  const quoted = message.match(/["“]([^"”\n]+)["”]/);
  const explicitName = quoted?.[1]?.trim()
    || message.match(/\bapp\s+(?:mới\s+|moi\s+)?([^,.;\n]+?)(?:\s+(?:với|voi|gồm|gom|các|cac|bảng|bang|window|cửa|cua)\b|[,.;]|$)/i)?.[1]?.trim()
    || message.match(/(?:ứng dụng|ung dung)\s+([^,.;\n]+?)(?:\s+(?:với|voi|gồm|gom|các|cac|bảng|bang|window|cửa|cua)\b|[,.;]|$)/i)?.[1]?.trim();

  const template = /quan ly don hang|order/.test(normalized) ? "order_management" : "basic";
  const appName = template === "order_management"
    ? "Quản lý đơn hàng"
    : (explicitName || "Ứng dụng mới");
  return { appName, template };
}

function buildCreateAppOperations(request: { appName: string; template: "order_management" | "basic" }): Record<string, unknown>[] {
  if (request.template !== "order_management") {
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

  const operations: Record<string, unknown>[] = [
    {
      id: "create_app_1",
      op: "create_app",
      record: {
        appname: request.appName,
        description: "Ứng dụng quản lý khách hàng, sản phẩm, đơn hàng và chi tiết đơn hàng."
      }
    }
  ];

  const tables = [
    {
      id: "customers",
      tablename: "customers",
      alias: "Khách hàng",
      columns: [
        ["customerid", "Mã khách hàng", "key"],
        ["customername", "Tên khách hàng", "text"],
        ["phone", "Số điện thoại", "text"],
        ["email", "Email", "text"],
        ["address", "Địa chỉ", "text"]
      ]
    },
    {
      id: "products",
      tablename: "products",
      alias: "Sản phẩm",
      columns: [
        ["productid", "Mã sản phẩm", "key"],
        ["productname", "Tên sản phẩm", "text"],
        ["unitprice", "Đơn giá", "number"],
        ["stockqty", "Tồn kho", "number"],
        ["category", "Danh mục", "text"]
      ]
    },
    {
      id: "orders",
      tablename: "orders",
      alias: "Đơn hàng",
      columns: [
        ["orderid", "Mã đơn hàng", "key"],
        ["orderno", "Số đơn hàng", "text"],
        ["customerid", "Khách hàng", "number"],
        ["orderdate", "Ngày đặt", "date"],
        ["status", "Trạng thái", "text"],
        ["totalamount", "Tổng tiền", "number"]
      ]
    },
    {
      id: "order_items",
      tablename: "order_items",
      alias: "Chi tiết đơn hàng",
      columns: [
        ["orderitemid", "Mã dòng", "key"],
        ["orderid", "Đơn hàng", "number"],
        ["productid", "Sản phẩm", "number"],
        ["quantity", "Số lượng", "number"],
        ["unitprice", "Đơn giá", "number"],
        ["linetotal", "Thành tiền", "number"]
      ]
    }
  ] as const;

  for (const table of tables) {
    const tableOperationId = `create_table_${table.id}`;
    operations.push({
      id: tableOperationId,
      op: "create_table",
      record: {
        tablename: table.tablename,
        alias: table.alias,
        tabletype: "table"
      }
    });

    table.columns.forEach(([columnname, caption, columntype], index) => {
      operations.push({
        id: `create_column_${table.id}_${columnname}`,
        op: "create_column",
        record: {
          tableid: `$${tableOperationId}.tableid`,
          columnname,
          caption,
          columntype,
          datatype: columntype,
          seqno: index + 1
        }
      });
    });
  }

  const windows = [
    { id: "orders", windowname: "Quản lý đơn hàng", table: "orders", menu: "Đơn hàng" },
    { id: "customers", windowname: "Quản lý khách hàng", table: "customers", menu: "Khách hàng" },
    { id: "products", windowname: "Quản lý sản phẩm", table: "products", menu: "Sản phẩm" }
  ] as const;

  for (const window of windows) {
    const windowOperationId = `create_window_${window.id}`;
    const tabOperationId = `create_tab_${window.id}`;
    const table = tables.find(item => item.id === window.table);
    if (!table) continue;

    operations.push({
      id: windowOperationId,
      op: "create_window",
      record: {
        appid: "$create_app_1.appid",
        windowname: window.windowname,
        windowtype: "window"
      }
    });

    operations.push({
      id: tabOperationId,
      op: "create_tab",
      record: {
        windowid: `$${windowOperationId}.windowid`,
        tableid: `$create_table_${window.table}.tableid`,
        tabname: table.alias,
        seqno: 1
      }
    });

    table.columns.forEach(([columnname, caption, columntype], index) => {
      operations.push({
        id: `create_field_${window.id}_${columnname}`,
        op: "create_field",
        record: {
          tabid: `$${tabOperationId}.tabid`,
          columnid: `$create_column_${window.table}_${columnname}.columnid`,
          fieldname: caption,
          fieldtype: columntype === "key" ? "text" : columntype,
          seqno: index + 1
        }
      });
    });

    operations.push({
      id: `create_menu_${window.id}`,
      op: "create_menu",
      record: {
        appid: "$create_app_1.appid",
        menuname: window.menu,
        translate: window.menu,
        windowid: `$${windowOperationId}.windowid`
      }
    });
  }

  return operations;
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

async function createFinalAnswerFromRag(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<string> {
  addDebugStep(debugSteps, "rag.final_answer", "start", "Tạo câu trả lời cuối từ RAG/context.", {
    model: CHAT_MODEL,
    tool_results: toolResults.length,
    history_messages: chatHistory.length
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_FINAL_MAX_TOKENS,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Bạn là trợ lý Zilcode.
Trả lời bằng cùng ngôn ngữ với người hỏi.
Nếu người hỏi dùng tiếng Việt, toàn bộ câu trả lời phải là tiếng Việt. Không dùng heading/cụm từ tiếng Anh.
Dữ liệu có thể gồm RAG docs và App Builder graph tool results.
Nếu tài liệu không đủ, nói rõ phần nào chưa chắc.
Không nhắc đến tool/function nội bộ.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  const cleanedAnswer = cleanMarkdownArtifacts(response.response?.trim() ?? "");
  const answer = cleanedAnswer || "Không tạo được câu trả lời.";
  addDebugStep(debugSteps, "rag.final_answer", "ok", "Đã tạo câu trả lời cuối từ RAG/context.", {
    answer_chars: answer.length
  });

  return answer;
}

function extractAnswerFactsContext(toolResults: ToolResultRecord[]): string {
  const graphResult = [...toolResults]
    .reverse()
    .find(result => isAppBuilderGraphTool(result.name));

  if (!graphResult) return "";

  try {
    const data = JSON.parse(graphResult.content) as Record<string, unknown>;
    if (!data.answer_facts) return "";

    return compactToolContentForFinalAnswer(graphResult);
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
  const rawFactsContext = extractAnswerFactsContext(toolResults);
  const factsContext = truncateToolContext(rawFactsContext || toolContext);

  addDebugStep(debugSteps, "pipeline.comprehension", "start", "Buoc 1: doc graph data va hieu cau truc app.", {
    tool_context_chars: toolContext.length,
    raw_facts_context_chars: rawFactsContext.length,
    facts_context_chars: factsContext.length
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: 600,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn là bộ phân tích cấu trúc App Builder.
Nhiệm vụ: đọc graph/tool data bên dưới và tóm tắt thành prose ngắn gọn.

Trả lời theo cấu trúc sau, viết prose thuần, không JSON, không markdown:

APP & MỤC ĐÍCH: App tên gì, có bao nhiêu app, mỗi app dùng để làm gì. Nếu phải suy từ tên app/window/table thì nói rõ là suy từ tên.

LUỒNG ĐÃ XÁC MINH: Chỉ nêu các luồng có trong flow_summary và verified_relations, ví dụ app -> window -> tab -> table, menu -> window, role -> app/menu/table.

THÀNH PHẦN CHÍNH: Các window, table, menu quan trọng nhất và mối quan hệ giữa chúng.

ĐIỂM CHƯA RÕ: Những phần graph chưa có đủ cạnh để kết luận, để bước sau không bịa.

Chỉ dùng thông tin có trong graph/tool data. Không bịa thêm. Không giải thích định nghĩa chung.`
      },
      {
        role: "user",
        content: `Dữ liệu graph App Builder:\n\n${factsContext}\n\nHãy phân tích và tóm tắt cấu trúc app theo format yêu cầu.`
      }
    ]
  }, env);

  const comprehension = response.response?.trim() ?? "";
  addDebugStep(debugSteps, "pipeline.comprehension", "ok", "Buoc 1 hoan tat.", {
    chars: comprehension.length
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
        content: `Bạn là bộ lập kế hoạch trả lời cho trợ lý App Builder.
Bạn nhận được: (1) hiểu biết về app đã tóm tắt từ graph/tool data, (2) câu hỏi của user.

Nhiệm vụ: quyết định câu trả lời nên bao gồm gì. Chưa viết câu trả lời cuối.

Trả lời ngắn gọn theo cấu trúc:

LOẠI CÂU HỎI: flow/liên kết | đối tượng cụ thể | tổng quan | liệt kê | tạo/sửa/xóa | khác.

PHẦN CẦN TRẢ LỜI: Những thông tin nào từ comprehension trực tiếp trả lời câu hỏi.

ĐÃ XÁC MINH: Phần nào có bằng chứng rõ trong graph/tool data.

CẦN GHI CHÚ: Phần nào là suy luận, phần nào graph chưa đủ để kết luận.

CẤU TRÚC TRẢ LỜI: Nên bắt đầu bằng gì, diễn giải flow như thế nào, có nên liệt kê hay không.`
      },
      {
        role: "user",
        content: `Hiểu biết về app:\n${comprehension}\n\nCâu hỏi của user: ${userMessage}`
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
        content: `Bạn là trợ lý phân tích App Builder của Zilcode.
Trả lời bằng ngôn ngữ của user. Nếu user viết tiếng Việt, toàn bộ câu trả lời phải là tiếng Việt.
Không dùng heading hay cụm từ tiếng Anh nếu user viết tiếng Việt.
Không nhắc đến tool/function nội bộ.

Quy tắc Zilcode:
- Quyền có 3 lớp độc lập: roleapp (vào app), rolemenu (vào menu), access (cờ trên table). Không gộp chung.
- n_cache = layout cache UI, không phải cache dữ liệu nghiệp vụ.
- Tên đúng: window / tab / field / menu. Không dùng AD_Window / AD_Tab / AD_Field.
- App Builder metadata khác runtime: SQLCloud/procedure/view là physical database, không apply được bằng App Builder metadata tool nếu không có write contract riêng.

Cách viết:
- Bắt đầu từ dữ liệu đã thấy trong graph/tool data, rồi mới diễn giải bằng kiến thức chung.
- Được dùng kiến thức chung về no-code/app-builder/ERP/CRUD/workflow để giải thích dễ hiểu, nhưng không dùng để bịa dữ liệu graph chưa xác minh.
- Phân biệt rõ phần đã xác minh với phần suy luận/khuyến nghị khi câu trả lời có cả hai.
- Không kể lại JSON, không mở bằng danh sách dài nếu user không hỏi liệt kê.`
      },
      {
        role: "assistant",
        content: `Tôi đã đọc graph/tool data và hiểu như sau:\n${comprehension}`
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
  zilcodeSession?: ZilcodeSessionState | null
): Promise<AgenticLoopResult> {
  addDebugStep(debugSteps, "agent.start", "start", "Bắt đầu agentic loop.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    tools: TOOLS.map(tool => tool.name)
  });

  const isConfirmation = isPlanConfirmation(userMessage);
  const confirmedPlanId = isConfirmation ? findImmediatePreviousPlanId(chatHistory) : null;
  if (confirmedPlanId && zilcodeSession) {
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

  const appOrdinal = extractAppOrdinalReference(userMessage);
  const ordinalApp = appOrdinal && isReadOnlyAppInfoIntent(userMessage)
    ? resolveAppOrdinalFromHistory(chatHistory, appOrdinal)
    : null;
  if (ordinalApp && zilcodeSession) {
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

  const createAppRequest = extractCreateAppRequest(userMessage);
  if (createAppRequest && zilcodeSession) {
    const operations = buildCreateAppOperations(createAppRequest);
    addDebugStep(debugSteps, "agent.create_app_prepare", "start", "Phát hiện intent tạo app, tự tạo pending create_app plan.", {
      app_name: createAppRequest.appName,
      template: createAppRequest.template,
      operations_count: operations.length
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "create_app",
          summary: createAppRequest.template === "order_management"
            ? `Tạo app "${createAppRequest.appName}" với bảng, cột, window, tab, field và menu cơ bản.`
            : `Tạo app "${createAppRequest.appName}".`,
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

  const renameAppIntent = isRenameAppIntent(userMessage);
  const renameAppTarget = extractRenameAppTarget(userMessage) ?? findLatestRenameAppTarget(chatHistory);
  const renameAppNewName = extractRenameNewName(userMessage)
    ?? ((renameAppIntent || isPlanConfirmation(userMessage)) ? findLatestRenameAppNewName(chatHistory) : null);

  if (zilcodeSession && (renameAppIntent || (renameAppTarget && renameAppNewName))) {
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

  const renameWindowRequest = extractRenameWindowRequest(userMessage)
    ?? ((normalizeVietnameseText(userMessage).includes("doi ten") || isConfirmation) ? findLatestRenameWindowRequest(chatHistory) : null);
  if (renameWindowRequest && zilcodeSession) {
    const appName = extractAppNameFromText(userMessage) ?? findLatestAppName(chatHistory);
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

  const deleteWindowId = isDeleteWindowIntent(userMessage)
    ? extractWindowDeleteIdFromText(userMessage)
    : null;

  if (deleteWindowId && zilcodeSession) {
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

  const createWindowRequest = extractCreateWindowRequest(userMessage);
  if (createWindowRequest && zilcodeSession) {
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
      content: `Bạn là trợ lý AI cho Zilcode và App Builder.
Trả lời bằng cùng ngôn ngữ với người dùng.
Nếu người dùng viết tiếng Việt, bắt buộc trả lời tiếng Việt. Không chuyển sang tiếng Anh kể cả tiêu đề, bảng biểu, hoặc lời nhắc xác nhận.

Tools:
- general_chat: dùng cho hội thoại thông thường, không cần RAG/Zilcode.
- rag_search: dùng khi cần docs/guide/API contract/playbook.
- app_builder_graph_overview: dùng đầu tiên khi cần đọc App Builder hiện tại. Tool này trả skeleton graph.
- app_builder_graph_search: tìm node app/table/window/tab/field/menu/domain theo tên/id.
- app_builder_graph_subgraph: mở vùng graph liên quan quanh node.
- app_builder_node_detail: lấy chi tiết node cụ thể.
- app_builder_creation_schema: lấy quy tắc tạo/sửa và proposed plan format.
- app_builder_prepare_change: chuẩn bị plan tạo/sửa/xóa, validate, lọc payload theo metadata thật, lưu pending plan. Chưa ghi.
- app_builder_apply_change: chỉ gọi sau khi user xác nhận rõ ràng và có plan_id từ prepare_change.

Graph/tool policy:
- Nếu user hỏi tổng quan toàn hệ thống, gọi app_builder_graph_overview.
- Nếu user nêu tên/id một app/table/window/tab/field/menu/domain cụ thể, gọi app_builder_graph_search hoặc node_detail trực tiếp; không cần overview nếu đã đủ mục tiêu.
- Nếu user hỏi "đi sâu", "phân tích", "xem kỹ", "cấu trúc", "luồng", "liên kết" quanh một đối tượng, resolve đối tượng rồi gọi app_builder_graph_subgraph với depth phù hợp; nếu subgraph chưa đủ mới gọi node_detail.
- Nếu search trả top match rõ theo đúng type/ý định, hãy dùng top match đó để gọi tiếp subgraph/detail thay vì hỏi user chọn.
- Chỉ hỏi lại khi nhiều kết quả gần nhau và không có top match rõ.
- Nếu user muốn tạo/sửa/xóa, gọi app_builder_creation_schema khi cần quy tắc, rồi app_builder_prepare_change để tạo pending plan.
- Chỉ gọi app_builder_apply_change khi user vừa xác nhận rõ ràng và có plan_id hợp lệ trong lịch sử hội thoại.
Nếu user hỏi tiếp bằng các từ như "đó", "kia", "vừa rồi", "các window đó", hãy dùng đối tượng/app/window đã được nhắc trong lịch sử gần nhất; không quay lại overview trừ khi thật sự mất ngữ cảnh.
Nếu user hỏi window/tab dùng bảng nào hoặc kết nối bảng nào, ưu tiên app_builder_graph_subgraph quanh window/app liên quan với depth đủ sâu, không dùng app_builder_graph_overview.
Nếu user yêu cầu xóa window theo id, không hỏi lặp lại qua nhiều vòng. Hãy tạo pending plan delete_window cascade bằng app_builder_prepare_change; apply chỉ sau khi user xác nhận plan id.

Dùng rag_search khi cần tài liệu hướng dẫn/API contract, nhất là khi không chắc quy tắc tạo/sửa.
Sau khi có đủ thông tin, trả lời ngay. Không gọi tool lặp lại nếu không có câu hỏi mới rõ ràng.
Khi trả lời từ graph, không đọc lại JSON. Hãy tóm tắt đúng phần user quan tâm.
Ưu tiên giải thích flow/liên kết chính trước; chỉ liệt kê bảng/window/menu khi user hỏi rõ hoặc sau phần giải thích ngắn.`
    },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];

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
      tools: TOOLS
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

    const supportedToolCalls = response.tool_calls.filter(toolCall => AVAILABLE_TOOL_NAMES.has(toolCall.name));
    const skippedUnsupportedToolCalls = response.tool_calls
      .filter(toolCall => !AVAILABLE_TOOL_NAMES.has(toolCall.name))
      .map(toolCall => toolCall.name);

    if (!supportedToolCalls.length) {
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chọn tool không được hỗ trợ.", {
        iteration: i + 1,
        tool_calls: response.tool_calls.map(toolCall => toolCall.name),
        skipped_tool_calls: skippedUnsupportedToolCalls
      });

      return {
        answer: response.response ?? "Model đã chọn tool không còn được hỗ trợ. Hãy thử hỏi lại theo cách khác.",
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
      const finalAnswer = await createFinalAnswerFromRag(
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
