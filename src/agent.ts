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
        errors: data.errors,
        truncated: data.truncated,
        answer_policy: "Tóm tắt theo ý định user. Không liệt kê tất cả node/edge từ overview; nếu cần chi tiết hãy dùng search/subgraph/detail."
      }, null, 2);
    }

    if (mode === "search") {
      return JSON.stringify({
        mode,
        query: data.query,
        types: data.types,
        matches_count: data.matches_count,
        matches: data.matches,
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

export function createDeterministicGraphAnswer(userMessage: string, toolResults: ToolResultRecord[]): string | null {
  const last = [...toolResults].reverse().find(result =>
    isAppBuilderGraphTool(result.name) && result.name !== "app_builder_creation_schema"
  );
  if (!last) return null;

  try {
    const data = JSON.parse(last.content) as Record<string, unknown>;
    const mode = String(data.mode ?? "");
    if (mode === "overview") return formatGraphOverviewAnswer(userMessage, data);
    if (mode === "search") return formatGraphSearchAnswer(userMessage, data);
    if (mode === "subgraph") return formatGraphSubgraphAnswer(userMessage, data);
    if (mode === "detail") return formatGraphDetailAnswer(userMessage, data);
  } catch {
    return null;
  }

  return null;
}

function formatGraphOverviewAnswer(userMessage: string, data: Record<string, unknown>): string {
  const apps = extractGraphApps(data);
  const text = normalizeVietnameseText(userMessage);
  const wantsList = /(liet ke|danh sach|nhung ung dung|cac ung dung|app nao|ung dung nao)/.test(text);
  const mentionedApp = findMentionedAppNode(text, apps);

  if (mentionedApp && /(window|cua so|man hinh)/.test(text)) {
    return formatAppCountAnswer(mentionedApp, "windows", "window", text);
  }

  if (mentionedApp && /(bang|table)/.test(text)) {
    return formatAppCountAnswer(mentionedApp, "tables", "bảng", text);
  }

  if (mentionedApp && /\bmenu\b/.test(text)) {
    return formatAppCountAnswer(mentionedApp, "menus", "menu", text);
  }

  if (!wantsList && /(bao nhieu|so luong|count)/.test(text)) {
    return `Hệ thống hiện có ${String(data.apps_count ?? apps.length)} ứng dụng.`;
  }

  return [
    `Hệ thống hiện có ${String(data.apps_count ?? apps.length)} ứng dụng:`,
    "",
    ...apps.map((app, index) => `${index + 1}. ${formatAppNodeLabel(app)}`)
  ].join("\n").trim();
}

function formatGraphSearchAnswer(userMessage: string, data: Record<string, unknown>): string {
  const matches = recordArray(data.matches);
  const text = normalizeVietnameseText(userMessage);
  if (!matches.length) {
    return "Tôi chưa tìm thấy node phù hợp trong App Builder graph. Hãy thử dùng tên hoặc id cụ thể hơn.";
  }

  const top = matches[0];
  if (isStrongSearchMatch(top)) {
    if (String(top.type ?? "") === "app" && /(window|cua so|man hinh)/.test(text)) {
      return formatAppCountAnswer(top, "windows", "window", text);
    }
    if (String(top.type ?? "") === "app" && /(bang|table)/.test(text)) {
      return formatAppCountAnswer(top, "tables", "bảng", text);
    }
    if (String(top.type ?? "") === "app" && /\bmenu\b/.test(text)) {
      return formatAppCountAnswer(top, "menus", "menu", text);
    }
  }

  if (matches.length === 1) {
    const match = matches[0];
    return [
      "Tôi tìm thấy một kết quả phù hợp:",
      `- ${formatNodeLabel(match)}`,
      "",
      "Nếu cần chi tiết, hãy hỏi rõ phần muốn xem như bảng, window, menu, tab hoặc field."
    ].join("\n");
  }

  return [
    "Tôi tìm thấy nhiều kết quả phù hợp, cần chọn đúng node trước khi đi sâu:",
    "",
    ...matches.slice(0, 10).map((match, index) => `${index + 1}. ${formatNodeLabel(match)}`)
  ].join("\n");
}

function formatGraphSubgraphAnswer(userMessage: string, data: Record<string, unknown>): string {
  const graph = asRecord(data.graph) ?? {};
  const nodes = recordArray(graph.nodes);
  const edges = recordArray(graph.edges);
  const startNodeIds = new Set(toArrayValues(data.start_node_ids).map(item => String(item)));
  const appNode = nodes.find(node => String(node.type ?? "") === "app");
  const text = normalizeVietnameseText(userMessage);
  const typeGroups = ["table", "window", "menu", "tab", "field", "service", "cache", "roleapp", "rolemenu", "access"]
    .map(type => ({ type, nodes: nodes.filter(node => String(node.type ?? "") === type) }))
    .filter(group => group.nodes.length);

  if (/(quan he|lien ket|ket noi|dung bang|bang nao|window|cua so|man hinh|tab)/.test(text)
    && /(bang|table|window|cua so|man hinh|tab)/.test(text)) {
    const flowAnswer = formatWindowTableFlowAnswer(nodes, edges, appNode, {
      startNodeIds,
      includeFieldExamples: wantsDetailedFlowAnswer(text),
      listOnly: wantsListOnlyAnswer(text)
    });
    if (flowAnswer) return flowAnswer;
  }

  if (appNode && /(bang|table|tables)/.test(text)) {
    const tables = outgoingNodes(appNode, edges, nodes, "app_has_table", "table");
    return [
      `${formatAppNodeLabel(appNode)} có ${tables.length} bảng:`,
      "",
      ...tables.slice(0, 20).map((table, index) => `${index + 1}. ${formatNodeLabel(table)}`)
    ].join("\n").trim();
  }

  return [
    appNode ? `Tóm tắt vùng liên quan của ${formatAppNodeLabel(appNode)}:` : "Tóm tắt vùng graph liên quan:",
    "",
    ...typeGroups.map(group => `- ${labelNodeType(group.type)}: ${group.nodes.length}`),
    "",
    ...typeGroups.slice(0, 4).flatMap(group => [
      `${labelNodeType(group.type)} tiêu biểu:`,
      ...group.nodes.slice(0, 8).map(node => `- ${formatNodeLabel(node)}`)
    ])
  ].join("\n").trim();
}

function formatGraphDetailAnswer(userMessage: string, data: Record<string, unknown>): string {
  const error = getStringArg(data, "error");
  const candidates = recordArray(data.candidates);
  if (error) {
    if (candidates.length) {
      return [
        "Node được yêu cầu không khớp trực tiếp, nhưng tôi tìm thấy các node gần đúng:",
        "",
        ...candidates.slice(0, 8).map((candidate, index) => `${index + 1}. ${formatNodeLabel(candidate)}`)
      ].join("\n");
    }
    return error;
  }

  const node = asRecord(data.node) ?? {};
  const detail = asRecord(data.detail) ?? {};
  if (String(node.type ?? "") === "app") return formatAppDetailAnswer(userMessage, node, detail);
  if (String(node.type ?? "") === "table") return formatTableDetailAnswer(node, detail, asRecord(data.neighbors));

  return [
    `Chi tiết ${formatNodeLabel(node)}:`,
    "",
    ...formatRecordLines(asRecord(detail.record) ?? detail).slice(0, 20)
  ].join("\n").trim();
}

function formatAppDetailAnswer(userMessage: string, node: Record<string, unknown>, detail: Record<string, unknown>): string {
  const text = normalizeVietnameseText(userMessage);
  const counts = asRecord(detail.counts) ?? {};
  const tables = recordArray(detail.tables);
  const windows = recordArray(detail.windows);
  const menus = recordArray(detail.menus);
  const services = recordArray(detail.services);
  const caches = recordArray(detail.caches);
  const roleapps = recordArray(detail.roleapps);
  const accesses = recordArray(detail.accesses);

  if (/(bang|table|tables)/.test(text)) {
    return [
      `Ứng dụng ${formatAppNodeName(node)} có ${tables.length} bảng:`,
      "",
      ...tables.slice(0, 30).map((table, index) => `${index + 1}. ${formatTableSummary(table)}`)
    ].join("\n").trim();
  }

  if (/(window|cua so|màn hình|man hinh)/.test(text)) {
    return [
      `Ứng dụng ${formatAppNodeName(node)} có ${windows.length} window:`,
      "",
      ...windows.slice(0, 30).map((windowRecord, index) => `${index + 1}. ${formatWindowSummary(windowRecord)}`)
    ].join("\n").trim();
  }

  return [
    `Chi tiết ${formatAppNodeLabel(node)}:`,
    "",
    `- Bảng: ${String(counts.tables ?? tables.length)}`,
    `- Window: ${String(counts.windows ?? windows.length)}`,
    `- Menu: ${String(counts.menus ?? menus.length)}`,
    `- Service: ${String(counts.services ?? services.length)}`,
    `- Cache window: ${String(counts.caches ?? caches.length)}`,
    `- Role app: ${String(counts.roleapps ?? roleapps.length)}`,
    `- Quyền bảng: ${String(counts.accesses ?? accesses.length)}`,
    "",
    tables.length ? "Bảng tiêu biểu:" : "",
    ...tables.slice(0, 10).map(table => `- ${formatTableSummary(table)}`),
    windows.length ? "" : "",
    windows.length ? "Window tiêu biểu:" : "",
    ...windows.slice(0, 10).map(windowRecord => `- ${formatWindowSummary(windowRecord)}`),
    menus.length ? "" : "",
    menus.length ? "Menu tiêu biểu:" : "",
    ...menus.slice(0, 10).map(menu => `- ${String(menu.translate ?? menu.menuname ?? menu.menuid ?? "menu")}`),
    accesses.length ? "" : "",
    accesses.length ? "Quyền bảng hiện có:" : "",
    ...accesses.slice(0, 8).map(access => `- roleid=${String(access.roleid ?? "")}, tableid=${String(access.tableid ?? "")}`)
  ].filter(Boolean).join("\n");
}

function formatTableDetailAnswer(
  node: Record<string, unknown>,
  detail: Record<string, unknown>,
  neighbors: Record<string, unknown> | null
): string {
  const record = asRecord(detail.record) ?? {};
  const columns = recordArray(detail.columns);
  const inbound = recordArray(neighbors?.inbound);
  const tabsUsingTable = inbound
    .filter(item => ["tab_uses_table", "tab_uses_relation_table"].includes(String(item.type ?? "")))
    .map(item => asRecord(item.node))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const appNodes = inbound
    .filter(item => String(item.type ?? "") === "app_has_table")
    .map(item => asRecord(item.node))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const accessNodes = inbound
    .filter(item => String(item.type ?? "") === "access_controls_table")
    .map(item => asRecord(item.node))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return [
    `Chi tiết bảng ${formatSimpleNodeName(node)}:`,
    "",
    `- Tên kỹ thuật: ${String(record.tablename ?? "")}`,
    record.alias ? `- Tên hiển thị: ${String(record.alias)}` : "",
    record.serviceid !== undefined ? `- Service: serviceid=${String(record.serviceid)}` : "",
    `- Số cột: ${String(detail.columns_count ?? columns.length)}`,
    columns.length ? "" : "",
    columns.length ? "Các cột:" : "",
    ...columns.map((column, index) => `${index + 1}. ${formatColumnSummary(column)}`),
    tabsUsingTable.length ? "" : "",
    tabsUsingTable.length ? "Đang được dùng trong tab/window:" : "",
    ...tabsUsingTable.slice(0, 10).map(tab => `- ${formatSimpleNodeName(tab)}`),
    appNodes.length ? "" : "",
    appNodes.length ? `Thuộc app: ${appNodes.map(formatSimpleNodeName).join(", ")}` : "",
    accessNodes.length ? `Quyền truy cập bảng: ${accessNodes.length} access record.` : "",
    "",
    "Cách hiểu nhanh: bảng lưu metadata/dữ liệu của service; column định nghĩa trường dữ liệu thật; tab/window chỉ là lớp giao diện dùng bảng đó để hiển thị hoặc nhập dữ liệu."
  ].filter(Boolean).join("\n");
}

function extractGraphApps(data: Record<string, unknown>): Record<string, unknown>[] {
  const directApps = recordArray(data.apps);
  if (directApps.length) return directApps;
  const graph = asRecord(data.graph) ?? {};
  return recordArray(graph.nodes).filter(node => String(node.type ?? "") === "app");
}

function findMentionedAppNode(normalizedText: string, apps: Record<string, unknown>[]): Record<string, unknown> | null {
  const ordinal = extractAppOrdinalFromNormalizedText(normalizedText);
  if (ordinal && apps[ordinal - 1]) return apps[ordinal - 1];

  let best: { app: Record<string, unknown>; score: number } | null = null;
  for (const app of apps) {
    const names = appNameCandidates(app)
      .map(name => normalizeVietnameseText(name))
      .filter(Boolean);
    const score = Math.max(0, ...names.map(name => scoreMentionedName(normalizedText, name)));
    if (!best || score > best.score) best = { app, score };
  }
  return best && best.score >= 0.62 ? best.app : null;
}

function extractAppOrdinalFromNormalizedText(normalizedText: string): number | null {
  const match = normalizedText.match(/(?:ung dung|app)\s*(?:so|thu)?\s*(\d+)/)
    ?? normalizedText.match(/^so\s*(\d+)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function appNameCandidates(app: Record<string, unknown>): string[] {
  const summary = asRecord(app.summary) ?? {};
  return [
    String(app.label ?? ""),
    String(summary.appname ?? ""),
    String(summary.app_name ?? ""),
    String(summary.appcode ?? "")
  ].filter(Boolean);
}

function scoreMentionedName(normalizedText: string, normalizedName: string): number {
  if (!normalizedName) return 0;
  if (normalizedText.includes(normalizedName)) return 1;
  const textCompact = normalizedText.replace(/[^a-z0-9]+/g, "");
  const nameCompact = normalizedName.replace(/[^a-z0-9]+/g, "");
  if (nameCompact && textCompact.includes(nameCompact)) return 1;

  const stopWords = new Set(["app", "ung", "dung", "quan", "ly"]);
  const nameTokens = normalizedName
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9]+/g, ""))
    .filter(token => token.length >= 3 && !stopWords.has(token));
  if (!nameTokens.length) return 0;
  const matched = nameTokens.filter(token => normalizedText.includes(token)).length;
  return matched / nameTokens.length;
}

function formatAppCountAnswer(
  app: Record<string, unknown>,
  countKey: "tables" | "windows" | "menus",
  unit: string,
  normalizedText: string
): string {
  const counts = asRecord(app.counts) ?? {};
  const count = Number(counts[countKey] ?? 0);
  const alternatives = [...normalizedText.matchAll(/\b\d+\b/g)]
    .map(match => Number(match[0]))
    .filter(value => Number.isFinite(value) && value !== count);
  const correction = alternatives.length
    ? `, không phải ${alternatives[0]}`
    : "";
  return `${formatAppNodeName(app)} hiện có ${count} ${unit}${correction}.`;
}

function isStrongSearchMatch(match: Record<string, unknown> | undefined): boolean {
  if (!match) return false;
  const score = Number(match.score ?? 0);
  return Number.isFinite(score) && score >= 70;
}

function formatAppNodeLabel(node: Record<string, unknown>): string {
  const name = formatAppNodeName(node);
  const counts = asRecord(node.counts) ?? {};
  const countParts = [
    counts.tables !== undefined ? `${String(counts.tables)} bảng` : "",
    counts.windows !== undefined ? `${String(counts.windows)} window` : "",
    counts.menus !== undefined ? `${String(counts.menus)} menu` : ""
  ].filter(Boolean).join(", ");
  return `${name}${countParts ? ` - ${countParts}` : ""}`;
}

function formatAppNodeName(node: Record<string, unknown>): string {
  const summary = asRecord(node.summary) ?? {};
  const appid = summary.appid ?? extractIdSuffix(node.id);
  const label = node.label ?? summary.appname ?? summary.app_name ?? summary.appcode ?? appid;
  return `${String(label)} (appid=${String(appid)})`;
}

function formatNodeLabel(node: Record<string, unknown>): string {
  const summary = asRecord(node.summary) ?? {};
  const id = String(node.id ?? "");
  const label = String(node.label ?? summary.name ?? summary.appname ?? summary.tablename ?? summary.windowname ?? id);
  const type = String(node.type ?? "node");
  return `${label} (${type}, node_id=${id})`;
}

function formatTableSummary(table: Record<string, unknown>): string {
  const name = table.alias ?? table.tablename ?? table.tableid ?? "table";
  const details = [
    table.tableid !== undefined ? `tableid=${String(table.tableid)}` : "",
    table.columns_count !== undefined ? `${String(table.columns_count)} cột` : "",
    table.serviceid !== undefined ? `serviceid=${String(table.serviceid)}` : ""
  ].filter(Boolean).join(", ");
  return `${String(name)}${details ? ` (${details})` : ""}`;
}

function formatColumnSummary(column: Record<string, unknown>): string {
  const name = column.columnname ?? column.alias ?? column.columnid ?? "column";
  const details = [
    column.columnid !== undefined ? `columnid=${String(column.columnid)}` : "",
    column.datatype !== undefined ? `datatype=${String(column.datatype)}` : "",
    column.columntype !== undefined && column.columntype !== column.datatype ? `columntype=${String(column.columntype)}` : "",
    column.length !== undefined ? `length=${String(column.length)}` : "",
    column.domainid !== undefined ? `domainid=${String(column.domainid)}` : "",
    column.linktableid !== undefined ? `lookup tableid=${String(column.linktableid)}` : "",
    column.linkcolumn !== undefined ? `lookup column=${String(column.linkcolumn)}` : ""
  ].filter(Boolean).join(", ");
  return `${String(name)}${details ? ` (${details})` : ""}`;
}

function formatWindowSummary(windowRecord: Record<string, unknown>): string {
  const name = windowRecord.windowname ?? windowRecord.translate ?? windowRecord.windowid ?? "window";
  const details = [
    windowRecord.windowid !== undefined ? `windowid=${String(windowRecord.windowid)}` : "",
    windowRecord.tabs_count !== undefined ? `${String(windowRecord.tabs_count)} tab` : "",
    windowRecord.fields_count !== undefined ? `${String(windowRecord.fields_count)} field` : ""
  ].filter(Boolean).join(", ");
  return `${String(name)}${details ? ` (${details})` : ""}`;
}

function wantsListOnlyAnswer(normalizedText: string): boolean {
  return /(chi liet ke|liet ke|danh sach|ngan gon|tom tat nhanh|chi can biet)/.test(normalizedText)
    && !/(giai thich|dien giai|chi tiet|luong|lookup|domain|field|truong|cot|column)/.test(normalizedText);
}

function wantsDetailedFlowAnswer(normalizedText: string): boolean {
  if (wantsListOnlyAnswer(normalizedText)) return false;
  return /(giai thich|dien giai|chi tiet|luong|quan he chi tiet|lookup|domain|field|truong|cot|column)/.test(normalizedText);
}

function formatWindowTableFlowAnswer(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  appNode?: Record<string, unknown>,
  options: {
    startNodeIds?: Set<string>;
    includeFieldExamples?: boolean;
    listOnly?: boolean;
  } = {}
): string | null {
  const startedWindows = nodes.filter(node =>
    String(node.type ?? "") === "window"
    && options.startNodeIds?.has(String(node.id ?? ""))
  );
  const windowsFromApp = appNode ? outgoingNodes(appNode, edges, nodes, "app_has_window", "window") : [];
  const windows = startedWindows.length
    ? startedWindows
    : windowsFromApp.length
      ? windowsFromApp
      : nodes.filter(node => String(node.type ?? "") === "window");
  if (!windows.length) return null;

  const intro = appNode
    ? `Luồng window/tab/bảng của ${formatAppNodeName(appNode)}:`
    : windows.length === 1
      ? `Window ${formatSimpleNodeName(windows[0])} đang nối tới các bảng sau:`
      : "Luồng window/tab/bảng trong vùng đang xem:";

  const lines: string[] = [intro, ""];
  for (const windowNode of windows.slice(0, 12)) {
    const tabs = outgoingNodes(windowNode, edges, nodes, "window_has_tab", "tab");
    if (!tabs.length) {
      lines.push(`- ${formatSimpleNodeName(windowNode)}: chưa thấy tab trong graph đang mở.`);
      continue;
    }

    lines.push(`- ${formatSimpleNodeName(windowNode)}:`);
    for (const tab of tabs.slice(0, 12)) {
      const tables = outgoingNodes(tab, edges, nodes, "tab_uses_table", "table");
      const relationTables = outgoingNodes(tab, edges, nodes, "tab_uses_relation_table", "table");
      const fields = outgoingNodes(tab, edges, nodes, "tab_has_field", "field");
      const tableText = tables.length
        ? tables.map(formatSimpleNodeName).join(", ")
        : "chưa thấy bảng chính";
      const relationText = relationTables.length
        ? `; bảng quan hệ: ${relationTables.map(formatSimpleNodeName).join(", ")}`
        : "";
      const fieldText = fields.length
        ? `; ${fields.length} field`
        : "";

      lines.push(`  - Tab ${formatSimpleNodeName(tab)} -> bảng chính: ${tableText}${relationText}${fieldText}.`);

      if (options.listOnly || !options.includeFieldExamples) continue;

      const fieldExamples = fields.slice(0, 4)
        .map(field => {
          const columns = outgoingNodes(field, edges, nodes, "field_maps_column", "column");
          const domains = outgoingNodes(field, edges, nodes, "field_uses_domain", "domain");
          const linkedTables = outgoingNodes(field, edges, nodes, "field_links_table", "table");
          const columnText = columns.length ? ` -> cột ${columns.map(formatSimpleNodeName).join(", ")}` : "";
          const domainText = domains.length ? `; domain ${domains.map(formatSimpleNodeName).join(", ")}` : "";
          const lookupText = linkedTables.length ? `; lookup sang ${linkedTables.map(formatSimpleNodeName).join(", ")}` : "";
          return `    - Field ${formatSimpleNodeName(field)}${columnText}${domainText}${lookupText}`;
        });
      lines.push(...fieldExamples);
      if (fields.length > fieldExamples.length) {
        lines.push(`    - ... còn ${fields.length - fieldExamples.length} field khác.`);
      }
    }
  }

  if (!options.listOnly) {
    lines.push("");
    lines.push("Cách hiểu nhanh: menu mở window; window chứa tab; tab quyết định bảng dữ liệu chính; field trên tab hiển thị hoặc nhập dữ liệu từ column của bảng đó. Lookup/domain thường nằm ở column, field chỉ map tới column.");
  }
  return lines.join("\n").trim();
}

function outgoingNodes(
  node: Record<string, unknown>,
  edges: Record<string, unknown>[],
  nodes: Record<string, unknown>[],
  edgeType: string,
  targetType?: string
): Record<string, unknown>[] {
  const nodeId = String(node.id ?? "");
  const targetIds = new Set(
    edges
      .filter(edge => String(edge.from ?? "") === nodeId && String(edge.type ?? "") === edgeType)
      .map(edge => String(edge.to ?? ""))
      .filter(Boolean)
  );
  return nodes.filter(candidate =>
    targetIds.has(String(candidate.id ?? ""))
    && (!targetType || String(candidate.type ?? "") === targetType)
  );
}

function formatSimpleNodeName(node: Record<string, unknown>): string {
  const summary = asRecord(node.summary) ?? {};
  const name = node.label
    ?? summary.appname
    ?? summary.windowname
    ?? summary.tabname
    ?? summary.alias
    ?? summary.tablename
    ?? summary.columnname
    ?? summary.fieldname
    ?? summary.domainname
    ?? node.id;
  const id = primaryNodeId(node);
  return `${String(name)}${id ? ` (${id})` : ""}`;
}

function primaryNodeId(node: Record<string, unknown>): string {
  const summary = asRecord(node.summary) ?? {};
  const type = String(node.type ?? "");
  const candidates: Record<string, string> = {
    app: "appid",
    table: "tableid",
    column: "columnid",
    window: "windowid",
    tab: "tabid",
    field: "fieldid",
    menu: "menuid",
    domain: "domainid",
    service: "serviceid"
  };
  const key = candidates[type];
  const value = key ? summary[key] : undefined;
  return value === undefined || value === null || value === "" ? "" : `${key}=${String(value)}`;
}

function formatRecordLines(record: Record<string, unknown>): string[] {
  return Object.entries(record).map(([key, value]) => `- ${key}: ${String(value)}`);
}

function labelNodeType(type: string): string {
  const labels: Record<string, string> = {
    table: "Bảng",
    window: "Window",
    menu: "Menu",
    tab: "Tab",
    field: "Field",
    service: "Service",
    cache: "Cache",
    roleapp: "Role app",
    rolemenu: "Role menu",
    access: "Quyền bảng"
  };
  return labels[type] ?? type;
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

function shouldContinueAfterToolResult(toolName: string, toolResult: string, userMessage: string): boolean {
  if (!GRAPH_CONTINUE_TOOLS.has(toolName)) return false;

  const text = normalizeVietnameseText(userMessage);
  const wantsDetail = /(co gi|chi tiet|bang|table|window|cua so|menu|tab|field|truong|cot|cache|quyen|role)/.test(text);
  if (!wantsDetail) return false;

  try {
    const data = JSON.parse(toolResult) as Record<string, unknown>;
    if (String(data.mode ?? "") !== "search") return false;
    if (Number(data.matches_count ?? 0) === 1) return true;
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

  const answer = cleanMarkdownArtifacts(response.response ?? "Không tạo được câu trả lời.");
  addDebugStep(debugSteps, "rag.final_answer", "ok", "Đã tạo câu trả lời cuối từ RAG/context.", {
    answer_chars: answer.length
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
    addDebugStep(debugSteps, "tools.final_answer", "ok", "Đã tạo câu trả lời deterministic cho App Builder change.", {
      answer_chars: deterministicAnswer.length
    });
    return deterministicAnswer;
  }

  const deterministicGraphAnswer = createDeterministicGraphAnswer(userMessage, toolResults);
  if (deterministicGraphAnswer) {
    addDebugStep(debugSteps, "tools.final_answer", "ok", "Đã tạo câu trả lời deterministic cho App Builder graph.", {
      answer_chars: deterministicGraphAnswer.length
    });
    return deterministicGraphAnswer;
  }

  const toolContext = truncateToolContext(formatToolResultsForFinalAnswer(toolResults));

  addDebugStep(debugSteps, "tools.final_answer", "start", "Tạo câu trả lời cuối từ kết quả tool.", {
    model: CHAT_MODEL,
    tool_results: toolResults.map(result => result.name),
    context_chars: toolContext.length
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_FINAL_MAX_TOKENS,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Bạn là trợ lý Zilcode/App Builder.
Trả lời bằng cùng ngôn ngữ với người hỏi.
Nếu người hỏi dùng tiếng Việt, toàn bộ câu trả lời phải là tiếng Việt. Không dùng heading/cụm từ tiếng Anh như "Proposed Change Plan", "Next steps", "Please confirm".
Hãy trả lời theo đúng ý định của user, không kể lại toàn bộ JSON.
Chỉ nêu những thông tin liên quan trực tiếp tới câu hỏi. Nếu câu hỏi rộng, tóm tắt ngắn gọn theo nhóm.
Nếu người dùng hỏi về hệ thống, trả lời theo cấu trúc: đăng nhập/role, các app chính, mỗi app có gì đáng chú ý, và gợi ý đào sâu. Không liệt kê tất cả node/edge.
Nếu người dùng hỏi về một app/table/window/tab/field cụ thể, tập trung vào node đó và quan hệ trực tiếp. Không liệt kê các phần không liên quan.
Nếu người dùng hỏi về luồng hoặc liên kết trong App Builder, hãy diễn giải theo chuỗi dễ hiểu: menu mở window; window chứa tab; tab dùng bảng; field map tới column; domain/lookup thường nằm ở column. Chỉ nhắc node_id/id khi cần đối chiếu.
Nếu người dùng yêu cầu tạo/sửa/xóa, trả lời theo kiểu IDE agent: hiểu yêu cầu, những gì sẽ thay đổi, các bước plan, rủi ro/thiếu thông tin, và yêu cầu xác nhận trước khi ghi.
Dùng đúng tên metadata Zilcode hiện tại: n_window, n_tab, n_field, n_menu hoặc window/tab/field/menu. Không tự đổi sang AD_Window/AD_Tab/AD_Field nếu tool không trả về các tên đó.
Nếu đã có kết quả app_builder_prepare_change, chỉ tóm tắt plan id và các bước; không mở rộng thành hướng dẫn dài.
Nếu đã có kết quả app_builder_apply_change, báo rõ thành công/thất bại và bước verify tiếp theo.
Không nhắc đến tool/function nội bộ.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${toolContext}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Không tạo được câu trả lời.");
  addDebugStep(debugSteps, "tools.final_answer", "ok", "Đã tạo câu trả lời cuối từ kết quả tool.", {
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

    return {
      answer,
      toolsCalled: ["app_builder_apply_change"]
    };
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

    return {
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    };
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

    return {
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    };
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

    return {
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    };
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

    return {
      answer,
      toolsCalled: ["app_builder_prepare_change"]
    };
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

Graph-first workflow:
1. Nếu câu hỏi liên quan App Builder/Zilcode hiện tại, gọi app_builder_graph_overview trước.
2. Nếu cần tìm một đối tượng, gọi app_builder_graph_search.
3. Nếu cần hiểu quan hệ quanh đối tượng, gọi app_builder_graph_subgraph.
4. Nếu cần lập plan chính xác hoặc trả lời chi tiết, gọi app_builder_node_detail.
5. Nếu user muốn tạo/sửa/xóa, gọi app_builder_creation_schema và app_builder_prepare_change để tạo pending plan.
6. Chỉ gọi app_builder_apply_change khi user vừa xác nhận rõ ràng và có plan_id hợp lệ trong lịch sử hội thoại.
Nếu user hỏi tiếp bằng các từ như "đó", "kia", "vừa rồi", "các window đó", hãy dùng đối tượng/app/window đã được nhắc trong lịch sử gần nhất; không quay lại overview trừ khi thật sự mất ngữ cảnh.
Nếu user hỏi window/tab dùng bảng nào hoặc kết nối bảng nào, ưu tiên app_builder_graph_subgraph quanh window/app liên quan với depth đủ sâu, không dùng app_builder_graph_overview.
Nếu user yêu cầu xóa window theo id, không hỏi lặp lại qua nhiều vòng. Hãy tạo pending plan delete_window cascade bằng app_builder_prepare_change; apply chỉ sau khi user xác nhận plan id.

Dùng rag_search khi cần tài liệu hướng dẫn/API contract, nhất là khi không chắc quy tắc tạo/sửa.
Sau khi có đủ thông tin, trả lời ngay. Không gọi tool lặp lại nếu không có câu hỏi mới rõ ràng.
Khi trả lời từ graph, không đọc lại JSON. Hãy tóm tắt đúng phần user quan tâm.`
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

      const directAnswer = response.response?.trim();
      if (directAnswer && toolResults.length === 0) {
        return {
          answer: directAnswer,
          toolsCalled
        };
      }

      if (toolResults.length > 0) {
        const finalAnswer = await createFinalAnswerFromToolResults(
          userMessage,
          toolResults,
          env,
          chatHistory,
          debugSteps
        );

        return {
          answer: finalAnswer,
          toolsCalled,
          sources: ragSources,
          embedding_debug: embeddingDebug,
          rag_query_debug: ragQueryDebug
        };
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
      if (shouldContinueAfterToolResult(toolCall.name, toolResult, userMessage)) shouldLetModelInspectToolResult = true;
    }

    if (hasRagSearchResult) {
      const finalAnswer = await createFinalAnswerFromRag(
        userMessage,
        toolResults,
        env,
        chatHistory,
        debugSteps
      );

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      };
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

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      };
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

    return {
      answer: finalAnswer,
      toolsCalled,
      sources: ragSources,
      embedding_debug: embeddingDebug,
      rag_query_debug: ragQueryDebug
    };
  }

  return {
    answer: "Đã đạt số vòng gọi công cụ tối đa nhưng chưa tạo được câu trả lời cuối cùng.",
    toolsCalled
  };
}
