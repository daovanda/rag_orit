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
import { asRecord, getStringArg } from "./utils";
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
  "app_builder_graph_overview",
  "app_builder_graph_search",
  "app_builder_graph_subgraph"
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
      if (!message) return { content: "Loi: bat buoc phai co tin nhan de tra loi." };

      addDebugStep(debugSteps, "tool.general_chat", "start", "Goi model chat thong thuong.", {
        model: GENERAL_CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const response = await runChatModel(GENERAL_CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Ban la tro ly hoi thoai.
Tra loi truc tiep bang cung ngon ngu voi nguoi hoi, tru khi nguoi hoi yeu cau ngon ngu khac.
Dung kien thuc san co cho cau hoi chung.
Khong nhac den tool/function noi bo.`
          },
          ...chatHistory,
          { role: "user", content: message }
        ]
      }, env);

      addDebugStep(debugSteps, "tool.general_chat", "ok", "general_chat tra ket qua.", {
        response_chars: (response.response ?? "").length
      });

      return { content: response.response ?? "Khong tao duoc cau tra loi." };
    }

    case "rag_search": {
      const query = getStringArg(tool.arguments, "query");
      if (!query) return { content: "Loi: bat buoc phai co cau truy van." };
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

      addDebugStep(debugSteps, `tool.${tool.name}`, "start", `Goi ${tool.name}.`, {
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

      addDebugStep(debugSteps, `tool.${tool.name}`, "start", `Goi ${tool.name}.`, {
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
      return { content: `Khong nhan dien duoc cong cu: ${tool.name}` };
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
        answer_policy: "Tom tat theo y dinh user. Khong liet ke tat ca node/edge tu overview; neu can chi tiet hay dung search/subgraph/detail."
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
          "Ke hoach chua hop le nen toi chua ghi du lieu vao Zilcode.",
          "",
          "Loi can xu ly:",
          ...errors.map((error, index) => `${index + 1}. ${String(error)}`),
          "",
          "Hay bo sung thong tin hoac cho phep toi lap lai plan voi cau truc ro hon."
        ].join("\n").trim();
      }

      const operations = Array.isArray(data.operations)
        ? data.operations.filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object")
        : [];
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];

      return [
        "Toi da chuan bi ke hoach App Builder va chua ghi du lieu vao he thong.",
        `Plan ID: ${String(data.plan_id ?? "")}`,
        `Tong so buoc: ${operations.length}.`,
        "",
        "Cac buoc se thuc hien:",
        ...operations.slice(0, 12).map((operation, index) => `${index + 1}. ${String(operation.label ?? operation.id ?? "operation")}`),
        operations.length > 12 ? `... va ${operations.length - 12} buoc nua.` : "",
        warnings.length ? "" : "",
        warnings.length ? "Luu y:" : "",
        ...warnings.slice(0, 6).map(warning => `- ${String(warning)}`),
        "",
        "Neu ban dong y, hay tra loi: \"co, thuc hien ke hoach\"."
      ].filter(Boolean).join("\n");
    }

    if (last.name === "app_builder_apply_change") {
      if (data.ok === true) {
        return [
          "Da thuc hien xong ke hoach App Builder.",
          `Plan ID: ${String(data.plan_id ?? "")}`,
          `So buoc da ghi: ${String(data.applied_count ?? 0)}.`,
          "",
          "Buoc tiep theo nen lam la doc lai App Builder graph de kiem tra app/table/window/tab/field da duoc tao dung."
        ].join("\n");
      }

      const results = Array.isArray(data.results)
        ? data.results.filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === "object")
        : [];
      const failed = results.find(result => result.ok === false);

      return [
        "Ke hoach chua duoc thuc hien thanh cong.",
        `Da ghi duoc: ${String(data.applied_count ?? 0)} buoc.`,
        `So buoc loi: ${String(data.failed_count ?? 0)}.`,
        failed ? `Dung tai: ${String(failed.operation_id ?? "")}.` : "",
        "",
        failed ? `Loi chinh: ${String(failed.error ?? data.error ?? "Khong ro loi.")}` : `Loi chinh: ${String(data.error ?? "Khong ro loi.")}`,
        "",
        "Toi chua coi thay doi nay la hoan tat. Can sua lai plan theo loi tren roi chuan bi ke hoach moi."
      ].filter(Boolean).join("\n");
    }
  } catch {
    return null;
  }

  return null;
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
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .trim();
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

function findLatestPlanId(chatHistory: AIMessage[]): string | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const content = chatHistory[i].content ?? "";
    const match = content.match(/Plan ID:\s*([0-9a-fA-F-]{16,})/);
    if (match) return match[1];
  }
  return null;
}

function normalizeVietnameseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function findLatestDeleteWindowId(chatHistory: AIMessage[]): string | null {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const id = extractWindowDeleteIdFromText(chatHistory[i].content ?? "");
    if (id) return id;
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

function extractCreateWindowRequest(message: string): { appName: string; windowName: string } | null {
  const normalized = normalizeVietnameseText(message);
  const wantsCreate = /(tao|them|add|create)/.test(normalized);
  const mentionsWindow = /(window|cua so)/.test(normalized);
  if (!wantsCreate || !mentionsWindow) return null;

  const appMatch = message.match(/\bapp\s+([^\-,.;\n]+)/i)
    ?? message.match(/ung dung\s+([^\-,.;\n]+)/i);
  const appName = appMatch?.[1]?.trim();
  if (!appName) return null;

  const explicitWindowMatch = message.match(/(?:tên|ten|name)\s+["“]?([^"”\n.,;]+)["”]?/i);
  const windowName = explicitWindowMatch?.[1]?.trim()
    || (/m[aã]u/i.test(message) || normalized.includes("mau") ? "Cua so mau" : "Window moi");

  return { appName, windowName };
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
  addDebugStep(debugSteps, "rag.final_answer", "start", "Tao cau tra loi cuoi tu RAG/context.", {
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
        content: `Ban la tro ly Zilcode.
Tra loi bang cung ngon ngu voi nguoi hoi.
Neu nguoi hoi dung tieng Viet, toan bo cau tra loi phai la tieng Viet. Khong dung heading/cum tu tieng Anh.
Du lieu co the gom RAG docs va App Builder graph tool results.
Neu tai lieu khong du, noi ro phan nao chua chac.
Khong nhac den tool/function noi bo.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Khong tao duoc cau tra loi.");
  addDebugStep(debugSteps, "rag.final_answer", "ok", "Da tao cau tra loi cuoi tu RAG/context.", {
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
    addDebugStep(debugSteps, "tools.final_answer", "ok", "Da tao cau tra loi deterministic cho App Builder change.", {
      answer_chars: deterministicAnswer.length
    });
    return deterministicAnswer;
  }

  const toolContext = truncateToolContext(formatToolResultsForFinalAnswer(toolResults));

  addDebugStep(debugSteps, "tools.final_answer", "start", "Tao cau tra loi cuoi tu ket qua tool.", {
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
        content: `Ban la tro ly Zilcode/App Builder.
Tra loi bang cung ngon ngu voi nguoi hoi.
Neu nguoi hoi dung tieng Viet, toan bo cau tra loi phai la tieng Viet. Khong dung heading/cum tu tieng Anh nhu "Proposed Change Plan", "Next steps", "Please confirm".
Hay tra loi theo dung y dinh cua user, khong ke lai toan bo JSON.
Chi neu nhung thong tin lien quan truc tiep toi cau hoi. Neu cau hoi rong, tom tat ngan gon theo nhom.
Neu nguoi dung hoi ve he thong, tra loi theo cau truc: dang nhap/role, cac app chinh, moi app co gi dang chu y, va goi y dao sau. Khong liet ke tat ca node/edge.
Neu nguoi dung hoi ve mot app/table/window/tab/field cu the, tap trung vao node do va quan he truc tiep. Khong liet ke cac phan khong lien quan.
Neu nguoi dung yeu cau tao/sua/xoa, tra loi theo kieu IDE agent: hieu yeu cau, nhung gi se thay doi, cac buoc plan, rui ro/thieu thong tin, va yeu cau xac nhan truoc khi ghi.
Dung dung ten metadata Zilcode hien tai: n_window, n_tab, n_field, n_menu hoac window/tab/field/menu. Khong tu doi sang AD_Window/AD_Tab/AD_Field neu tool khong tra ve cac ten do.
Neu da co ket qua app_builder_prepare_change, chi tom tat plan id va cac buoc; khong mo rong thanh huong dan dai.
Neu da co ket qua app_builder_apply_change, bao ro thanh cong/that bai va buoc verify tiep theo.
Khong nhac den tool/function noi bo.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${toolContext}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Khong tao duoc cau tra loi.");
  addDebugStep(debugSteps, "tools.final_answer", "ok", "Da tao cau tra loi cuoi tu ket qua tool.", {
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
  addDebugStep(debugSteps, "agent.start", "start", "Bat dau agentic loop.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    tools: TOOLS.map(tool => tool.name)
  });

  const confirmedPlanId = isPlanConfirmation(userMessage) ? findLatestPlanId(chatHistory) : null;
  if (confirmedPlanId && zilcodeSession) {
    addDebugStep(debugSteps, "agent.confirmation_auto_apply", "start", "User xac nhan pending App Builder plan, tu goi apply_change.", {
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

  const deleteWindowId = isDeleteWindowIntent(userMessage)
    ? extractWindowDeleteIdFromText(userMessage)
    : (isPrepareChangeRequest(userMessage) || isPlanConfirmation(userMessage))
      ? findLatestDeleteWindowId(chatHistory)
      : null;

  if (deleteWindowId && zilcodeSession) {
    addDebugStep(debugSteps, "agent.delete_window_prepare", "start", "Phat hien intent xoa window, tu tao pending delete plan.", {
      windowid: deleteWindowId
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "delete_window",
          summary: `Xoa vinh vien window ${deleteWindowId} cung cac tab, field va menu lien ket. Khong xoa table/column/du lieu that.`,
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
    addDebugStep(debugSteps, "agent.create_window_prepare", "start", "Phat hien intent tao window, tu tao pending create_window plan.", {
      app_name: createWindowRequest.appName,
      window_name: createWindowRequest.windowName
    });

    const toolExecution = await executeTool(
      {
        name: "app_builder_prepare_change",
        arguments: {
          intent: "add_window",
          summary: `Tao them window "${createWindowRequest.windowName}" cho app "${createWindowRequest.appName}".`,
          operations: [
            {
              id: "create_window_1",
              op: "create_window",
              record: {
                app_name: createWindowRequest.appName,
                windowname: createWindowRequest.windowName,
                windowtype: "window"
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

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Ban la tro ly AI cho Zilcode va App Builder.
Tra loi bang cung ngon ngu voi nguoi dung.
Neu nguoi dung viet tieng Viet, bat buoc tra loi tieng Viet. Khong chuyen sang tieng Anh ke ca tieu de, bang bieu, hoac loi nhac xac nhan.

Tools:
- general_chat: dung cho hoi thoai thong thuong, khong can RAG/Zilcode.
- rag_search: dung khi can docs/guide/API contract/playbook.
- app_builder_graph_overview: dung dau tien khi can doc App Builder hien tai. Tool nay tra skeleton graph.
- app_builder_graph_search: tim node app/table/window/tab/field/menu/domain theo ten/id.
- app_builder_graph_subgraph: mo vung graph lien quan quanh node.
- app_builder_node_detail: lay chi tiet node cu the.
- app_builder_creation_schema: lay quy tac tao/sua va proposed plan format.
- app_builder_prepare_change: chuan bi plan tao/sua/xoa, validate, loc payload theo metadata that, luu pending plan. Chua ghi.
- app_builder_apply_change: chi goi sau khi user xac nhan ro rang va co plan_id tu prepare_change.

Graph-first workflow:
1. Neu cau hoi lien quan App Builder/Zilcode hien tai, goi app_builder_graph_overview truoc.
2. Neu can tim mot doi tuong, goi app_builder_graph_search.
3. Neu can hieu quan he quanh doi tuong, goi app_builder_graph_subgraph.
4. Neu can lap plan chinh xac hoac tra loi chi tiet, goi app_builder_node_detail.
5. Neu user muon tao/sua/xoa, goi app_builder_creation_schema va app_builder_prepare_change de tao pending plan.
6. Chi goi app_builder_apply_change khi user vua xac nhan ro rang va co plan_id hop le trong lich su hoi thoai.
Neu user yeu cau xoa window theo id, khong hoi lap lai qua nhieu vong. Hay tao pending plan delete_window cascade bang app_builder_prepare_change; apply chi sau khi user xac nhan plan id.

Dung rag_search khi can tai lieu huong dan/API contract, nhat la khi khong chac quy tac tao/sua.
Sau khi co du thong tin, tra loi ngay. Khong goi tool lap lai neu khong co cau hoi moi ro rang.
Khi tra loi tu graph, khong doc lai JSON. Hay tom tat dung phan user quan tam.`
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
    addDebugStep(debugSteps, "agent.tool_selection", "start", "Model chon tool hoac tra loi truc tiep.", {
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
      addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model khong goi tool, tra loi truc tiep.", {
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
        answer: "Khong tao duoc cau tra loi.",
        toolsCalled
      };
    }

    const supportedToolCalls = response.tool_calls.filter(toolCall => AVAILABLE_TOOL_NAMES.has(toolCall.name));
    const skippedUnsupportedToolCalls = response.tool_calls
      .filter(toolCall => !AVAILABLE_TOOL_NAMES.has(toolCall.name))
      .map(toolCall => toolCall.name);

    if (!supportedToolCalls.length) {
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chon tool khong duoc ho tro.", {
        iteration: i + 1,
        tool_calls: response.tool_calls.map(toolCall => toolCall.name),
        skipped_tool_calls: skippedUnsupportedToolCalls
      });

      return {
        answer: response.response ?? "Model da chon tool khong con duoc ho tro. Hay thu hoi lai theo cach khac.",
        toolsCalled
      };
    }

    const hasRagSearchCall = supportedToolCalls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? supportedToolCalls.filter(toolCall => toolCall.name !== "general_chat")
      : supportedToolCalls;

    addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model da chon tool.", {
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
      addDebugStep(debugSteps, "tool.call", "start", `Goi tool ${toolCall.name}.`, {
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
      if (GRAPH_CONTINUE_TOOLS.has(toolCall.name)) shouldLetModelInspectToolResult = true;
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
        addDebugStep(debugSteps, "agent.graph_continue", "ok", "Dua graph/search/subgraph ve model de quyet dinh tra loi hoac goi detail.", {
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

  addDebugStep(debugSteps, "agent.stop", "error", "Dat so vong goi tool toi da.", {
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
    answer: "Da dat so vong goi cong cu toi da nhung chua tao duoc cau tra loi cuoi cung.",
    toolsCalled
  };
}
