import {
  CHAT_MODEL,
  CHART_IMAGE_MODEL,
  GENERAL_CHAT_MAX_TOKENS,
  GENERAL_CHAT_MODEL,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_MESSAGES,
  RAG_FINAL_MAX_TOKENS,
  TOOL_RESULT_CONTEXT_MAX_CHARS,
  TOOL_SELECTION_MAX_TOKENS,
  type Env
} from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { generateChartImage, runChatModel, searchRag } from "./ai";
import { TOOLS } from "./tools";
import { asRecord, getStringArg, truncateDebugText } from "./utils";
import {
  getWriteToolRoute,
  getWriteToolTarget,
  applyAppBuilderPlan,
  prepareAppBuilderPlan,
  validateAppBuilderPlan,
  writeAppBuilderRecord
} from "./app-builder-write";
import {
  buildZilcodeAppBuilderBlueprint,
  getBlueprintMode,
  getLimitArg,
  getNodeIdsArg,
  getOptionalBooleanArg,
  noZilcodeSessionResult,
  type ZilcodeSessionState
} from "./zilcode";

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolExecutionResult {
  content: string;
  sources?: RagSource[];
  embedding_debug?: EmbeddingDebug;
  rag_query_debug?: RagQueryDebug;
}

interface EmbeddingDebug {
  provider: "cloudflare" | "openrouter";
  model: string;
  dimensions: number;
  fallback: boolean;
}

interface RagQueryDebug {
  original_query: string;
  rewritten_query: string;
  used: boolean;
  reason: string;
  model?: string;
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

      addDebugStep(debugSteps, "tool.general_chat", "start", "Gọi model chat thường.", {
        model: GENERAL_CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const response = await runChatModel(GENERAL_CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Bạn là trợ lý hội thoại.
Hãy trả lời trực tiếp bằng cùng ngôn ngữ với người hỏi, trừ khi người hỏi yêu cầu ngôn ngữ khác.
Bạn có thể dùng kiến thức sẵn có để trả lời câu hỏi chung.
Nếu người dùng hỏi bạn là ai, hãy nói bạn là trợ lý AI có thể trò chuyện thông thường và hỗ trợ tra cứu thông tin Zilcode khi cần.
Trả lời ngắn gọn, tự nhiên, không nhắc đến function/tool nội bộ.`
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

    case "zilcode_get_app_builder_blueprint": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const mode = getBlueprintMode(tool.arguments);

      addDebugStep(debugSteps, "tool.zilcode_get_app_builder_blueprint", "start", "Lấy App Builder blueprint.", {
        mode,
        appid: getStringArg(tool.arguments, "appid") || undefined,
        node_id: getStringArg(tool.arguments, "node_id") || undefined,
        node_ids: getNodeIdsArg(tool.arguments),
        depth: getLimitArg(tool.arguments, "depth", 1, 4),
        include_fields: getOptionalBooleanArg(tool.arguments, "include_fields", mode === "detail"),
        include_raw: getOptionalBooleanArg(tool.arguments, "include_raw", false),
        include_records: getOptionalBooleanArg(tool.arguments, "include_records", true),
        max_records_per_table: getLimitArg(tool.arguments, "max_records_per_table", 500, 5000)
      });

      const blueprint = await buildZilcodeAppBuilderBlueprint(env, zilcodeSession.session, tool.arguments);
      const graph = asRecord(blueprint.graph);
      const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes.length : undefined;
      const graphEdges = Array.isArray(graph?.edges) ? graph.edges.length : undefined;
      const appErrors = Array.isArray(blueprint.errors)
        ? blueprint.errors
          .filter((error): error is Record<string, unknown> => Boolean(error) && typeof error === "object")
          .map(error => ({
            appid: error.appid,
            app_name: error.app_name,
            error: truncateDebugText(error.error)
          }))
        : [];
      const windowErrors = Array.isArray(graph?.nodes)
        ? graph.nodes
          .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object")
          .map(node => ({
            id: node.id,
            type: node.type,
            label: node.label,
            appid: node.appid,
            summary: asRecord(node.summary)
          }))
          .filter(node => node.type === "window" && node.summary?.error)
          .map(node => ({
            node_id: node.id,
            appid: node.appid,
            windowid: node.summary?.windowid,
            label: node.label,
            error: truncateDebugText(node.summary?.error)
          }))
        : [];
      const recordErrors = Array.isArray(asRecord(blueprint.app_builder_records)?.errors)
        ? asRecord(blueprint.app_builder_records)?.errors
        : [];

      addDebugStep(debugSteps, "tool.zilcode_get_app_builder_blueprint", "ok", "Đã lấy App Builder blueprint.", {
        mode: blueprint.mode,
        scan: blueprint.scan,
        apps_count: blueprint.apps_count,
        graph_nodes: graphNodes,
        graph_edges: graphEdges,
        app_errors_count: appErrors.length,
        app_errors: appErrors,
        window_errors_count: windowErrors.length,
        window_errors: windowErrors,
        record_errors_count: Array.isArray(recordErrors) ? recordErrors.length : 0,
        record_errors: recordErrors
      });

      return { content: JSON.stringify(blueprint, null, 2) };
    }

    case "app_builder_validate_plan": {
      if (!zilcodeSession) return noZilcodeSessionResult();

      addDebugStep(debugSteps, "tool.app_builder_validate_plan", "start", "Validate kế hoạch ghi App Builder.", {
        has_plan: Boolean(tool.arguments.plan),
        actions_count: Array.isArray(tool.arguments.actions) ? tool.arguments.actions.length : undefined
      });

      const validation = await validateAppBuilderPlan(env, zilcodeSession.session, tool.arguments);

      addDebugStep(debugSteps, "tool.app_builder_validate_plan", "ok", "Đã validate kế hoạch ghi App Builder.", {
        valid: validation.valid,
        blocking_errors_count: Array.isArray(validation.blocking_errors) ? validation.blocking_errors.length : 0,
        warnings_count: Array.isArray(validation.warnings) ? validation.warnings.length : 0
      });

      return { content: JSON.stringify(validation, null, 2) };
    }

    case "app_builder_prepare_plan": {
      if (!zilcodeSession) return noZilcodeSessionResult();

      addDebugStep(debugSteps, "tool.app_builder_prepare_plan", "start", "Chuẩn bị pending plan App Builder.", {
        has_plan: Boolean(tool.arguments.plan),
        operations_count: Array.isArray(tool.arguments.operations) ? tool.arguments.operations.length : undefined
      });

      const prepared = await prepareAppBuilderPlan(env, zilcodeSession.session, zilcodeSession.id, tool.arguments);

      addDebugStep(debugSteps, "tool.app_builder_prepare_plan", "ok", "Đã chuẩn bị pending plan App Builder.", {
        status: prepared.status,
        valid: prepared.valid,
        plan_id: prepared.plan_id,
        requires_confirmation: prepared.requires_confirmation,
        blocking_errors_count: Array.isArray(prepared.blocking_errors) ? prepared.blocking_errors.length : 0,
        warnings_count: Array.isArray(prepared.warnings) ? prepared.warnings.length : 0
      });

      return { content: JSON.stringify(prepared, null, 2) };
    }

    case "app_builder_apply_plan": {
      if (!zilcodeSession) return noZilcodeSessionResult();

      addDebugStep(debugSteps, "tool.app_builder_apply_plan", "start", "Apply pending plan App Builder.", {
        plan_id: getStringArg(tool.arguments, "plan_id"),
        confirmed: tool.arguments.confirmed === true || tool.arguments.confirmed === "true"
      });

      const applied = await applyAppBuilderPlan(env, zilcodeSession.session, zilcodeSession.id, tool.arguments);

      addDebugStep(debugSteps, "tool.app_builder_apply_plan", applied.ok ? "ok" : "skip", "Đã chạy apply pending plan App Builder.", {
        ok: applied.ok,
        status: applied.status,
        plan_id: applied.plan_id,
        applied_count: applied.applied_count,
        failed_count: applied.failed_count,
        blocked: applied.blocked
      });

      return { content: JSON.stringify(applied, null, 2) };
    }

    default:
      if (tool.name.startsWith("app_builder_create_") || tool.name.startsWith("app_builder_update_")) {
        if (!zilcodeSession) return noZilcodeSessionResult();

        const mode = getWriteToolRoute(tool.name);
        const target = getWriteToolTarget(tool.name);
        if (!mode || !target) {
          return { content: `Không nhận diện được write tool App Builder: ${tool.name}` };
        }

        addDebugStep(debugSteps, "tool.app_builder_write", "start", "Gọi write tool App Builder.", {
          tool: tool.name,
          mode,
          target,
          confirmed: tool.arguments.confirmed === true || tool.arguments.confirmed === "true"
        });

        const result = await writeAppBuilderRecord(env, zilcodeSession.session, {
          mode,
          target,
          args: tool.arguments
        });

        addDebugStep(debugSteps, "tool.app_builder_write", result.ok ? "ok" : "skip", "Write tool App Builder đã trả kết quả.", {
          tool: tool.name,
          mode,
          target,
          ok: result.ok,
          blocked: result.blocked,
          endpoint: result.endpoint
        });

        return { content: JSON.stringify(result, null, 2) };
      }
      return { content: `Không nhận diện được công cụ: ${tool.name}` };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────


interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface GeneratedImage {
  mime_type: "image/png";
  data_url: string;
  prompt: string;
  width: number;
  height: number;
}

interface RagSource {
  id: string;
  title?: string;
  filename?: string;
  source_path?: string;
  module: string;
  doc_group?: string;
  logic_area?: string;
  audience?: string;
  section_path?: string;
  heading: string;
  vector_score?: number;
  rerank_rank?: number;
}

interface AgenticLoopResult {
  answer: string;
  toolsCalled: string[];
  images?: GeneratedImage[];
  sources?: RagSource[];
  embedding_debug?: EmbeddingDebug;
  rag_query_debug?: RagQueryDebug;
}

interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

interface ToolResultRecord {
  name: string;
  content: string;
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6;
const AVAILABLE_TOOL_NAMES = new Set(TOOLS.map(tool => tool.name));

function formatToolResultsForFinalAnswer(toolResults: ToolResultRecord[]): string {
  return toolResults
    .map((result, index) => [
      `[KET_QUA_CONG_CU ${index + 1}: ${result.name}]`,
      compactToolContentForFinalAnswer(result),
      `[HET_KET_QUA_CONG_CU ${index + 1}]`
    ].join("\n"))
    .join("\n\n");
}

function compactToolContentForFinalAnswer(result: ToolResultRecord): string {
  if (result.name !== "zilcode_get_app_builder_blueprint") return result.content;

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
          appid: node.appid,
          counts: node.counts,
          summary: node.summary
        }))
      : [];
    const edges = Array.isArray(graph?.edges)
      ? graph.edges
        .filter((edge): edge is Record<string, unknown> => Boolean(edge) && typeof edge === "object")
        .map(edge => ({
          from: edge.from,
          to: edge.to,
          type: edge.type,
          metadata: edge.metadata
        }))
      : [];

    return JSON.stringify({
      mode: data.mode,
      session: asRecord(data.overview)?.session ?? data.session,
      scan: data.scan,
      filters: data.filters,
      apps_count: data.apps_count,
      overview: data.overview,
      app_builder_records: data.app_builder_records,
      graph: graph ? {
        node_counts: graph.node_counts,
        edge_count: graph.edge_count,
        nodes,
        edges
      } : undefined,
      details_count: data.details_count,
      details: data.details,
      errors: data.errors,
      note: data.note
    }, null, 2);
  } catch {
    return result.content;
  }
}

function truncateToolContext(context: string): string {
  if (context.length <= TOOL_RESULT_CONTEXT_MAX_CHARS) return context;

  return [
    context.slice(0, TOOL_RESULT_CONTEXT_MAX_CHARS).trim(),
    "",
    `[GHI_CHU_HE_THONG: Ket qua tool da duoc cat bot vi qua dai. Do dai goc: ${context.length} ky tu.]`
  ].join("\n");
}

function cleanMarkdownArtifacts(answer: string): string {
  return answer
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function isAppBuilderWriteTool(name: string): boolean {
  return name.startsWith("app_builder_create_") || name.startsWith("app_builder_update_");
}

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isAppBuilderWriteIntent(userMessage: string, chatHistory: AIMessage[]): boolean {
  const current = normalizeIntentText(userMessage);
  const recentContext = normalizeIntentText(chatHistory.slice(-6).map(message => message.content).join("\n"));
  const text = `${recentContext}\n${current}`;

  const hasWriteVerb = /\b(tao|them|sua|cap nhat|chinh sua|ghi|thuc hien|tien hanh|hay tao|tao di)\b/.test(current);
  const hasAppBuilderObject = /\b(app|ung dung|table|bang|column|cot|window|man hinh|tab|field|truong|menu|domain)\b/.test(text);
  const hasManagementAppContext = /\b(quan ly|don hang|khach hang|san pham|order|customer|product)\b/.test(text);

  return hasWriteVerb && (hasAppBuilderObject || hasManagementAppContext);
}

function isAppBuilderConfirmation(userMessage: string, chatHistory: AIMessage[]): boolean {
  const current = normalizeIntentText(userMessage);
  const recentContext = normalizeIntentText(chatHistory.slice(-6).map(message => message.content).join("\n"));
  const compact = current.replace(/\s+/g, " ").trim();
  const asksForNewOrChangedPlan = /\b(tu tao|thu tao|don gian hon|don giản hon|voi cac truong|cac truong|theo y|ten ung dung|ung dung do|app don gian|ke hoach moi|chinh lai|sua lai)\b/.test(compact);
  if (asksForNewOrChangedPlan) return false;

  const shortConfirmation = /^(co|dong y|ok|okay|duoc|chot|xac nhan|apply|tien hanh|thuc hien|tiep tuc|hay thuc hien|hay tao di|tao di)(\b|[.!?])/.test(compact);
  const explicitExecution = /\b(thuc hien ke hoach|tien hanh ke hoach|apply plan|hay thuc hien ke hoach|hay tao di|tao di)\b/.test(compact);
  const hasConfirmation = shortConfirmation || explicitExecution;
  const hasPlanContext = /\b(plan id|ke hoach|xac nhan|prepare_plan|pending plan|thuc thi|thuc hien ke hoach)\b/.test(recentContext);

  return hasConfirmation && hasPlanContext;
}

function hasToolResult(toolResults: ToolResultRecord[], name: string): boolean {
  return toolResults.some(result => result.name === name);
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
  addDebugStep(debugSteps, "rag.final_answer", "start", "Tạo câu trả lời cuối từ context RAG.", {
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
        content: `Bạn là trợ lý hỗ trợ Zilcode.
Hãy trả lời bằng cùng ngôn ngữ với người hỏi.
Dựa chủ yếu vào kết quả rag_search trong ngữ cảnh được cung cấp.
Nếu có kết quả general_chat trong ngữ cảnh, chỉ xem là thông tin phụ; không dùng nó để phủ định hoặc thay thế tài liệu Zilcode.
Nếu tài liệu không đủ thông tin, hãy nói rõ phần nào chưa tìm thấy trong tài liệu hiện có.
Không nhắc đến tool/function nội bộ.
Tài liệu nguồn có thể chứa cú pháp Markdown như ###, -, +, ** hoặc dấu backtick. Không sao chép các ký tự định dạng đó vào câu trả lời cuối; hãy chuyển thành văn bản sạch, tự nhiên.
Trả lời đúng mức chi tiết theo yêu cầu của người dùng. Nếu người dùng yêu cầu chi tiết, hãy chia thành các phần/bước rõ ràng; nếu không yêu cầu chi tiết, hãy trả lời gọn.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Ngữ cảnh từ các công cụ:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Không tạo được câu trả lời.");
  addDebugStep(debugSteps, "rag.final_answer", "ok", "Đã tạo câu trả lời cuối từ RAG.", {
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
  const toolContext = truncateToolContext([
    formatToolResultsForFinalAnswer(toolResults),
    `[HUONG_DAN_TRA_LOI_APP_BUILDER_WRITE]
Nếu context có app_builder_validate_plan:
- valid=false hoặc có blocking_errors: liệt kê lỗi cần sửa, hỏi lại thông tin còn thiếu, không nói là đã tạo/cập nhật.
- valid=true: trình bày plan ngắn gọn theo các bước sẽ ghi và hỏi người dùng xác nhận. Không nói là đã tạo. Không yêu cầu người dùng tự thao tác thủ công nếu agent có write tool.
Nếu context có app_builder_prepare_plan:
- valid=true và có plan_id: trình bày summary ngắn gọn, nêu plan_id nếu cần debug, và hỏi người dùng xác nhận để apply. Không nói là đã tạo.
- valid=false hoặc status=invalid/need_user_input: liệt kê lỗi hoặc thông tin thiếu, hỏi lại đúng phần thiếu.
Nếu context có app_builder_apply_plan:
- ok=true: nói rõ đã apply xong, tóm tắt số bước đã thực hiện và nói đã verify lại blueprint.
- ok=false/blocked=true: giải thích lý do chưa apply.
Nếu context có write tool App Builder:
- blocked=true: giải thích lý do bị chặn.
- ok=true: nói rõ record đã ghi và cần đọc lại blueprint để xác minh.
[HET_HUONG_DAN_TRA_LOI_APP_BUILDER_WRITE]`,
    `[APP_BUILDER_PLAN_OUTPUT_RULES]
Neu co app_builder_prepare_plan va valid=true:
- Phai noi ro day moi la ke hoach cho xac nhan, chua ghi du lieu.
- Phai dua plan_id vao cau tra loi theo dang: Plan ID: <plan_id>.
- Hoi user xac nhan de thuc thi.
Neu co app_builder_apply_plan:
- Chi noi da tao/cap nhat khi ok=true.
- Neu status=partial_success, noi ro da ghi duoc bao nhieu buoc va buoc nao loi.
[END_APP_BUILDER_PLAN_OUTPUT_RULES]`
  ].join("\n\n"));

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
        content: `Bạn là trợ lý hỗ trợ Zilcode.
Hãy trả lời bằng cùng ngôn ngữ với người hỏi.
Dựa vào kết quả công cụ read-only đã cung cấp để trả lời câu hỏi.
Không nhắc đến tool/function nội bộ.
Nếu kết quả có lỗi hoặc phần chưa lấy được, hãy nói rõ phần nào chưa đọc được thay vì bỏ qua.
Nếu kết quả có trường overview, hãy ưu tiên dùng overview để trả lời phần tổng quan; chỉ dùng graph/details để bổ sung khi cần.
Viết cho người dùng cuối đọc, không viết như log kỹ thuật. Không mở đầu bằng tên tool. Không dùng bảng Markdown dài.
Với câu hỏi tổng quan như "hệ thống của tôi hiện tại", hãy trình bày ngắn gọn theo thứ tự:
1. Người dùng đang đăng nhập với role/org nào.
2. Hệ thống đang có bao nhiêu app.
3. Mỗi app chính dùng để làm gì hoặc đang có bao nhiêu bảng/menu/window/domain/relation.
4. Nêu vài ví dụ tiêu biểu, không liệt kê toàn bộ bảng nếu có nhiều.
5. Nói rõ phần nào chưa đọc được hoặc có lỗi.
Kết thúc bằng một gợi ý hỏi sâu tự nhiên, ví dụ xem chi tiết app, window, bảng hoặc quan hệ.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Ngữ cảnh từ các công cụ:\n${toolContext}`
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

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Bạn là trợ lý AI hội thoại và trợ lý hỗ trợ nền tảng Zilcode.
Hãy trả lời bằng cùng ngôn ngữ với người hỏi. Nếu người hỏi yêu cầu một ngôn ngữ hoặc phong cách cụ thể, hãy làm theo yêu cầu đó.
Bạn có các công cụ để xử lý từng loại yêu cầu. Hãy chọn công cụ phù hợp nhất thay vì nói rằng yêu cầu nằm ngoài phạm vi công cụ.
Dùng general_chat cho chào hỏi, cảm ơn, trò chuyện thông thường, hỏi bạn là ai/có thể làm gì, hỏi bạn có trả lời ngoài Zilcode không, câu hỏi kiến thức chung, hoặc câu hỏi không liên quan đến Zilcode.
Chỉ dùng rag_search khi câu hỏi cần thông tin cụ thể từ tài liệu Zilcode, ví dụ tính năng, khái niệm, hướng dẫn thao tác, hoặc cách sử dụng Zilcode.
Nếu Zilcode là chủ đề chính cần giải thích, hoặc người dùng hỏi Zilcode là gì, tính năng/cách dùng/hướng dẫn thao tác trong Zilcode, hãy ưu tiên rag_search thay vì general_chat.
Dùng draw_chart khi người dùng yêu cầu vẽ/tạo ảnh biểu đồ, sơ đồ, flowchart, timeline, mindmap, dashboard mockup hoặc infographic. Với biểu đồ cần số liệu chính xác tuyệt đối, hãy nói ngắn gọn rằng ảnh AI chỉ mang tính minh họa và vẫn có thể tạo ảnh nếu người dùng muốn.
Bộ công cụ hiện tại gồm: general_chat, rag_search, draw_chart, zilcode_get_app_builder_blueprint.
Khi cần đọc cấu hình thật cho Role System dùng App Builder, dùng zilcode_get_app_builder_blueprint theo flow graph-first: gọi mode=graph trước để lấy bản đồ compact của App Builder gồm applications, tables, columns, windows, tabs, fields, menus, domains, relations và các cạnh quan hệ. Nếu graph đã đủ để trả lời thì trả lời ngay. Nếu cần đào sâu một app/window/tab/table/field cụ thể, gọi lại mode=subgraph hoặc mode=detail với node_id/node_ids lấy từ graph.
Khi trả lời từ App Builder blueprint, hãy viết dễ hiểu cho người dùng cấu hình hệ thống: ưu tiên trường overview và app_builder_records.inventory nếu có, không nhắc tên tool, không dùng bảng dài khi không cần. Danh sách app thật cần phân tích nằm trong app_builder_records.inventory.apps, không phải danh sách app trong session. Hãy tập trung vào App Builder, app hiện có, bảng, cột, window, tab, field, menu và các ràng buộc cấu hình.
Khi dùng rag_search, thường chỉ gọi một lần với query tổng hợp tốt. Chỉ gọi lại nếu kết quả chưa đủ và query mới khác rõ ràng về ý định hoặc phạm vi; không gọi lại cùng query hoặc query tương đương.
Dùng zilcode_get_app_builder_blueprint khi người dùng hỏi dữ liệu/cấu trúc App Builder thật của tài khoản đang đăng nhập: hiện có app nào, app có bảng nào, bảng có cột nào, window/tab/field/menu hiện có ra sao, hoặc cần chuẩn bị tạo app/window/tab/table/field. Nếu chưa đăng nhập Zilcode, hãy yêu cầu người dùng đăng nhập ở giao diện chat trước.
Với câu hỏi ngoài phạm vi Zilcode, hãy dùng general_chat.
Sau khi đã có đủ thông tin từ công cụ, hãy trả lời ngay thay vì tiếp tục gọi thêm công cụ. Nếu general_chat đã trả lời và chưa dùng rag_search, hãy dùng nội dung đó làm cơ sở cho câu trả lời cuối cùng.
Khi đã dùng rag_search và có kết quả, không gọi general_chat để hỏi lại kiến thức chung; hãy tổng hợp câu trả lời từ kết quả rag_search.
Khi đã dùng rag_search nhưng không tìm thấy thông tin phù hợp, hãy nói rõ là chưa tìm thấy trong tài liệu hiện có thay vì bịa nội dung.
Trả lời đúng mức chi tiết theo yêu cầu của người dùng, cụ thể và ưu tiên các bước thao tác rõ ràng.`
    },
    {
      role: "system",
      content: `Quy tắc ghi App Builder:
- Bộ tool ghi hiện có: app_builder_validate_plan và các app_builder_create_*/app_builder_update_* cho app, table, column, window, tab, field, menu, domain.
- Với yêu cầu tạo/sửa App Builder, luôn đọc zilcode_get_app_builder_blueprint trước. Nếu cần playbook, gọi rag_search với tài liệu app-builder-agent-create-guide.
- Sau khi hiểu blueprint, hãy lập plan có steps rõ ràng rồi gọi app_builder_validate_plan.
- Nếu validate có blocking_errors, không gọi write tool; hãy hỏi lại hoặc sửa plan.
- Nếu validate hợp lệ, hãy trình bày plan cho người dùng xác nhận. Không gọi create/update tool trong cùng lượt nếu người dùng chưa xác nhận rõ ràng.
- Chỉ truyền confirmed=true cho create/update tool khi người dùng đã xác nhận plan ở lượt trước hoặc trong câu hiện tại một cách rõ ràng.
- Mỗi create/update tool chỉ ghi một record metadata. Với thao tác nhiều bước, gọi các write tool theo thứ tự phụ thuộc: app -> table -> column -> window -> tab -> field -> menu/domain.
- Sau bất kỳ write tool thành công nào, phải gọi lại zilcode_get_app_builder_blueprint để xác minh record và quan hệ đã xuất hiện đúng trước khi báo hoàn tất.
- Không tự bịa ID. ID phải lấy từ blueprint hoặc từ kết quả create trả về. Update phải dùng key_value/where rõ ràng.`
    },
    {
      role: "system",
      content: `Quy trình chuẩn cho tạo/sửa App Builder:
- Ưu tiên dùng app_builder_prepare_plan thay cho app_builder_validate_plan và các low-level create/update tool khi yêu cầu có nhiều bước hoặc cần tự resolve ID.
- Khi người dùng muốn tạo app mới, thêm/sửa table, column, window, tab, field, menu hoặc domain: đọc zilcode_get_app_builder_blueprint nếu chưa có context, sau đó gọi app_builder_prepare_plan với plan nghiệp vụ.
- app_builder_prepare_plan sẽ resolve ID, validate và lưu pending plan. Nếu tool trả valid=true và plan_id, hãy trình bày summary và hỏi người dùng xác nhận.
- Khi người dùng xác nhận rõ ràng, gọi app_builder_apply_plan với plan_id và confirmed=true. Không tự dựng lại plan mới nếu đã có plan_id trong lượt trước.
- app_builder_apply_plan là executor tuần tự: nó tự map appid/tableid/windowid/tabid/columnid sau mỗi bước và verify lại blueprint.
- Các app_builder_create_*/app_builder_update_* chỉ dùng cho thao tác nhỏ một record khi đã có đủ ID, không dùng để tự điều phối một workflow lớn.`
    },
    {
      role: "system",
      content: `Dieu phoi workflow App Builder (bat buoc):
- Neu user muon tao app moi hoac sua/them table, column, window, tab, field, menu, domain trong app da co, khong chi huong dan thao tac thu cong.
- Neu thong tin nghiep vu da du de de xuat cau truc, hay goi zilcode_get_app_builder_blueprint truoc, sau do goi app_builder_prepare_plan.
- Neu user noi "tu them", "tu de xuat", "demo co ban", "sao cho phu hop", hay tu lap cau truc hop ly thay vi hoi lai qua nhieu.
- app_builder_prepare_plan la buoc validate va luu pending plan, chua ghi du lieu. Sau khi prepare thanh cong, chi trinh bay tom tat plan va hoi xac nhan.
- Khi user xac nhan bang cac cau nhu "dong y", "co", "hay tao", "tien hanh", phai goi app_builder_apply_plan voi confirmed=true. Co the bo qua plan_id neu pending plan moi nhat cua session van con hieu luc.
- Sau app_builder_apply_plan, dua ket qua thuc thi: so buoc da ghi, buoc loi neu co, va trang thai verify. Khong noi da tao neu apply_plan chua chay thanh cong.
- Neu prepare_plan tra blocking_errors, sua plan neu co the; neu van thieu thong tin bat buoc moi hoi user.`
    },
    ...chatHistory,
    {
      role: "user",
      content: userMessage
    }
  ];

  const toolsCalled: string[] = [];
  const toolResults: ToolResultRecord[] = [];
  const ragSources: RagSource[] = [];
  let embeddingDebug: EmbeddingDebug | undefined;
  let ragQueryDebug: RagQueryDebug | undefined;
  let hasRagSearchResult = false;
  const appBuilderWriteIntent = isAppBuilderWriteIntent(userMessage, chatHistory);
  let appBuilderWorkflowNudges = 0;

  if (zilcodeSession && isAppBuilderConfirmation(userMessage, chatHistory)) {
    addDebugStep(debugSteps, "agent.confirmation_auto_apply", "start", "User xác nhận pending plan App Builder, tự gọi apply_plan.", {
      confirmed_message_chars: userMessage.length
    });

    toolsCalled.push("app_builder_apply_plan");
    const applied = await applyAppBuilderPlan(env, zilcodeSession.session, zilcodeSession.id, {
      confirmed: true,
      confirmation_note: userMessage
    });
    const applyResult = {
      name: "app_builder_apply_plan",
      content: JSON.stringify(applied, null, 2)
    };

    addDebugStep(debugSteps, "agent.confirmation_auto_apply", applied.ok ? "ok" : "skip", "Đã xử lý xác nhận pending plan App Builder.", {
      ok: applied.ok,
      status: applied.status,
      plan_id: applied.plan_id,
      applied_count: applied.applied_count,
      failed_count: applied.failed_count,
      blocked: applied.blocked
    });

    const finalAnswer = await createFinalAnswerFromToolResults(
      userMessage,
      [applyResult],
      env,
      chatHistory,
      debugSteps
    );

    return {
      answer: finalAnswer,
      toolsCalled
    };
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[VÒNG LẶP] Lần ${i + 1}`);
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
      console.log(`[VÒNG LẶP] Không có tool call, trả về câu trả lời cuối cùng`);
      addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model không gọi tool, trả lời trực tiếp.", {
        iteration: i + 1,
        response_chars: (response.response ?? "").length
      });

      const directAnswer = response.response?.trim();
      if (directAnswer) {
        if (
          appBuilderWriteIntent
          && appBuilderWorkflowNudges < 2
          && i < MAX_ITERATIONS - 1
          && !hasToolResult(toolResults, "app_builder_prepare_plan")
          && !hasToolResult(toolResults, "app_builder_apply_plan")
        ) {
          appBuilderWorkflowNudges++;
          addDebugStep(debugSteps, "agent.app_builder_workflow_nudge", "start", "Model trả lời trực tiếp cho yêu cầu ghi App Builder; yêu cầu model quay lại prepare_plan.", {
            nudge_count: appBuilderWorkflowNudges,
            has_blueprint: hasToolResult(toolResults, "zilcode_get_app_builder_blueprint")
          });

          messages.push({
            role: "assistant",
            content: directAnswer
          });
          messages.push({
            role: "system",
            content: hasToolResult(toolResults, "zilcode_get_app_builder_blueprint")
              ? "Yeu cau hien tai la workflow ghi App Builder. Khong tra loi truc tiep nua. Hay goi app_builder_prepare_plan voi plan cu the de tao/sua metadata theo yeu cau user."
              : "Yeu cau hien tai la workflow ghi App Builder. Khong tra loi truc tiep nua. Hay goi zilcode_get_app_builder_blueprint truoc, sau do goi app_builder_prepare_plan."
          });
          continue;
        }

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
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chọn tool không còn được hỗ trợ, bỏ qua tool call.", {
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
    let toolCallsToExecute = hasRagSearchCall
      ? supportedToolCalls.filter(toolCall => toolCall.name !== "general_chat")
      : supportedToolCalls;

    if (
      appBuilderWriteIntent
      && toolCallsToExecute.length > 0
      && toolCallsToExecute.every(toolCall => toolCall.name === "general_chat")
    ) {
      addDebugStep(debugSteps, "agent.app_builder_tool_override", "ok", "Model chọn general_chat cho yêu cầu ghi App Builder; chuyển sang đọc blueprint.", {
        original_tool_calls: toolCallsToExecute.map(toolCall => toolCall.name)
      });
      toolCallsToExecute = [{
        name: "zilcode_get_app_builder_blueprint",
        arguments: { mode: "graph" }
      }];
    }

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
      console.log(`[CÔNG CỤ] Gọi: ${toolCall.name}`, toolCall.arguments);
      toolsCalled.push(toolCall.name);
      addDebugStep(debugSteps, "tool.call", "start", `Gọi tool ${toolCall.name}.`, {
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      if (toolCall.name === "draw_chart") {
        const image = await generateChartImage(toolCall.arguments, env);
        addDebugStep(debugSteps, "tool.draw_chart", "ok", "Đã tạo ảnh biểu đồ.", {
          width: image.width,
          height: image.height,
          model: CHART_IMAGE_MODEL
        });

        return {
          answer: "Mình đã tạo biểu đồ theo yêu cầu. Lưu ý: ảnh do mô hình tạo sinh phù hợp để minh họa, không nên dùng làm biểu đồ số liệu cần độ chính xác tuyệt đối.",
          toolsCalled,
          images: [image]
        };
      }

      const toolExecution = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        chatHistory,
        debugSteps,
        zilcodeSession
      );
      const toolResult = toolExecution.content;

      console.log(`[CÔNG CỤ] Độ dài kết quả: ${toolResult.length} ký tự`);
      addDebugStep(debugSteps, "tool.call", "ok", `Tool ${toolCall.name} đã trả kết quả.`, {
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

      if (toolCall.name === "general_chat") {
        generalChatResult = toolResult;
      }

      if (toolCall.name === "rag_search") {
        hasRagSearchResult = true;
      }

      if (toolCall.name === "zilcode_get_app_builder_blueprint") {
        const blueprintMode = getBlueprintMode(toolCall.arguments);
        shouldLetModelInspectToolResult = blueprintMode === "graph" || blueprintMode === "subgraph";
      }

      if (isAppBuilderWriteTool(toolCall.name)) {
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

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      };
    }

    if (generalChatResult) {
      addDebugStep(debugSteps, "general.final_answer", "start", "Tạo câu trả lời cuối từ general_chat.", {
        model: CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const finalResponse = await runChatModel(CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Bạn là trợ lý AI hội thoại.
Hãy trả lời cuối cùng bằng cùng ngôn ngữ với người hỏi.
Dựa trên nội dung từ general_chat, trả lời tự nhiên và không nhắc đến tool/function nội bộ.`
          },
          ...chatHistory,
          { role: "user", content: userMessage },
          {
            role: "assistant",
            content: `Nội dung từ general_chat:\n${generalChatResult}`
          }
        ]
      }, env);

      addDebugStep(debugSteps, "general.final_answer", "ok", "Đã tạo câu trả lời cuối từ general_chat.", {
        answer_chars: (finalResponse.response ?? "").length
      });

      return {
        answer: finalResponse.response ?? "Không tạo được câu trả lời.",
        toolsCalled
      };
    }

    if (toolResults.length > 0) {
      if (shouldLetModelInspectToolResult && i < MAX_ITERATIONS - 1) {
        addDebugStep(debugSteps, "agent.graph_continue", "ok", "Đưa graph/subgraph về model để model quyết định trả lời hoặc gọi detail.", {
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

  return {
    answer: "Đã đạt số vòng gọi công cụ tối đa nhưng chưa tạo được câu trả lời cuối cùng.",
    toolsCalled
  };
}

// ─── Worker handler ───────────────────────────────────────────────────────────
