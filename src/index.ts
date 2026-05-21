// src/index.ts

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  ZILCODE_SESSIONS?: KVNamespace;
  ZILCODE_API_TOKEN: string;
  ZILCODE_BASE?: string;
  SESSION_TTL_SECONDS?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_EMBEDDING_MODEL?: string;
}

// ─── Models ───────────────────────────────────────────────────────────────────

const LLAMA_CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CHAT_MODEL = "@cf/openai/gpt-oss-120b";
const GENERAL_CHAT_MODEL = CHAT_MODEL;
const QUERY_REWRITE_MODEL = CHAT_MODEL;
const INTERNAL_CHAT_FALLBACK_MODEL = LLAMA_CHAT_MODEL;
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHART_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-dev";
const TOOL_SELECTION_MAX_TOKENS = 512;
const GENERAL_CHAT_MAX_TOKENS = 1024;
const RAG_FINAL_MAX_TOKENS = 2048;
const RAG_RERANK_MAX_TOKENS = 512;
const RAG_QUERY_REWRITE_MAX_TOKENS = 160;
const DEFAULT_CHART_WIDTH = 1024;
const DEFAULT_CHART_HEIGHT = 768;
const RAG_VECTOR_TOP_K = 10;
const RAG_MAX_CONTEXT_CHUNKS = 4;
const RAG_MIN_SCORE = 0.35;
const RAG_RERANK_TEXT_MAX_CHARS = 900;
const RAG_VECTOR_DIMENSIONS = 1024;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CONTENT_CHARS = 1200;
const DEFAULT_ZILCODE_BASE = "https://dvnb.zilcode.vn";
const ZILCODE_SESSION_PREFIX = "zilcode_session:";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;
const ZILCODE_READ_LIMIT_DEFAULT = 20;
const ZILCODE_READ_LIMIT_MAX = 50;

 // ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Zilcode-Session",
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "general_chat",
    description:
      "Trả lời hội thoại thông thường bằng năng lực chat và kiến thức sẵn có của trợ lý. Dùng cho chào hỏi, cảm ơn, hỏi trợ lý là ai/có thể làm gì, hỏi trợ lý có trả lời ngoài Zilcode không, câu hỏi không liên quan đến Zilcode, hoặc câu hỏi kiến thức chung không cần tra cứu tài liệu Zilcode. Không dùng khi Zilcode là chủ đề cần giải thích/hướng dẫn, hoặc khi câu hỏi cần thông tin cụ thể từ tài liệu Zilcode, workflow, hoặc ngữ cảnh màn hình.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Tin nhắn người dùng cần trả lời trực tiếp"
        }
      },
      required: ["message"]
    }
  },
  {
    name: "rag_search",
    description:
      "Nguồn bổ sung để tra cứu kho tài liệu Zilcode đã ingest, gồm Hướng dẫn người dùng và Hướng dẫn quản trị. Dùng khi Zilcode là chủ đề cần giải thích, hướng dẫn hoặc kiểm tra thông tin trong tài liệu, kể cả câu hỏi rộng như 'Zilcode là gì', 'hướng dẫn tôi sử dụng Zilcode', 'Zilcode có chức năng gì'. Ví dụ chủ đề: đăng nhập, vai trò, Desktop, Header, Window, toolbar, tìm kiếm/thêm/sửa/xóa/import/export dữ liệu, SQL Cloud, App Builder, Site, Service, User, Role, Organization, Application, Window/Tab/Field/MenuTool, Application Wizard. Không dùng cho chào hỏi, cảm ơn, trò chuyện thông thường, câu hỏi về năng lực của trợ lý, hoặc câu hỏi kiến thức chung ngoài Zilcode. Sau khi đã có kết quả rag_search, dùng kết quả đó để trả lời, không gọi general_chat để thay thế nội dung tài liệu. Thường chỉ cần gọi một lần với query tốt; chỉ gọi lại nếu kết quả chưa đủ và query mới thật sự bổ sung khía cạnh khác.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tìm kiếm tài liệu. Giữ thuật ngữ Zilcode gốc, thêm ngữ cảnh người dùng/quản trị nếu có, và tránh lặp lại query tương đương đã dùng trong cùng lượt trả lời."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "draw_chart",
    description:
      "Tạo ảnh biểu đồ, sơ đồ hoặc infographic trực quan bằng mô hình ảnh Flux. Dùng khi người dùng yêu cầu vẽ/tạo/minh họa biểu đồ, sơ đồ quy trình, sơ đồ khối, flowchart, mindmap, timeline, dashboard mockup, hoặc infographic. Phù hợp cho hình minh họa trực quan; không đảm bảo chữ nhỏ, số liệu hoặc nhãn trong ảnh chính xác tuyệt đối như biểu đồ dữ liệu được render bằng code. Nếu người dùng cung cấp số liệu, hãy đưa số liệu chính vào prompt thật rõ. Không dùng cho chào hỏi, chat thường, câu hỏi cần trả lời bằng văn bản, hoặc tra cứu tài liệu Zilcode.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Mô tả ảnh biểu đồ/sơ đồ cần tạo. Nên nêu loại biểu đồ, dữ liệu chính, bố cục, phong cách, màu sắc và ngôn ngữ nhãn nếu có."
        },
        width: {
          type: "string",
          description: "Chiều rộng ảnh, mặc định 1024. Giá trị hợp lệ từ 256 đến 1920."
        },
        height: {
          type: "string",
          description: "Chiều cao ảnh, mặc định 768. Giá trị hợp lệ từ 256 đến 1920."
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "get_workflow",
    description:
      "Nguồn bổ sung để lấy thông tin một workflow Zilcode theo ID. Dùng khi người dùng nêu rõ workflow ID, hoặc khi đã có ngữ cảnh màn hình cho thấy tài nguyên hiện tại là workflow và người dùng đang hỏi về cấu trúc/debug workflow đó. Không dùng cho chào hỏi, câu hỏi tài liệu chung, hoặc câu hỏi không liên quan đến một workflow cụ thể.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID của workflow"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "get_screen_context",
    description:
      "Nguồn bổ sung để lấy ngữ cảnh màn hình hiện tại của giao diện: người dùng đang ở màn hình nào, node nào đang được chọn, và tài nguyên nào đang hoạt động. Dùng khi đồng thời đúng cả hai điều kiện: người dùng đang hỏi về đối tượng đang hiển thị/được chọn trong UI, và câu trả lời phụ thuộc vào việc biết màn hình/node/tài nguyên hiện tại. Ví dụ nên dùng: 'workflow này lỗi ở đâu?', 'node này dùng để làm gì?', 'ở màn hình hiện tại tôi nên bấm gì?'. Không dùng cho 'xin chào', cảm ơn, trò chuyện thông thường, câu hỏi tài liệu chung, hoặc khi người dùng đã nêu rõ ID/tên đối tượng.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "zilcode_get_session_info",
    description:
      "Read-only tool. Lấy thông tin phiên đăng nhập Zilcode hiện tại của người dùng trong chatbot: user, site, role, organization, trạng thái đã chọn role/org hay chưa. Dùng khi câu hỏi cần biết người dùng đang đăng nhập Zilcode chưa hoặc đang dùng role/org nào. Không trả token.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "zilcode_list_applications",
    description:
      "Read-only tool. Liệt kê các application Zilcode mà phiên hiện tại được phép truy cập sau khi đã chọn role/org.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "zilcode_list_accessible_tables",
    description:
      "Read-only tool. Liet ke tong hop cac table/view trong tat ca application Zilcode ma phien hien tai duoc phep truy cap. Dung truc tiep cho cau hoi nhu 'tai khoan cua toi dang co nhung bang nao', 'toi xem duoc table nao', 'liet ke database/table cua toi'. Tool nay tu lay appid dung tu phien dang nhap, khong can model tu doan appid.",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Tu khoa loc theo table name, alias, display name hoac app name. Bo trong de liet ke tat ca." },
        limit: { type: "string", description: "So table toi da tra ve tren toan bo app, mac dinh 120." }
      }
    }
  },
  {
    name: "zilcode_get_user_permissions",
    description:
      "Read-only tool. Lấy quyền access hiện tại theo role/org, có thể lọc theo table name.",
    parameters: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Tên table cần xem quyền. Bỏ trống để trả toàn bộ access." }
      }
    }
  },
  {
    name: "zilcode_get_app_metadata",
    description:
      "Read-only tool. Gọi Zilcode để lấy metadata của một application: domains, services, relates, tables, workflows, roles, menus.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application Zilcode cần đọc metadata." },
        include_full: { type: "string", description: "Đặt 'true' nếu cần trả metadata đầy đủ. Mặc định trả bản tóm tắt." }
      }
    }
  },
  {
    name: "zilcode_search_windows",
    description:
      "Read-only tool. Tìm window trong một application thông qua menu metadata khi người dùng nêu tên màn hình/window/menu.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application cần tìm window." },
        keyword: { type: "string", description: "Từ khóa tên menu/window cần tìm." }
      },
      required: ["appid", "keyword"]
    }
  },
  {
    name: "zilcode_get_window_config",
    description:
      "Read-only tool. Lấy cache cấu hình window theo windowid. Nếu config parse được, trả window/tabs/fields/menus; nếu đang ở dạng nén Zipson chưa parse được, trả raw metadata và cảnh báo.",
    parameters: {
      type: "object",
      properties: {
        windowid: { type: "string", description: "ID window cần đọc cache/config." }
      },
      required: ["windowid"]
    }
  },
  {
    name: "zilcode_list_tables",
    description:
      "Read-only tool. Liệt kê table/view trong một application từ app metadata. Dùng khi cần tìm tableid/tablename/urlview/columnkey.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application cần liệt kê tables." },
        keyword: { type: "string", description: "Từ khóa lọc theo table name hoặc display name." }
      }
    }
  },
  {
    name: "zilcode_get_table_metadata",
    description:
      "Read-only tool. Lấy metadata của một table trong application theo tableid hoặc tablename.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application chứa table." },
        tableid: { type: "string", description: "ID table cần đọc." },
        table_name: { type: "string", description: "Tên table cần đọc nếu chưa biết tableid." }
      },
      required: ["appid"]
    }
  },
  {
    name: "zilcode_search_records",
    description:
      "Read-only tool. Tìm record trong một table qua table.urlview. Cần appid và tableid hoặc table_name. Có thể truyền query đơn giản hoặc where theo format SqlREST.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application chứa table." },
        tableid: { type: "string", description: "ID table cần tìm." },
        table_name: { type: "string", description: "Tên table nếu chưa biết tableid." },
        query: { type: "string", description: "Từ khóa tìm nhanh theo columnfind/columndisplay/columncode/columnkey." },
        where: { type: "array", description: "Điều kiện where theo format SqlREST, ví dụ ['username','like','%admin%']." },
        select: { type: "string", description: "Danh sách cột cần đọc, phân tách bằng dấu phẩy." },
        orderby: { type: "string", description: "Mệnh đề orderby nếu cần." },
        limit: { type: "string", description: "Số dòng tối đa, mặc định 20, tối đa 50." }
      },
      required: ["appid"]
    }
  },
  {
    name: "zilcode_get_record",
    description:
      "Read-only tool. Lấy một record cụ thể từ table.urlview theo recordid. Cần appid và tableid hoặc table_name.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application chứa table." },
        tableid: { type: "string", description: "ID table cần đọc." },
        table_name: { type: "string", description: "Tên table nếu chưa biết tableid." },
        recordid: { type: "string", description: "ID/khóa chính của record cần đọc." }
      },
      required: ["appid", "recordid"]
    }
  },
  {
    name: "zilcode_get_domain_values",
    description:
      "Read-only tool. Lấy danh sách value/text của domain trong app metadata. Dùng khi cần giải thích hoặc map giá trị select/list.",
    parameters: {
      type: "object",
      properties: {
        appid: { type: "string", description: "ID application chứa domain." },
        domainid: { type: "string", description: "ID domain cần đọc." }
      },
      required: ["appid", "domainid"]
    }
  }
];

// ─── Tool executor ────────────────────────────────────────────────────────────

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

type DebugStatus = "start" | "ok" | "skip" | "error";

interface DebugStep {
  step: string;
  status: DebugStatus;
  detail: string;
  data?: Record<string, unknown>;
  timestamp_ms: number;
}

interface EmbeddingDebug {
  provider: "cloudflare" | "openrouter";
  model: string;
  dimensions: number;
  fallback: boolean;
}

interface EmbeddingResult {
  vector: number[];
  debug: EmbeddingDebug;
}

interface RagQueryDebug {
  original_query: string;
  rewritten_query: string;
  used: boolean;
  reason: string;
  model?: string;
}

interface VectorMatch {
  id: string;
  score?: number;
}

interface StoredChunk {
  text: string;
  module: string;
  filename?: string;
  title?: string;
  doc_type?: string;
  audience?: string;
  heading: string;
  section_path?: string;
}

interface RagCandidate extends StoredChunk {
  id: string;
  vector_score?: number;
  rerank_rank?: number;
  source_label: string;
}

function addDebugStep(
  debugSteps: DebugStep[] | undefined,
  step: string,
  status: DebugStatus,
  detail: string,
  data?: Record<string, unknown>
): void {
  if (!debugSteps) return;

  debugSteps.push({
    step,
    status,
    detail,
    data,
    timestamp_ms: Date.now()
  });
}

interface ChatModelRequest {
  messages: AIMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: typeof TOOLS;
}

interface ChatModelResponse {
  response?: string;
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    id?: string;
  }>;
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

interface ResponseApiOutputItem {
  type?: string;
  role?: string;
  name?: string;
  arguments?: unknown;
  call_id?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

function getStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

function getNumberArg(
  args: Record<string, unknown>,
  name: string,
  fallback: number
): number {
  const value = args[name];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1920, Math.max(256, Math.round(parsed)));
}

function buildChartPrompt(prompt: string): string {
  return [
    prompt,
    "Tạo ảnh dạng biểu đồ/sơ đồ sạch, dễ đọc, bố cục rõ ràng.",
    "Phong cách: hiện đại, chuyên nghiệp, nền sáng, màu sắc cân bằng.",
    "Nếu có chữ trong ảnh, dùng tiếng Việt tự nhiên và giữ nhãn ngắn gọn."
  ].join("\n");
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isCloudflareNeuronQuotaError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("4006")
    || text.includes("daily free allocation")
    || text.includes("neurons");
}

function isCloudflareNeuronQuotaResult(result: unknown): boolean {
  const text = getErrorText(result).toLowerCase();
  return text.includes("4006")
    && (text.includes("daily free allocation") || text.includes("neurons"));
}

function isCloudflareInternalModelError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("3043") || text.includes("internal server error");
}

function isOpenAiWorkersModel(model: string): boolean {
  return model.includes("/openai/gpt-oss");
}

function normalizeMessagesForOpenRouter(messages: AIMessage[]): OpenRouterMessage[] {
  return messages.map(message => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: `Kết quả công cụ${message.tool_call_id ? ` (${message.tool_call_id})` : ""}:\n${message.content}`
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

function toOpenRouterTools(tools?: typeof TOOLS) {
  if (!tools) return undefined;
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

function buildCloudflareChatRequest(
  cfModel: string,
  request: ChatModelRequest
): Record<string, unknown> {
  if (!isOpenAiWorkersModel(cfModel)) {
    return request as unknown as Record<string, unknown>;
  }

  return {
    messages: normalizeMessagesForOpenRouter(request.messages),
    tools: toOpenRouterTools(request.tools),
    tool_choice: request.tools ? "auto" : undefined,
    max_tokens: request.max_tokens,
    temperature: request.temperature
  };
}

function parseToolArguments(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    try {
      return JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  if (rawArguments && typeof rawArguments === "object") {
    return rawArguments as Record<string, unknown>;
  }

  return {};
}

function normalizeOpenRouterResponse(data: unknown): ChatModelResponse {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: {
            name?: string;
            arguments?: unknown;
          };
        }>;
      };
    }>;
  };

  const message = payload.choices?.[0]?.message;
  const toolCalls = message?.tool_calls
    ?.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.function?.name ?? "",
      arguments: parseToolArguments(toolCall.function?.arguments)
    }))
    .filter(toolCall => toolCall.name);

  return {
    response: message?.content ?? undefined,
    tool_calls: toolCalls?.length ? toolCalls : undefined
  };
}

function normalizeResponsesApiOutput(output?: ResponseApiOutputItem[]): ChatModelResponse {
  if (!Array.isArray(output)) return {};

  const text = output
    .filter(item => item.type === "message" || item.role === "assistant")
    .flatMap(item => item.content ?? [])
    .map(content => content.text ?? "")
    .join("");

  const toolCalls = output
    .filter(item => item.type === "function_call" && item.name)
    .map(item => ({
      id: item.call_id,
      name: item.name ?? "",
      arguments: parseToolArguments(item.arguments)
    }))
    .filter(toolCall => toolCall.name);

  return {
    response: text || undefined,
    tool_calls: toolCalls.length ? toolCalls : undefined
  };
}

function normalizeCloudflareChatResponse(data: unknown): ChatModelResponse {
  const existing = data as ChatModelResponse;
  if (existing.response || existing.tool_calls) return existing;

  const payload = data as {
    output_text?: string;
    output?: ResponseApiOutputItem[];
    choices?: unknown[];
  };

  const chatCompletion = normalizeOpenRouterResponse(data);
  if (chatCompletion.response || chatCompletion.tool_calls) {
    return chatCompletion;
  }

  const responsesApi = normalizeResponsesApiOutput(payload.output);
  if (responsesApi.response || responsesApi.tool_calls) {
    return responsesApi;
  }

  return {
    response: payload.output_text
  };
}

async function callOpenRouterChat(
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_MODEL) {
    throw new Error("Thiếu OPENROUTER_API_KEY hoặc OPENROUTER_MODEL để fallback sang OpenRouter.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ragorit.daovanda2405.workers.dev",
      "X-Title": "Ragorit Zilcode RAG Chatbot"
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: normalizeMessagesForOpenRouter(request.messages),
      tools: toOpenRouterTools(request.tools),
      tool_choice: request.tools ? "auto" : undefined,
      max_tokens: request.max_tokens,
      temperature: request.temperature
    })
  });

  const responseText = await response.text();
  let data: unknown;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { error: responseText };
  }

  if (!response.ok) {
    throw new Error(`OpenRouter API lỗi ${response.status}: ${getErrorText(data)}`);
  }

  return normalizeOpenRouterResponse(data);
}

async function callCloudflareChatModel(
  cfModel: string,
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  const result = await env.AI.run(
    cfModel as string & {},
    buildCloudflareChatRequest(cfModel, request)
  ) as unknown;

  if (isCloudflareNeuronQuotaResult(result)) {
    throw new Error(getErrorText(result));
  }

  return normalizeCloudflareChatResponse(result);
}

async function runChatModel(
  cfModel: string,
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  try {
    return await callCloudflareChatModel(cfModel, request, env);
  } catch (error) {
    if (isCloudflareInternalModelError(error) && cfModel !== INTERNAL_CHAT_FALLBACK_MODEL) {
      console.log(`[CHAT_MODEL] ${cfModel} lỗi nội bộ, fallback sang ${INTERNAL_CHAT_FALLBACK_MODEL}`);
      return callCloudflareChatModel(INTERNAL_CHAT_FALLBACK_MODEL, request, env);
    }

    if (isCloudflareNeuronQuotaError(error)) {
      console.log("[CHAT_MODEL] Cloudflare quota error, fallback sang OpenRouter");
      return callOpenRouterChat(request, env);
    }

    throw error;
  }
}

async function callOpenRouterEmbedding(
  text: string,
  env: Env
): Promise<EmbeddingResult> {
  const model = env.OPENROUTER_EMBEDDING_MODEL ?? env.OPENROUTER_MODEL;

  if (!env.OPENROUTER_API_KEY || !model) {
    throw new Error("Thiếu OPENROUTER_API_KEY và OPENROUTER_EMBEDDING_MODEL/OPENROUTER_MODEL để fallback embedding sang OpenRouter.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ragorit.daovanda2405.workers.dev",
      "X-Title": "Ragorit Zilcode RAG Chatbot"
    },
    body: JSON.stringify({
      model,
      input: text,
      dimensions: RAG_VECTOR_DIMENSIONS
    })
  });

  const responseText = await response.text();
  let data: unknown;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { error: responseText };
  }

  if (!response.ok) {
    throw new Error(`OpenRouter Embeddings API lỗi ${response.status}: ${getErrorText(data)}`);
  }

  const payload = data as {
    data?: Array<{
      embedding?: number[];
    }>;
  };
  const embedding = payload.data?.[0]?.embedding;

  if (!embedding?.length) {
    throw new Error("OpenRouter Embeddings API không trả về embedding.");
  }

  if (embedding.length !== RAG_VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding OpenRouter có ${embedding.length} chiều, nhưng Vectorize index hiện tại cần ${RAG_VECTOR_DIMENSIONS} chiều. Cần dùng embedding model hỗ trợ dimensions=${RAG_VECTOR_DIMENSIONS} hoặc tạo lại Vectorize index và ingest lại.`
    );
  }

  return {
    vector: embedding,
    debug: {
      provider: "openrouter",
      model,
      dimensions: embedding.length,
      fallback: true
    }
  };
}

async function embedQuery(
  text: string,
  env: Env
): Promise<EmbeddingResult> {
  try {
    const embeddingResult = await env.AI.run(
      EMBEDDING_MODEL,
      { text }
    ) as { data: number[] | number[][] };

    const vector = Array.isArray(embeddingResult.data[0])
      ? embeddingResult.data[0] as number[]
      : embeddingResult.data as number[];
    return {
      vector,
      debug: {
        provider: "cloudflare",
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        fallback: false
      }
    };
  } catch (error) {
    if (isCloudflareNeuronQuotaError(error)) {
      console.log("[EMBEDDING_MODEL] Cloudflare quota error, fallback embedding sang OpenRouter");
      return callOpenRouterEmbedding(text, env);
    }

    throw error;
  }
}

async function generateChartImage(
  args: Record<string, unknown>,
  env: Env
): Promise<GeneratedImage> {
  const prompt = getStringArg(args, "prompt");
  if (!prompt) {
    throw new Error("Bắt buộc phải có prompt để tạo biểu đồ.");
  }

  const width = getNumberArg(args, "width", DEFAULT_CHART_WIDTH);
  const height = getNumberArg(args, "height", DEFAULT_CHART_HEIGHT);

  const form = new FormData();
  form.append("prompt", buildChartPrompt(prompt));
  form.append("width", String(width));
  form.append("height", String(height));

  const formResponse = new Response(form);
  const body = formResponse.body;
  const contentType = formResponse.headers.get("content-type");

  if (!body || !contentType) {
    throw new Error("Không tạo được multipart body cho yêu cầu tạo ảnh.");
  }

  const response = await env.AI.run(CHART_IMAGE_MODEL, {
    multipart: {
      body,
      contentType
    }
  }) as { image?: string };

  if (!response.image) {
    throw new Error("Mô hình ảnh không trả về dữ liệu image.");
  }

  const dataUrl = response.image.startsWith("data:")
    ? response.image
    : `data:image/png;base64,${response.image}`;

  return {
    mime_type: "image/png",
    data_url: dataUrl,
    prompt,
    width,
    height
  };
}

function formatScore(score?: number): string {
  return typeof score === "number" ? score.toFixed(3) : "không có";
}

function truncateForRerank(text: string): string {
  if (text.length <= RAG_RERANK_TEXT_MAX_CHARS) return text;
  return `${text.slice(0, RAG_RERANK_TEXT_MAX_CHARS).trim()}...`;
}

function getSourceLabel(chunk: StoredChunk): string {
  return [
    chunk.title ?? chunk.module,
    chunk.audience,
    chunk.section_path ?? chunk.heading
  ].filter(Boolean).join(" | ");
}

function toRagSource(candidate: RagCandidate): RagSource {
  return {
    id: candidate.id,
    title: candidate.title ?? candidate.module,
    filename: candidate.filename,
    module: candidate.module,
    audience: candidate.audience,
    section_path: candidate.section_path ?? candidate.heading,
    heading: candidate.heading,
    vector_score: candidate.vector_score,
    rerank_rank: candidate.rerank_rank
  };
}

function extractJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const text = typeof value === "string"
    ? value
    : JSON.stringify(value ?? "");

  if (!text) return null;

  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sortByVectorScore(candidates: RagCandidate[]): RagCandidate[] {
  return [...candidates].sort((a, b) => (b.vector_score ?? -Infinity) - (a.vector_score ?? -Infinity));
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getAmbiguousRagQueryReason(query: string, chatHistory: AIMessage[]): string | null {
  if (!chatHistory.length) return null;

  const normalized = normalizeSpaces(query).toLowerCase();
  if (!normalized) return null;

  const contextualPatterns = [
    /(^|\s)(nó|đó|này|kia)(\s|$)/u,
    /(^|\s)(cái|phần|mục|chỗ|bước|trang|màn hình|module|chức năng|tính năng|workflow|node)\s+(đó|này|kia)(\s|$)/u,
    /(^|\s)(ở trên|như trên|vừa rồi|vừa nói|ban nãy|tiếp theo|sau đó)(\s|$)/u,
    /(^|\s)(còn|vậy|thế)\s+(thì|nó|phần|bước|mục|cái)(\s|$)/u
  ];

  if (contextualPatterns.some(pattern => pattern.test(normalized))) {
    return "query có đại từ hoặc tham chiếu phụ thuộc lịch sử chat";
  }

  const genericQueries = [
    "là gì",
    "dùng thế nào",
    "sử dụng thế nào",
    "hướng dẫn tôi",
    "làm sao",
    "làm thế nào",
    "cách làm",
    "tiếp theo",
    "sửa lỗi",
    "giải thích thêm",
    "nói rõ hơn"
  ];

  if (genericQueries.includes(normalized)) {
    return "query quá ngắn hoặc quá chung, cần lịch sử để làm rõ";
  }

  return null;
}

function formatHistoryForRewrite(chatHistory: AIMessage[]): string {
  return chatHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => {
      const role = message.role === "user" ? "Người dùng" : "Trợ lý";
      return `${role}: ${normalizeSpaces(message.content).slice(0, MAX_HISTORY_CONTENT_CHARS)}`;
    })
    .join("\n");
}

function cleanRewrittenQuery(raw: string, fallback: string): string {
  const cleaned = normalizeSpaces(
    raw
      .replace(/```json|```/g, "")
      .replace(/^(truy vấn|query|rewritten query|câu truy vấn)\s*[:：-]\s*/i, "")
  ).replace(/^["'“”]+|["'“”]+$/g, "").trim();

  if (!cleaned || cleaned.length < 4) return fallback;
  return cleaned.slice(0, 320).trim();
}

async function maybeRewriteRagQuery(
  query: string,
  chatHistory: AIMessage[],
  env: Env,
  debugSteps?: DebugStep[]
): Promise<{ query: string; debug: RagQueryDebug }> {
  const originalQuery = normalizeSpaces(query);
  const reason = getAmbiguousRagQueryReason(originalQuery, chatHistory);

  if (!reason) {
    addDebugStep(debugSteps, "rag.query_rewrite", "skip", chatHistory.length ? "Query đã đủ rõ, không cần rewrite." : "Không có history để rewrite.", {
      original_query: originalQuery,
      history_messages: chatHistory.length
    });

    return {
      query: originalQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: originalQuery,
        used: false,
        reason: chatHistory.length ? "query đã đủ rõ, không cần rewrite" : "không có history để rewrite"
      }
    };
  }

  try {
    addDebugStep(debugSteps, "rag.query_rewrite", "start", "Rewrite query mơ hồ bằng history.", {
      model: QUERY_REWRITE_MODEL,
      original_query: originalQuery,
      reason,
      history_messages: chatHistory.length
    });

    const response = await runChatModel(QUERY_REWRITE_MODEL, {
      max_tokens: RAG_QUERY_REWRITE_MAX_TOKENS,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Bạn là bộ rewrite query cho hệ thống RAG tài liệu Zilcode.
Nhiệm vụ: dựa vào lịch sử hội thoại và câu hỏi hiện tại, viết lại thành một truy vấn tìm kiếm độc lập, rõ nghĩa.
Chỉ trả về đúng một câu truy vấn, không giải thích, không markdown, không JSON.
Giữ thuật ngữ Zilcode quan trọng như App Builder, SQL Cloud, User, Role, Organization, Application, Window, Tab, Field, Workflow nếu có.
Nếu câu hỏi hiện tại đã rõ sau khi xét lịch sử, vẫn viết lại thành câu truy vấn ngắn gọn và đầy đủ ngữ cảnh.`
        },
        {
          role: "user",
          content: [
            "Lịch sử hội thoại gần nhất:",
            formatHistoryForRewrite(chatHistory),
            "",
            `Câu hỏi/query hiện tại: ${originalQuery}`,
            "",
            "Truy vấn tìm kiếm độc lập cho tài liệu Zilcode:"
          ].join("\n")
        }
      ]
    }, env);

    const rewrittenQuery = cleanRewrittenQuery(response.response ?? "", originalQuery);
    const used = rewrittenQuery.toLowerCase() !== originalQuery.toLowerCase();

    addDebugStep(debugSteps, "rag.query_rewrite", "ok", used ? "Đã rewrite query cho retrieval." : "Model giữ nguyên query gốc.", {
      original_query: originalQuery,
      rewritten_query: rewrittenQuery,
      used
    });

    return {
      query: rewrittenQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: rewrittenQuery,
        used,
        reason,
        model: QUERY_REWRITE_MODEL
      }
    };
  } catch (error) {
    console.log(`[RAG_REWRITE] Lỗi rewrite, dùng query gốc: ${getErrorText(error)}`);
    addDebugStep(debugSteps, "rag.query_rewrite", "error", "Rewrite lỗi, fallback về query gốc.", {
      original_query: originalQuery,
      error: getErrorText(error)
    });

    return {
      query: originalQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: originalQuery,
        used: false,
        reason: `rewrite lỗi, dùng query gốc: ${getErrorText(error)}`,
        model: QUERY_REWRITE_MODEL
      }
    };
  }
}

async function rerankRagCandidates(
  query: string,
  candidates: RagCandidate[],
  env: Env,
  debugSteps?: DebugStep[]
): Promise<RagCandidate[]> {
  if (candidates.length === 0) return [];

  addDebugStep(debugSteps, "rag.rerank", "start", "Bắt đầu rerank các chunk từ Vectorize.", {
    model: CHAT_MODEL,
    candidates: candidates.length,
    query
  });

  const rerankPayload = candidates.map(candidate => ({
    id: candidate.id,
    source: candidate.source_label,
    vector_score: candidate.vector_score,
    text: truncateForRerank(candidate.text)
  }));

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_RERANK_MAX_TOKENS,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn là bộ rerank tài liệu cho chatbot RAG Zilcode.
Nhiệm vụ: xếp hạng các chunk theo mức liên quan với câu hỏi người dùng.
Ưu tiên chunk trả lời trực tiếp câu hỏi, đúng đối tượng người dùng/quản trị, và có nội dung thao tác cụ thể.
Chỉ trả về JSON hợp lệ, không giải thích thêm.
Schema: {"ranked_ids":["chunk-id-1","chunk-id-2"]}`
      },
      {
        role: "user",
        content: JSON.stringify({
          question: query,
          candidates: rerankPayload
        })
      }
    ]
  }, env);

  const parsed = extractJsonObject(response.response ?? "");
  const rankedIds = getStringArray(parsed?.ranked_ids);

  if (!rankedIds.length) {
    addDebugStep(debugSteps, "rag.rerank", "skip", "Rerank không trả JSON hợp lệ, fallback theo điểm Vectorize.", {
      selected_ids: sortByVectorScore(candidates).slice(0, RAG_MAX_CONTEXT_CHUNKS).map(candidate => candidate.id)
    });

    return sortByVectorScore(candidates)
      .slice(0, RAG_MAX_CONTEXT_CHUNKS)
      .map((candidate, index) => ({ ...candidate, rerank_rank: index + 1 }));
  }

  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const ordered: RagCandidate[] = [];

  for (const id of rankedIds) {
    const candidate = candidateById.get(id);
    if (candidate && !ordered.some(item => item.id === id)) {
      ordered.push(candidate);
    }
  }

  for (const candidate of sortByVectorScore(candidates)) {
    if (!ordered.some(item => item.id === candidate.id)) {
      ordered.push(candidate);
    }
  }

  const selected = ordered
    .slice(0, RAG_MAX_CONTEXT_CHUNKS)
    .map((candidate, index) => ({ ...candidate, rerank_rank: index + 1 }));

  addDebugStep(debugSteps, "rag.rerank", "ok", "Đã chọn các chunk tốt nhất sau rerank.", {
    selected_ids: selected.map(candidate => candidate.id)
  });

  return selected;
}

async function searchRag(
  query: string,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<ToolExecutionResult> {
  addDebugStep(debugSteps, "rag.search", "start", "Bắt đầu RAG search.", {
    original_query: query,
    history_messages: chatHistory.length
  });

  const rewritten = await maybeRewriteRagQuery(query, chatHistory, env, debugSteps);
  const retrievalQuery = rewritten.query;

  addDebugStep(debugSteps, "rag.embedding", "start", "Embedding query dùng cho retrieval.", {
    query: retrievalQuery,
    model: EMBEDDING_MODEL
  });

  const embeddingResult = await embedQuery(retrievalQuery, env);
  const queryVector = embeddingResult.vector;

  addDebugStep(debugSteps, "rag.embedding", "ok", "Embedding query hoàn tất.", {
    provider: embeddingResult.debug.provider,
    model: embeddingResult.debug.model,
    dimensions: embeddingResult.debug.dimensions,
    fallback: embeddingResult.debug.fallback
  });

  addDebugStep(debugSteps, "rag.vectorize", "start", "Query Vectorize index.", {
    top_k: RAG_VECTOR_TOP_K,
    min_score: RAG_MIN_SCORE
  });

  const matches = await env.VECTORIZE.query(queryVector, {
    topK: RAG_VECTOR_TOP_K,
    returnMetadata: "all"
  });

  const vectorMatches = matches.matches as VectorMatch[];
  addDebugStep(debugSteps, "rag.vectorize", "ok", "Vectorize trả kết quả.", {
    matches: vectorMatches.length,
    top_score: vectorMatches[0]?.score
  });

  if (!vectorMatches.length) {
    return {
      content: "Không tìm thấy tài liệu liên quan.",
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const filteredMatches = vectorMatches.filter(match =>
    typeof match.score !== "number" || match.score >= RAG_MIN_SCORE
  );

  addDebugStep(debugSteps, "rag.filter", "ok", "Lọc match theo ngưỡng score.", {
    before: vectorMatches.length,
    after: filteredMatches.length,
    min_score: RAG_MIN_SCORE
  });

  if (!filteredMatches.length) {
    return {
      content: `Không tìm thấy tài liệu đủ liên quan. Điểm liên quan cao nhất là ${formatScore(vectorMatches[0]?.score)}, thấp hơn ngưỡng ${RAG_MIN_SCORE}.`,
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const candidates: RagCandidate[] = [];
  addDebugStep(debugSteps, "rag.kv", "start", "Lấy nội dung chunk từ KV.", {
    requested_chunks: filteredMatches.length
  });

  for (const match of filteredMatches) {
    const raw = await env.CHUNKS.get(`chunk:${match.id}`);
    if (!raw) continue;

    const chunk = JSON.parse(raw) as StoredChunk;
    candidates.push({
      ...chunk,
      id: match.id,
      vector_score: match.score,
      source_label: getSourceLabel(chunk)
    });
  }

  addDebugStep(debugSteps, "rag.kv", "ok", "Đã tải nội dung chunk từ KV.", {
    loaded_chunks: candidates.length
  });

  if (!candidates.length) {
    return {
      content: "Không tìm thấy nội dung chunk tương ứng trong KV.",
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const reranked = await rerankRagCandidates(retrievalQuery, candidates, env, debugSteps);
  const content = reranked
    .map((candidate, index) => [
      `[Nguồn ${index + 1}: ${candidate.source_label}]`,
      `ID: ${candidate.id}`,
      `Điểm Vectorize: ${formatScore(candidate.vector_score)}`,
      `Thứ hạng rerank: ${candidate.rerank_rank ?? index + 1}`,
      "",
      candidate.text
    ].join("\n"))
    .join("\n\n---\n\n");

  return {
    content,
    sources: reranked.map(toRagSource),
    embedding_debug: embeddingResult.debug,
    rag_query_debug: rewritten.debug
  };
}

interface ZilcodeSession {
  token: string;
  base_url?: string;
  user: Record<string, unknown>;
  roles?: unknown;
  orgs?: unknown;
  roleid?: string | number;
  orgid?: string | number;
  access?: Record<string, unknown>;
  apps?: unknown;
  notifies?: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface ZilcodeSessionState {
  id: string;
  session: ZilcodeSession;
}

interface ZilcodeApiEnvelope<T = unknown> {
  success?: boolean;
  result?: T;
  error?: unknown;
}

interface SqlRestSelectOptions {
  id?: string;
  where?: unknown;
  select?: string;
  orderby?: string;
  limit?: number;
}

function getZilcodeBase(env: Env, baseOverride?: string): string {
  return (baseOverride || env.ZILCODE_BASE || DEFAULT_ZILCODE_BASE).replace(/\/+$/, "");
}

function normalizeZilcodeBaseInput(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ZILCODE_BASE khong hop le. Hay nhap URL day du, vi du https://dvnb.zilcode.vn");
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("ZILCODE_BASE phai dung https, tru localhost/127.0.0.1 khi test local.");
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "zilcode.vn"
    || hostname.endsWith(".zilcode.vn")
    || hostname === "zilcode.com"
    || hostname.endsWith(".zilcode.com");

  if (!allowed) {
    throw new Error("ZILCODE_BASE chi duoc phep la domain Zilcode, localhost hoac 127.0.0.1.");
  }

  return `${url.protocol}//${url.host}`;
}

function getSessionTtlSeconds(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_SESSION_TTL_SECONDS;
}

function getZilcodeSessionStore(env: Env): KVNamespace {
  return env.ZILCODE_SESSIONS ?? env.CHUNKS;
}

function getSessionKvKey(sessionId: string): string {
  return `${ZILCODE_SESSION_PREFIX}${sessionId}`;
}

function getSessionIdFromRequest(request: Request): string {
  const header = request.headers.get("X-Zilcode-Session");
  if (header?.trim()) return header.trim();

  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)ragorit_zilcode_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function stripSensitiveUserFields(user: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...user };
  delete clone.token;
  delete clone.password;
  delete clone.pin;
  return clone;
}

function toArrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

async function loadZilcodeSession(
  request: Request,
  env: Env
): Promise<ZilcodeSessionState | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const raw = await getZilcodeSessionStore(env).get(getSessionKvKey(sessionId));
  if (!raw) return null;

  const session = JSON.parse(raw) as ZilcodeSession;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await getZilcodeSessionStore(env).delete(getSessionKvKey(sessionId));
    return null;
  }

  return { id: sessionId, session };
}

async function saveZilcodeSession(
  env: Env,
  sessionId: string,
  session: ZilcodeSession
): Promise<void> {
  await getZilcodeSessionStore(env).put(
    getSessionKvKey(sessionId),
    JSON.stringify(session),
    { expirationTtl: getSessionTtlSeconds(env) }
  );
}

async function deleteZilcodeSession(env: Env, sessionId: string): Promise<void> {
  if (!sessionId) return;
  await getZilcodeSessionStore(env).delete(getSessionKvKey(sessionId));
}

function publicSessionPayload(state: ZilcodeSessionState): Record<string, unknown> {
  const session = state.session;
  return {
    session_id: state.id,
    base_url: session.base_url,
    user: stripSensitiveUserFields(session.user),
    roles: session.roles,
    orgs: session.orgs,
    roleid: session.roleid,
    role_name: getSelectedRoleName(session),
    orgid: session.orgid,
    org_name: getSelectedOrgName(session),
    has_role_org: Boolean(session.roleid),
    apps: session.apps,
    access: session.access,
    expires_at: session.expires_at
  };
}

function resolveZilcodeUrl(env: Env, pathOrUrl: string, baseOverride?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${getZilcodeBase(env, baseOverride)}/${pathOrUrl.replace(/^\/+/, "")}`;
}

async function callZilcodeJson<T = unknown>(
  env: Env,
  pathOrUrl: string,
  options: {
    method?: string;
    token?: string;
    data?: unknown;
    baseUrl?: string;
  } = {}
): Promise<ZilcodeApiEnvelope<T>> {
  const headers = new Headers({
    "Content-Type": "application/json;charset=UTF-8"
  });

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const endpoint = resolveZilcodeUrl(env, pathOrUrl, options.baseUrl);
  const response = await fetch(endpoint, {
    method: options.method ?? "GET",
    headers,
    body: options.data === undefined ? undefined : JSON.stringify(options.data)
  });

  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { result: text };
  }

  if (!response.ok) {
    throw new Error(`Zilcode API lỗi ${response.status} tại ${endpoint}: ${getErrorText(data)}`);
  }

  return data as ZilcodeApiEnvelope<T>;
}

function assertZilcodeSuccess<T>(envelope: ZilcodeApiEnvelope<T>): T {
  if (envelope.success === false) {
    throw new Error(`Zilcode API trả lỗi: ${getErrorText(envelope.result ?? envelope.error)}`);
  }

  return envelope.result as T;
}

async function fetchZilcodeAppMetadata(
  env: Env,
  session: ZilcodeSession,
  appid: string
): Promise<Record<string, unknown>> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    `rest/token/app/${encodeURIComponent(appid)}`,
    { token: session.token, baseUrl: session.base_url }
  );
  return assertZilcodeSuccess(envelope);
}

function summarizeObjectCollection(value: unknown, limit = 30): unknown[] {
  return toArrayValues(value).slice(0, limit);
}

function summarizeAppMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const tables = toArrayValues(metadata.tables);
  const menus = toArrayValues(metadata.menus);
  const domains = toArrayValues(metadata.domains);
  const services = toArrayValues(metadata.services);
  const wfsteps = toArrayValues(metadata.wfsteps);

  return {
    counts: {
      tables: tables.length,
      menus: menus.length,
      domains: domains.length,
      services: services.length,
      wfsteps: wfsteps.length,
      relates: toArrayValues(metadata.relates).length,
      roles: toArrayValues(metadata.roles).length
    },
    tables: tables.slice(0, 40),
    menus: menus.slice(0, 60),
    domains: domains.slice(0, 30),
    services: services.slice(0, 20),
    roles: summarizeObjectCollection(metadata.roles, 20),
    note: "Metadata đã được rút gọn. Gọi include_full='true' nếu cần toàn bộ payload."
  };
}

function findTableMetadata(
  appMetadata: Record<string, unknown>,
  tableid: string,
  tableName: string
): Record<string, unknown> | null {
  const tablesRaw = appMetadata.tables;
  const tablesByKey = tablesRaw && typeof tablesRaw === "object"
    ? tablesRaw as Record<string, unknown>
    : {};

  if (tableid && tablesByKey[tableid] && typeof tablesByKey[tableid] === "object") {
    return tablesByKey[tableid] as Record<string, unknown>;
  }

  const normalizedId = tableid.toLowerCase();
  const normalizedName = tableName.toLowerCase();

  for (const table of toArrayValues(tablesRaw)) {
    if (!table || typeof table !== "object") continue;
    const record = table as Record<string, unknown>;
    const id = String(record.tableid ?? "").toLowerCase();
    const name = String(record.tablename ?? "").toLowerCase();

    if ((normalizedId && id === normalizedId) || (normalizedName && name === normalizedName)) {
      return record;
    }
  }

  return null;
}

function tryParseJsonObject(value: unknown): unknown | null {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getArrayArg(args: Record<string, unknown>, name: string): unknown[] | undefined {
  const value = args[name];
  return Array.isArray(value) ? value : undefined;
}

function getBooleanStringArg(args: Record<string, unknown>, name: string): boolean {
  const value = args[name];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

const SQL_OPERATORS: Record<string, string> = {
  is: " is ",
  "!is": " is not ",
  like: " like ",
  "!like": " not like ",
  in: " in(",
  "!in": " not in(",
  "=": "=",
  "<>": "<>",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  between: " between "
};

function formatSqlValue(value: unknown, operator: string): string {
  if (Array.isArray(value)) {
    return value.map(item => formatSqlValue(item, "=")).join(",");
  }

  if (typeof value === "string") {
    return operator === "between" ? value : `N'${escapeSqlString(value)}'`;
  }

  if (typeof value === "boolean") return value ? "1" : "0";
  if (value === null) return "null";
  return String(value);
}

function decodeSqlWhere(where: unknown, wrap = false): string {
  if (!where) return "";
  if (typeof where === "string") return where;
  if (!Array.isArray(where) || where.length === 0) return "";

  const first = where[0];
  const hasLeadingLogic = first === "and" || first === "or";
  const logic = hasLeadingLogic ? String(first) : "and";
  const start = hasLeadingLogic ? 1 : 0;

  if (Array.isArray(where[start])) {
    const clauses = where
      .slice(start)
      .map(item => decodeSqlWhere(item, true))
      .filter(Boolean);
    const joined = clauses.join(` ${logic} `);
    return joined && (wrap || clauses.length > 1) ? `(${joined})` : joined;
  }

  const field = String(where[start] ?? "");
  const operator = String(where[start + 1] ?? "=");
  const value = where[start + 2];
  const sqlOperator = SQL_OPERATORS[operator] ?? "=";
  let clause = `${field}${sqlOperator}${formatSqlValue(value, operator)}`;
  if (operator === "in" || operator === "!in") clause += ")";
  return wrap ? `(${clause})` : clause;
}

function buildSqlRestSelectUrl(
  tableUrl: string,
  options: SqlRestSelectOptions
): string {
  if (options.id) {
    return `${tableUrl.replace(/\/+$/, "")}/${encodeURIComponent(options.id)}`;
  }

  const params = new URLSearchParams();
  params.set("where", decodeSqlWhere(options.where));
  if (options.select) params.set("select", options.select);
  if (options.orderby) params.set("orderby", options.orderby);
  if (options.limit) params.set("limit", String(options.limit));
  return `${tableUrl}?${params.toString()}`;
}

function getQuickSearchWhere(table: Record<string, unknown>, query: string): unknown[] | undefined {
  if (!query) return undefined;
  const field = String(
    table.columnfind
    || table.columndisplay
    || table.columncode
    || table.columnkey
    || ""
  );
  return field ? [field, "like", `%${query}%`] : undefined;
}

async function readZilcodeRecords(
  env: Env,
  session: ZilcodeSession,
  table: Record<string, unknown>,
  options: SqlRestSelectOptions
): Promise<unknown> {
  const urlview = String(table.urlview ?? "");
  if (!urlview) throw new Error("Table không có urlview để đọc dữ liệu.");

  const endpoint = buildSqlRestSelectUrl(resolveZilcodeUrl(env, urlview, session.base_url), options);
  const envelope = await callZilcodeJson(env, endpoint, { token: session.token });
  return envelope.success === false ? assertZilcodeSuccess(envelope) : envelope.result ?? envelope;
}

function noZilcodeSessionResult(): ToolExecutionResult {
  return {
    content: JSON.stringify({
      error: "Chưa đăng nhập Zilcode trong chatbot. Hãy đăng nhập bằng form Zilcode ở giao diện chat trước khi dùng tool đọc dữ liệu Zilcode."
    }, null, 2)
  };
}

async function executeTool(
  tool: ToolCall,
  env: Env,
  screenContext?: ScreenContext,
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

    case "get_workflow": {
      const id = getStringArg(tool.arguments, "id");
      if (!id) return { content: "Lỗi: bắt buộc phải có ID workflow." };

      addDebugStep(debugSteps, "tool.get_workflow", "ok", "Trả mock workflow hiện tại.", {
        id
      });

      // TODO: thay mock bằng API Zilcode thật khi đã có token
      // const res = await fetch(`https://api.zilcode.io/workflows/${id}`, {
      //   headers: { Authorization: `Bearer ${env.ZILCODE_API_TOKEN}` }
      // });
      // return await res.text();

      return { content: JSON.stringify({
        _mock: true,
        id,
        name: `Workflow ${id}`,
        status: "đang hoạt động",
        nodes: [
          { id: "start", type: "trigger", label: "Bắt đầu" },
          {
            id: "condition-1",
            type: "condition",
            label: "Kiểm tra số tiền",
            config: { field: "amount", operator: ">", value: 1000 }
          },
          { id: "send-mail", type: "action", label: "Gửi email" },
          { id: "end", type: "end", label: "Kết thúc" }
        ],
        edges: [
          { from: "start", to: "condition-1" },
          { from: "condition-1", to: "send-mail", branch: "true" },
          { from: "condition-1", to: "end", branch: "false" }
        ]
      }, null, 2) };
    }

    case "get_screen_context": {
      addDebugStep(debugSteps, "tool.get_screen_context", "ok", screenContext ? "Dùng screen context từ request." : "Không có screen context, dùng mock context.", {
        has_screen_context: Boolean(screenContext)
      });

      if (screenContext) {
        return { content: JSON.stringify(screenContext, null, 2) };
      }
      return { content: JSON.stringify({
        _mock: true,
        screen: "workflow-editor",
        selected_node: "condition-1",
        resource_id: "wf-001"
      }, null, 2) };
    }

    case "zilcode_get_session_info": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      return { content: JSON.stringify(publicSessionPayload(zilcodeSession), null, 2) };
    }

    case "zilcode_list_applications": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const applications = listSessionApplicationSummaries(zilcodeSession.session);
      return { content: JSON.stringify({
        applications,
        raw_apps: zilcodeSession.session.apps ?? [],
        has_role_org: Boolean(zilcodeSession.session.roleid),
        note: zilcodeSession.session.apps ? undefined : "Phiên hiện tại chưa có apps. Hãy chọn role/org trước."
      }, null, 2) };
    }

    case "zilcode_list_accessible_tables": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const keyword = getStringArg(tool.arguments, "keyword").toLowerCase();
      const limit = Math.min(
        300,
        Math.max(1, Number(getStringArg(tool.arguments, "limit")) || 120)
      );
      const result = await listAccessibleZilcodeTables(env, zilcodeSession.session, keyword, limit);
      return { content: JSON.stringify(result, null, 2) };
    }

    case "zilcode_get_user_permissions": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const tableName = getStringArg(tool.arguments, "table_name");
      const access = zilcodeSession.session.access ?? {};
      const content = tableName
        ? { table_name: tableName, access: access[tableName] ?? null }
        : { access };
      return { content: JSON.stringify(content, null, 2) };
    }

    case "zilcode_get_app_metadata": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      if (!appid) return { content: "Lỗi: bắt buộc phải có appid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const includeFull = getBooleanStringArg(tool.arguments, "include_full");
      return { content: JSON.stringify(includeFull ? metadata : summarizeAppMetadata(metadata), null, 2) };
    }

    case "zilcode_search_windows": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const keyword = getStringArg(tool.arguments, "keyword").toLowerCase();
      if (!appid || !keyword) return { content: "Lỗi: bắt buộc phải có appid và keyword." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const matches = toArrayValues(metadata.menus)
        .filter(menu => {
          if (!menu || typeof menu !== "object") return false;
          const item = menu as Record<string, unknown>;
          const haystack = [item.menuname, item.translate, item.linkwindowid, item.windowid, item.execname]
            .map(value => String(value ?? "").toLowerCase())
            .join(" ");
          return haystack.includes(keyword);
        })
        .slice(0, 30);
      return { content: JSON.stringify({ appid, keyword, windows: matches }, null, 2) };
    }

    case "zilcode_get_window_config": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const windowid = getStringArg(tool.arguments, "windowid");
      if (!windowid) return { content: "Lỗi: bắt buộc phải có windowid." };
      const envelope = await callZilcodeJson<Record<string, unknown>>(
        env,
        `rest/token/cache/${encodeURIComponent(windowid)}`,
        { token: zilcodeSession.session.token, baseUrl: zilcodeSession.session.base_url }
      );
      const cache = assertZilcodeSuccess(envelope) as Record<string, unknown>;
      const parsedConfig = tryParseJsonObject(cache.configjson);
      const parsedLayout = tryParseJsonObject(cache.layoutjson);
      return { content: JSON.stringify({
        windowid,
        parsed: Boolean(parsedConfig),
        config: parsedConfig,
        layout: parsedLayout,
        raw: parsedConfig ? undefined : {
          configjson_length: String(cache.configjson ?? "").length,
          configjson_preview: String(cache.configjson ?? "").slice(0, 800),
          layoutjson_length: String(cache.layoutjson ?? "").length
        },
        warning: parsedConfig ? undefined : "configjson có thể đang ở dạng Zipson. Tool hiện trả raw preview; cần thêm parser Zipson nếu muốn parse tabs/fields trực tiếp trong Worker."
      }, null, 2) };
    }

    case "zilcode_list_tables": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const keyword = getStringArg(tool.arguments, "keyword").toLowerCase();
      if (!appid) return { content: "Lỗi: bắt buộc phải có appid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const tables = toArrayValues(metadata.tables)
        .filter(table => {
          if (!keyword) return true;
          if (!table || typeof table !== "object") return false;
          const item = table as Record<string, unknown>;
          const haystack = [item.tableid, item.tablename, item.alias, item.description, item.columndisplay]
            .map(value => String(value ?? "").toLowerCase())
            .join(" ");
          return haystack.includes(keyword);
        })
        .slice(0, 80);
      return { content: JSON.stringify({ appid, keyword, tables }, null, 2) };
    }

    case "zilcode_get_table_metadata": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const tableid = getStringArg(tool.arguments, "tableid");
      const tableName = getStringArg(tool.arguments, "table_name");
      if (!appid) return { content: "Lỗi: bắt buộc phải có appid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const table = findTableMetadata(metadata, tableid, tableName);
      return { content: JSON.stringify({ appid, tableid, table_name: tableName, table }, null, 2) };
    }

    case "zilcode_search_records": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const tableid = getStringArg(tool.arguments, "tableid");
      const tableName = getStringArg(tool.arguments, "table_name");
      const query = getStringArg(tool.arguments, "query");
      const select = getStringArg(tool.arguments, "select");
      const orderby = getStringArg(tool.arguments, "orderby");
      const limit = Math.min(
        ZILCODE_READ_LIMIT_MAX,
        Math.max(1, Number(getStringArg(tool.arguments, "limit")) || ZILCODE_READ_LIMIT_DEFAULT)
      );
      if (!appid) return { content: "Lỗi: bắt buộc phải có appid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const table = findTableMetadata(metadata, tableid, tableName);
      if (!table) return { content: `Không tìm thấy table với tableid='${tableid}' hoặc table_name='${tableName}'.` };
      const where = getArrayArg(tool.arguments, "where") ?? getQuickSearchWhere(table, query);
      const records = await readZilcodeRecords(env, zilcodeSession.session, table, { where, select, orderby, limit });
      return { content: JSON.stringify({
        appid,
        table: {
          tableid: table.tableid,
          tablename: table.tablename,
          columnkey: table.columnkey,
          columndisplay: table.columndisplay
        },
        query,
        where,
        limit,
        records
      }, null, 2) };
    }

    case "zilcode_get_record": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const tableid = getStringArg(tool.arguments, "tableid");
      const tableName = getStringArg(tool.arguments, "table_name");
      const recordid = getStringArg(tool.arguments, "recordid");
      if (!appid || !recordid) return { content: "Lỗi: bắt buộc phải có appid và recordid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const table = findTableMetadata(metadata, tableid, tableName);
      if (!table) return { content: `Không tìm thấy table với tableid='${tableid}' hoặc table_name='${tableName}'.` };
      const record = await readZilcodeRecords(env, zilcodeSession.session, table, { id: recordid });
      return { content: JSON.stringify({
        appid,
        table: {
          tableid: table.tableid,
          tablename: table.tablename,
          columnkey: table.columnkey,
          columndisplay: table.columndisplay
        },
        recordid,
        record
      }, null, 2) };
    }

    case "zilcode_get_domain_values": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const appid = getStringArg(tool.arguments, "appid");
      const domainid = getStringArg(tool.arguments, "domainid");
      if (!appid || !domainid) return { content: "Lỗi: bắt buộc phải có appid và domainid." };
      const metadata = await fetchZilcodeAppMetadata(env, zilcodeSession.session, appid);
      const domain = toArrayValues(metadata.domains).find(item => {
        if (!item || typeof item !== "object") return false;
        return String((item as Record<string, unknown>).domainid ?? "") === domainid;
      }) as Record<string, unknown> | undefined;
      const values = domain?.domainjson ? tryParseJsonObject(domain.domainjson) : null;
      return { content: JSON.stringify({ appid, domainid, domain, values }, null, 2) };
    }

    default:
      return { content: `Không nhận diện được công cụ: ${tool.name}` };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScreenContext {
  screen?: string;
  selected_node?: string;
  resource_id?: string;
}

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatHistoryMessage[];
  context?: ScreenContext;
  debug?: boolean;
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
  module: string;
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

function formatToolResultsForFinalAnswer(toolResults: ToolResultRecord[]): string {
  return toolResults
    .map((result, index) => [
      `[KET_QUA_CONG_CU ${index + 1}: ${result.name}]`,
      result.content,
      `[HET_KET_QUA_CONG_CU ${index + 1}]`
    ].join("\n"))
    .join("\n\n");
}

function cleanMarkdownArtifacts(answer: string): string {
  return answer
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function sanitizeChatHistory(history: unknown): AIMessage[] {
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

async function runAgenticLoop(
  userMessage: string,
  env: Env,
  screenContext?: ScreenContext,
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
Khi dùng rag_search, thường chỉ gọi một lần với query tổng hợp tốt. Chỉ gọi lại nếu kết quả chưa đủ và query mới khác rõ ràng về ý định hoặc phạm vi; không gọi lại cùng query hoặc query tương đương.
Chỉ dùng get_screen_context khi người dùng hỏi về đối tượng đang hiển thị/được chọn trong UI và câu trả lời phụ thuộc vào màn hình/node/tài nguyên hiện tại. Không dùng get_screen_context chỉ vì người dùng đang chat.
Chỉ dùng get_workflow khi có workflow ID rõ ràng hoặc sau khi có screen context cho thấy tài nguyên hiện tại là workflow cần phân tích.
Các công cụ bắt đầu bằng zilcode_ là read-only tools gọi API Zilcode bằng phiên đăng nhập của người dùng trong chatbot. Dùng các công cụ này khi người dùng hỏi dữ liệu hoặc metadata đang có trong hệ thống Zilcode thật: app, quyền, window, table, domain hoặc record. Nếu chưa đăng nhập Zilcode, hãy yêu cầu người dùng đăng nhập ở giao diện chat trước. Không dùng các công cụ zilcode_ cho chào hỏi hoặc kiến thức chung có thể trả lời bằng general_chat/RAG.
Với câu hỏi ngoài phạm vi Zilcode, hãy dùng general_chat.
Sau khi đã có đủ thông tin từ công cụ, hãy trả lời ngay thay vì tiếp tục gọi thêm công cụ. Nếu general_chat đã trả lời và chưa dùng rag_search, hãy dùng nội dung đó làm cơ sở cho câu trả lời cuối cùng.
Khi đã dùng rag_search và có kết quả, không gọi general_chat để hỏi lại kiến thức chung; hãy tổng hợp câu trả lời từ kết quả rag_search.
Khi đã dùng rag_search nhưng không tìm thấy thông tin phù hợp, hãy nói rõ là chưa tìm thấy trong tài liệu hiện có thay vì bịa nội dung.
Trả lời đúng mức chi tiết theo yêu cầu của người dùng, cụ thể và ưu tiên các bước thao tác rõ ràng.`
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

      return {
        answer: response.response ?? "Không tạo được câu trả lời.",
        toolsCalled
      };
    }

    const hasRagSearchCall = response.tool_calls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? response.tool_calls.filter(toolCall => toolCall.name !== "general_chat")
      : response.tool_calls;

    addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model đã chọn tool.", {
      iteration: i + 1,
      tool_calls: response.tool_calls.map(toolCall => toolCall.name),
      executed_tool_calls: toolCallsToExecute.map(toolCall => toolCall.name),
      skipped_general_chat_because_rag: hasRagSearchCall && toolCallsToExecute.length !== response.tool_calls.length
    });

    let generalChatResult: string | null = null;

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
        screenContext,
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
        content: toolResult
      });

      if (toolCall.name === "general_chat") {
        generalChatResult = toolResult;
      }

      if (toolCall.name === "rag_search") {
        hasRagSearchResult = true;
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

// ─── Zilcode auth handlers ──────────────────────────────────────────────────

function getRecordId(record: unknown, keys: string[]): string | number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const data = record as Record<string, unknown>;
  const entries = Object.entries(data);
  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return undefined;
}

const ROLE_ID_KEYS = ["id", "roleid", "role_id"];
const ORG_ID_KEYS = ["id", "orgid", "org_id", "organizationid", "organization_id"];
const APP_ID_KEYS = ["appid", "app_id", "applicationid", "application_id", "id"];
const ROLE_LABEL_KEYS = ["rolename", "role_name", "name", "text", "label", "displayname", "description", "rolecode", "code"];
const ORG_LABEL_KEYS = ["orgname", "org_name", "organizationname", "organization_name", "name", "text", "label", "displayname", "description", "orgcode", "code"];
const APP_LABEL_KEYS = ["appname", "app_name", "applicationname", "application_name", "name", "title", "text", "label", "displayname", "description", "appcode", "code"];
const TABLE_ID_KEYS = ["tableid", "table_id", "id"];
const TABLE_LABEL_KEYS = ["tablename", "table_name", "alias", "name", "title", "text", "label", "displayname", "description"];

function getRecordLabel(record: unknown, keys: string[], fallback?: string): string | undefined {
  if (!record || typeof record !== "object") return fallback;
  const entries = Object.entries(record as Record<string, unknown>);

  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function findRecordById(records: unknown, id: unknown, keys: string[]): unknown | undefined {
  if (id === undefined || id === null || id === "") return undefined;
  const normalizedId = String(id);
  return toArrayValues(records).find(record => String(getRecordId(record, keys) ?? "") === normalizedId);
}

function getSelectedRoleName(session: ZilcodeSession): string | undefined {
  const role = findRecordById(session.roles, session.roleid, ROLE_ID_KEYS);
  return getRecordLabel(role, ROLE_LABEL_KEYS, session.roleid === undefined ? undefined : String(session.roleid));
}

function getSelectedOrgName(session: ZilcodeSession): string | undefined {
  if (session.orgid === undefined || session.orgid === null || String(session.orgid) === "0") {
    return "Không chọn tổ chức";
  }

  const org = findRecordById(session.orgs, session.orgid, ORG_ID_KEYS);
  return getRecordLabel(org, ORG_LABEL_KEYS, String(session.orgid));
}

function toKeyedValues(value: unknown): Array<{ key?: string; value: unknown }> {
  if (Array.isArray(value)) return value.map(item => ({ value: item }));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({ key, value: item }));
  }
  return [];
}

function listSessionApplicationSummaries(session: ZilcodeSession): Record<string, unknown>[] {
  const summaries: Array<Record<string, unknown> | null> = toKeyedValues(session.apps)
    .map(({ key, value }) => {
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const appid = String(getRecordId(record, APP_ID_KEYS) ?? key ?? "");
        if (!appid) return null;
        return {
          appid,
          app_name: getRecordLabel(record, APP_LABEL_KEYS, appid),
          app_code: getRecordLabel(record, ["appcode", "app_code", "code"], undefined),
          raw: record
        };
      }

      const appid = String(value ?? key ?? "");
      if (!appid) return null;
      return { appid, app_name: appid, raw: value };
    });

  return summaries.filter((item): item is Record<string, unknown> => item !== null);
}

function summarizeZilcodeTable(
  table: Record<string, unknown>,
  app: Record<string, unknown>
): Record<string, unknown> {
  return {
    appid: app.appid,
    app_name: app.app_name,
    tableid: getRecordId(table, TABLE_ID_KEYS) ?? table.tableid,
    tablename: table.tablename ?? table.table_name ?? table.name,
    display_name: getRecordLabel(table, TABLE_LABEL_KEYS, undefined),
    alias: table.alias,
    description: table.description,
    columnkey: table.columnkey,
    columndisplay: table.columndisplay,
    columnfind: table.columnfind,
    urlview: table.urlview
  };
}

function matchesZilcodeTableKeyword(
  table: Record<string, unknown>,
  app: Record<string, unknown>,
  keyword: string
): boolean {
  if (!keyword) return true;
  const haystack = [
    app.appid,
    app.app_name,
    table.tableid,
    table.table_id,
    table.tablename,
    table.table_name,
    table.alias,
    table.description,
    table.columndisplay,
    table.columnfind
  ]
    .map(value => String(value ?? "").toLowerCase())
    .join(" ");
  return haystack.includes(keyword);
}

async function listAccessibleZilcodeTables(
  env: Env,
  session: ZilcodeSession,
  keyword: string,
  limit: number
): Promise<Record<string, unknown>> {
  const apps = listSessionApplicationSummaries(session);
  const tables: Record<string, unknown>[] = [];
  const appResults: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  for (const app of apps) {
    const appid = String(app.appid ?? "");
    if (!appid || tables.length >= limit) continue;

    try {
      const metadata = await fetchZilcodeAppMetadata(env, session, appid);
      const appTables = toArrayValues(metadata.tables)
        .filter((table): table is Record<string, unknown> => Boolean(table) && typeof table === "object")
        .filter(table => matchesZilcodeTableKeyword(table, app, keyword))
        .map(table => summarizeZilcodeTable(table, app));
      const remaining = Math.max(0, limit - tables.length);
      const selectedTables = appTables.slice(0, remaining);
      tables.push(...selectedTables);
      appResults.push({
        appid,
        app_name: app.app_name,
        tables_count: appTables.length,
        returned_count: selectedTables.length
      });
    } catch (error) {
      errors.push({
        appid,
        app_name: app.app_name,
        error: getErrorText(error)
      });
    }
  }

  return {
    roleid: session.roleid,
    role_name: getSelectedRoleName(session),
    orgid: session.orgid,
    org_name: getSelectedOrgName(session),
    apps_count: apps.length,
    apps: appResults,
    keyword: keyword || undefined,
    tables_count: tables.length,
    tables,
    errors: errors.length ? errors : undefined,
    note: tables.length >= limit ? `Đã giới hạn ${limit} table. Truyền keyword để lọc hẹp hơn nếu cần.` : undefined
  };
}

async function applyZilcodeRoleOrg(
  env: Env,
  session: ZilcodeSession,
  roleid: string | number,
  orgid: string | number
): Promise<void> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    "rest/token/roleorg",
    {
      method: "PUT",
      token: session.token,
      baseUrl: session.base_url,
      data: [roleid, orgid || 0]
    }
  );
  const result = assertZilcodeSuccess(envelope);
  session.roleid = roleid;
  session.orgid = orgid || 0;
  session.access = (result.access && typeof result.access === "object")
    ? result.access as Record<string, unknown>
    : {};
  session.apps = result.apps ?? [];
  session.notifies = result.notifies ?? [];
  session.updated_at = new Date().toISOString();
}

async function handleZilcodeLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    username?: string;
    sitecode?: string;
    password?: string;
    zilcode_base?: string;
  };

  const username = body.username?.trim();
  const sitecode = body.sitecode?.trim();
  const password = body.password ?? "";
  const baseUrl = normalizeZilcodeBaseInput(body.zilcode_base);

  if (!username || !sitecode || !password) {
    return Response.json(
      { success: false, error: "Bắt buộc phải có username, sitecode và password." },
      { status: 400, headers: CORS }
    );
  }

  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    "rest/token/",
    {
      method: "POST",
      baseUrl,
      data: [username, sitecode, password]
    }
  );
  const user = assertZilcodeSuccess(envelope);
  const token = String(user.token ?? "");
  if (!token) {
    throw new Error("Zilcode login thành công nhưng response không có token.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + getSessionTtlSeconds(env) * 1000);
  const sessionId = crypto.randomUUID();
  const roles = user.roles ?? [];
  const orgs = user.orgs ?? [];
  const session: ZilcodeSession = {
    token,
    base_url: getZilcodeBase(env, baseUrl),
    user: stripSensitiveUserFields(user),
    roles,
    orgs,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  };

  const roleValues = toArrayValues(roles);
  const orgValues = toArrayValues(orgs);
  if (roleValues.length === 1 && orgValues.length <= 1) {
    const roleid = getRecordId(roleValues[0], ROLE_ID_KEYS);
    const orgid = orgValues.length ? getRecordId(orgValues[0], ORG_ID_KEYS) ?? 0 : 0;
    if (roleid !== undefined) {
      await applyZilcodeRoleOrg(env, session, roleid, orgid);
    }
  }

  await saveZilcodeSession(env, sessionId, session);
  const state = { id: sessionId, session };

  return Response.json(
    {
      success: true,
      ...publicSessionPayload(state),
      needs_role_org: !session.roleid
    },
    { headers: CORS }
  );
}

async function handleZilcodeSelectRoleOrg(request: Request, env: Env): Promise<Response> {
  const state = await loadZilcodeSession(request, env);
  if (!state) {
    return Response.json(
      { success: false, error: "Chưa có phiên Zilcode hoặc phiên đã hết hạn." },
      { status: 401, headers: CORS }
    );
  }

  const body = await request.json() as {
    roleid?: string | number;
    orgid?: string | number;
  };

  if (body.roleid === undefined || body.roleid === "") {
    return Response.json(
      { success: false, error: "Bắt buộc phải có roleid." },
      { status: 400, headers: CORS }
    );
  }

  await applyZilcodeRoleOrg(env, state.session, body.roleid, body.orgid ?? 0);
  await saveZilcodeSession(env, state.id, state.session);

  return Response.json(
    { success: true, ...publicSessionPayload(state), needs_role_org: false },
    { headers: CORS }
  );
}

async function handleZilcodeMe(request: Request, env: Env): Promise<Response> {
  const state = await loadZilcodeSession(request, env);
  if (!state) {
    return Response.json(
      { success: false, authenticated: false },
      { status: 401, headers: CORS }
    );
  }

  return Response.json(
    { success: true, authenticated: true, ...publicSessionPayload(state) },
    { headers: CORS }
  );
}

async function handleZilcodeLogout(request: Request, env: Env): Promise<Response> {
  await deleteZilcodeSession(env, getSessionIdFromRequest(request));
  return Response.json({ success: true }, { headers: CORS });
}

// ─── Worker handler ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    const url = new URL(request.url);

    // ── OPTIONS — CORS preflight ─────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── GET / — health check ─────────────────────────────────────────────────
    if (url.pathname === "/") {
      return Response.json({
        success: true,
        message: "Workers AI đang chạy",
        tools: TOOLS.map(t => t.name)
      }, { headers: CORS });
    }

    // ── POST /chat — agentic chat ────────────────────────────────────────────
    if (url.pathname === "/auth/login" && request.method === "POST") {
      try {
        return await handleZilcodeLogin(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lỗi đăng nhập Zilcode." },
          { status: 500, headers: CORS }
        );
      }
    }

    if (url.pathname === "/auth/select-role-org" && request.method === "POST") {
      try {
        return await handleZilcodeSelectRoleOrg(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lỗi chọn role/org Zilcode." },
          { status: 500, headers: CORS }
        );
      }
    }

    if (url.pathname === "/auth/me" && request.method === "GET") {
      return handleZilcodeMe(request, env);
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return handleZilcodeLogout(request, env);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      let debugSteps: DebugStep[] | undefined;

      try {
        const body = await request.json() as ChatRequest;

        if (!body.message) {
          return Response.json(
            { success: false, error: "Bắt buộc phải có trường message." },
            { status: 400, headers: CORS }
          );
        }

        const debugEnabled = body.debug === true;
        debugSteps = debugEnabled ? [] as DebugStep[] : undefined;
        const zilcodeSession = await loadZilcodeSession(request, env);

        addDebugStep(debugSteps, "request.received", "ok", "Worker nhận request /chat.", {
          message_chars: body.message.length,
          raw_history_messages: Array.isArray(body.history) ? body.history.length : 0,
          has_context: Boolean(body.context),
          has_zilcode_session: Boolean(zilcodeSession)
        });

        const chatHistory = sanitizeChatHistory(body.history);
        addDebugStep(debugSteps, "history.sanitized", "ok", "Làm sạch history trước khi đưa vào model.", {
          history_messages: chatHistory.length,
          max_history_messages: MAX_HISTORY_MESSAGES
        });

        const { answer, toolsCalled, images, sources, embedding_debug, rag_query_debug } = await runAgenticLoop(
          body.message,
          env,
          body.context,
          chatHistory,
          debugSteps,
          zilcodeSession
        );

        addDebugStep(debugSteps, "response.ready", "ok", "Chuẩn bị trả response về client.", {
          tools_called: toolsCalled,
          answer_chars: answer.length,
          sources: sources?.length ?? 0,
          images: images?.length ?? 0
        });

        return Response.json({
          success: true,
          response: answer,
          tools_called: toolsCalled,
          images,
          sources,
          embedding_debug,
          rag_query_debug,
          debug_steps: debugSteps
        }, { headers: CORS });

      } catch (error) {
        addDebugStep(debugSteps, "response.error", "error", "Worker gặp lỗi khi xử lý /chat.", {
          error: error instanceof Error ? error.message : "Lỗi không xác định"
        });

        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lỗi không xác định",
            debug_steps: debugSteps
          },
          { status: 500, headers: CORS }
        );
      }
    }

    // ── POST /embed — raw embedding ──────────────────────────────────────────
    if (url.pathname === "/embed" && request.method === "POST") {
      try {
        const body = await request.json() as { text?: string };

        if (!body.text) {
          return Response.json(
            { success: false, error: "Bắt buộc phải có trường text." },
            { status: 400, headers: CORS }
          );
        }

        const embedding = await env.AI.run(EMBEDDING_MODEL, { text: body.text });
        return Response.json({ success: true, embedding }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lỗi không xác định"
          },
          { status: 500, headers: CORS }
        );
      }
    }

    return new Response("Không tìm thấy", { status: 404, headers: CORS });
  }
};
