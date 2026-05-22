// src/index.ts

import * as zipsonModule from "./vendor/zipson.min.js";

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
const RAG_VECTOR_TOP_K = 16;
const RAG_MAX_CONTEXT_CHUNKS = 6;
const RAG_MIN_SCORE = 0.35;
const RAG_RERANK_TEXT_MAX_CHARS = 900;
const RAG_VECTOR_DIMENSIONS = 1024;
const TOOL_RESULT_CONTEXT_MAX_CHARS = 16000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CONTENT_CHARS = 1200;
const DEFAULT_ZILCODE_BASE = "https://demo.zilcode.com";
const ZILCODE_SESSION_PREFIX = "zilcode_session:";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

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
      "Trả lời hội thoại thông thường bằng kiến thức sẵn có của trợ lý. Dùng cho chào hỏi, cảm ơn, hỏi trợ lý là ai/có thể làm gì, câu hỏi ngoài Zilcode, hoặc câu hỏi kiến thức chung không cần tra cứu tài liệu Zilcode.",
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
      "Tra cứu kho tài liệu Zilcode đã ingest, gồm tài liệu hướng dẫn sử dụng, quản trị và doc/logic về cách Zilcode hoạt động. Dùng khi cần giải thích tính năng, hướng dẫn thao tác, kiến trúc, API contract, domain model, window/tab/field config, hoặc cần kiến thức logic để gọi tool Zilcode đúng hơn.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tìm kiếm tài liệu. Giữ thuật ngữ Zilcode quan trọng và thêm ngữ cảnh nếu có."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "draw_chart",
    description:
      "Tạo ảnh biểu đồ, sơ đồ, flowchart, timeline, mindmap, dashboard mockup hoặc infographic bằng model ảnh Flux. Dùng khi người dùng yêu cầu vẽ hoặc tạo hình minh họa trực quan.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Mô tả ảnh biểu đồ/sơ đồ cần tạo: loại biểu đồ, dữ liệu chính, bố cục, phong cách, màu sắc và ngôn ngữ nhãn nếu có."
        },
        width: {
          type: "string",
          description: "Chieu rong anh, mac dinh 1024. Gia tri hop le tu 256 den 1920."
        },
        height: {
          type: "string",
          description: "Chieu cao anh, mac dinh 768. Gia tri hop le tu 256 den 1920."
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "zilcode_get_system_blueprint",
    description:
      "Read-only tool. Lấy bản đồ graph hệ thống Zilcode của phiên đăng nhập hiện tại. Mặc định dùng mode=graph để lấy graph compact gồm apps, menus/windows, tabs, tables, domains, relations và các cạnh quan hệ. Nếu graph chưa đủ để trả lời, gọi lại mode=subgraph hoặc mode=detail với node_id/node_ids lấy từ graph để đào sâu phần liên quan. Không dùng tool này cho chào hỏi hoặc kiến thức chung.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "graph | subgraph | detail. Mặc định graph. graph trả bản đồ compact; subgraph trả vùng liên quan quanh node_id; detail trả dữ liệu chi tiết của node_id/node_ids."
        },
        appid: {
          type: "string",
          description: "Optional appid. Bỏ trống để quét tất cả app trong phiên hiện tại."
        },
        node_id: {
          type: "string",
          description: "Optional graph node id cần đào sâu, ví dụ app:1, window:101, table:1:Customer, tab:101:5. Lấy node_id từ kết quả mode=graph."
        },
        node_ids: {
          type: "string",
          description: "Optional danh sách node id, phân tách bằng dấu phẩy, dùng cho subgraph/detail khi cần nhiều node."
        },
        depth: {
          type: "string",
          description: "Độ sâu mở rộng quanh node_id cho mode=subgraph, mặc định 1, tối đa 4."
        },
        include_fields: {
          type: "string",
          description: "true/false. Mặc định false với graph/subgraph và true với detail. Chỉ bật true khi cần field trong tab/window liên quan."
        },
        include_raw: {
          type: "string",
          description: "true/false. Mặc định false. Chỉ bật true khi debug vì raw payload có thể lớn."
        },
        max_apps: {
          type: "string",
          description: "Số app tối đa cần đọc, mặc định 5."
        },
        max_windows_per_app: {
          type: "string",
          description: "Số window/cache tối đa mỗi app, mặc định 20."
        }
      }
    }
  }
];

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
  source_path?: string;
  title?: string;
  doc_type?: string;
  doc_group?: string;
  logic_area?: string;
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

function truncateDebugText(value: unknown, maxChars = 700): string {
  const text = getErrorText(value);
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
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
      description: getRuntimeToolDescription(tool.name, tool.description),
      parameters: tool.parameters
    }
  }));
}

function getRuntimeToolDescription(name: string, description: string): string {
  if (name !== "rag_search") return description;

  return `${description}

Bổ sung sau ingest: rag_search cũng có thể tra cứu doc/logic/*.md. Dùng nó khi cần hiểu cách Zilcode hoạt động, domain model, REST API contract, runtime architecture, window/tab/field config, tool safety rules, hoặc khi cần lấy kiến thức logic để chọn/gọi các tool Zilcode đúng hơn và kết hợp với dữ liệu thật.`;
}

function buildCloudflareChatRequest(
  cfModel: string,
  request: ChatModelRequest
): Record<string, unknown> {
  if (!isOpenAiWorkersModel(cfModel)) {
    return {
      ...request,
      tools: request.tools?.map(tool => ({
        ...tool,
        description: getRuntimeToolDescription(tool.name, tool.description)
      }))
    } as unknown as Record<string, unknown>;
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
    chunk.doc_group,
    chunk.logic_area,
    chunk.audience,
    chunk.section_path ?? chunk.heading
  ].filter(Boolean).join(" | ");
}

function toRagSource(candidate: RagCandidate): RagSource {
  return {
    id: candidate.id,
    title: candidate.title ?? candidate.module,
    filename: candidate.filename,
    source_path: candidate.source_path,
    module: candidate.module,
    doc_group: candidate.doc_group,
    logic_area: candidate.logic_area,
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
    throw new Error("ZILCODE_BASE không hợp lệ. Hãy nhập URL đầy đủ, ví dụ https://demo.zilcode.com");
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
    throw new Error("ZILCODE_BASE chỉ được phép là domain Zilcode, localhost hoặc 127.0.0.1.");
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

    case "zilcode_get_system_blueprint": {
      if (!zilcodeSession) return noZilcodeSessionResult();
      const mode = getBlueprintMode(tool.arguments);

      addDebugStep(debugSteps, "tool.zilcode_get_system_blueprint", "start", "Lấy bản đồ tổng hợp hệ thống Zilcode.", {
        mode,
        appid: getStringArg(tool.arguments, "appid") || undefined,
        node_id: getStringArg(tool.arguments, "node_id") || undefined,
        node_ids: getNodeIdsArg(tool.arguments),
        depth: getLimitArg(tool.arguments, "depth", 1, 4),
        include_fields: getOptionalBooleanArg(tool.arguments, "include_fields", mode === "detail"),
        include_raw: getOptionalBooleanArg(tool.arguments, "include_raw", false)
      });

      const blueprint = await buildZilcodeSystemBlueprint(env, zilcodeSession.session, tool.arguments);
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

      addDebugStep(debugSteps, "tool.zilcode_get_system_blueprint", "ok", "Đã lấy system blueprint.", {
        mode: blueprint.mode,
        scan: blueprint.scan,
        apps_count: blueprint.apps_count,
        graph_nodes: graphNodes,
        graph_edges: graphEdges,
        app_errors_count: appErrors.length,
        app_errors: appErrors,
        window_errors_count: windowErrors.length,
        window_errors: windowErrors
      });

      return { content: JSON.stringify(blueprint, null, 2) };
    }

    default:
      return { content: `Không nhận diện được công cụ: ${tool.name}` };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────


interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatHistoryMessage[];
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
  if (result.name !== "zilcode_get_system_blueprint") return result.content;

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

async function createFinalAnswerFromToolResults(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<string> {
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

async function runAgenticLoop(
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
Bộ công cụ hiện tại gồm: general_chat, rag_search, draw_chart, zilcode_get_system_blueprint.
Khi cần đọc hệ thống Zilcode thật, dùng zilcode_get_system_blueprint theo flow graph-first: gọi mode=graph trước để lấy bản đồ compact gồm apps, windows, tabs, tables, domains, relations và các cạnh quan hệ. Nếu graph đã đủ để trả lời thì trả lời ngay. Nếu cần đào sâu một app/window/tab/table/domain/relation cụ thể, gọi lại mode=subgraph hoặc mode=detail với node_id/node_ids lấy từ graph; không yêu cầu full blueprint khi chưa có node liên quan.
Khi trả lời từ system blueprint, hãy viết dễ hiểu cho người dùng cuối: ưu tiên trường overview nếu có, không nhắc tên tool, không dùng bảng dài, không liệt kê toàn bộ bảng khi người dùng chỉ hỏi tổng quan. Hãy tóm tắt role/org, số app, số bảng/menu/window/domain/relation, vài ví dụ tiêu biểu và phần lỗi/chưa đọc được nếu có.
Khi dùng rag_search, thường chỉ gọi một lần với query tổng hợp tốt. Chỉ gọi lại nếu kết quả chưa đủ và query mới khác rõ ràng về ý định hoặc phạm vi; không gọi lại cùng query hoặc query tương đương.
Dùng zilcode_get_system_blueprint khi người dùng hỏi dữ liệu/cấu trúc hệ thống Zilcode thật của tài khoản đang đăng nhập: app, window/menu, tab, table, domain, relation, field, quyền hoặc các ràng buộc tạo app. Nếu chưa đăng nhập Zilcode, hãy yêu cầu người dùng đăng nhập ở giao diện chat trước. Không dùng zilcode_get_system_blueprint cho chào hỏi hoặc kiến thức chung có thể trả lời bằng general_chat/RAG.
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

      const directAnswer = response.response?.trim();
      if (directAnswer) {
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
        content: toolResult
      });

      if (toolCall.name === "general_chat") {
        generalChatResult = toolResult;
      }

      if (toolCall.name === "rag_search") {
        hasRagSearchResult = true;
      }

      if (toolCall.name === "zilcode_get_system_blueprint") {
        const blueprintMode = getBlueprintMode(toolCall.arguments);
        shouldLetModelInspectToolResult = blueprintMode === "graph" || blueprintMode === "subgraph";
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

const WINDOW_ID_KEYS = ["linkwindowid", "link_window_id", "windowid", "window_id", "winid"];
const WINDOW_LABEL_KEYS = ["windowname", "window_name", "menuname", "menu_name", "name", "title", "text", "label", "displayname", "translate", "description"];
const TAB_LABEL_KEYS = ["tabname", "tab_name", "name", "title", "text", "label", "displayname", "description"];
const FIELD_LABEL_KEYS = ["fieldname", "field_name", "columnname", "column_name", "name", "title", "text", "label", "displayname", "description"];
const ZILCODE_ERD = {
  window: ["windowid", "windowname", "windowtype", "appid", "execname", "isopenfind", "translate"],
  tab: ["tabid", "parenttabid", "tabname", "tablevel", "seqno", "layoutcols", "linkchildfield", "linkparentfield", "linktableid", "whereclause", "orderby", "tableid", "windowid", "relatechildfield", "relateparentfield", "relatetableid", "filterfield", "filterclause", "noinsert", "noupdate", "nodelete", "isarchive", "islock", "isautosave", "translate", "noselect", "noexport", "workflowid", "isviewonly", "labelspan"],
  field: ["fieldid", "fieldname", "translate", "hideingrid", "hideinform", "hideinfind", "displaylength", "seqno", "isreadonly", "fieldlength", "vformat", "defaultvalue", "isrequire", "isfrozen", "fieldgroup", "tabid", "columnid", "fieldtype", "linktableid", "domainid", "issearchtonghop", "parentfieldid", "wherefieldname", "placeholder", "calculation", "colspan", "rowspan", "mapcolumn", "displaylogic", "columnname", "tableid", "whereclause", "bindfieldname", "options", "columntype", "linkcolumn"],
  menu: ["menuid", "menuname", "parentid", "seqno", "translate", "issummary", "appid", "windowid", "siteid", "tabid", "menutype", "execname", "icon", "reportid"]
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getCaseInsensitiveValue(record: Record<string, unknown>, key: string): unknown {
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

function pickRecordFields(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = getCaseInsensitiveValue(record, key);
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  }
  return output;
}

function mapZilcodeArrayRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (!Array.isArray(value)) return asRecord(value);
  const record: Record<string, unknown> = {};

  for (let i = 0; i < keys.length; i++) {
    const item = value[i];
    if (item !== undefined && item !== null && item !== "") {
      record[keys[i]] = item;
    }
  }

  return record;
}

interface ZipsonRuntime {
  parse(input: string): unknown;
  stringify(value: unknown): string;
}

function getZipsonRuntime(): ZipsonRuntime {
  const moduleRuntime = zipsonModule as unknown as Partial<ZipsonRuntime> | undefined;
  const defaultRuntime = (zipsonModule as unknown as { default?: Partial<ZipsonRuntime> }).default;
  const globalRuntime = (globalThis as unknown as { zipson?: ZipsonRuntime }).zipson;
  const runtime = typeof moduleRuntime?.parse === "function"
    ? moduleRuntime as ZipsonRuntime
    : typeof defaultRuntime?.parse === "function"
      ? defaultRuntime as ZipsonRuntime
    : globalRuntime;

  if (!runtime || typeof runtime.parse !== "function") {
    throw new Error("Zipson parser chưa được nạp trong Worker runtime.");
  }
  return runtime;
}

function decodeZilcodeCachePayload(value: unknown): { value: unknown | null; format?: string; error?: string } {
  if (value === undefined || value === null || value === "") return { value: null, error: "empty" };
  if (typeof value === "object") return { value, format: "object" };
  if (typeof value !== "string") return { value: null, error: `unsupported_${typeof value}` };

  const text = value.trim();
  if (!text) return { value: null, error: "empty_string" };

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      const nested = decodeZilcodeCachePayload(parsed);
      return nested.value !== null
        ? { ...nested, format: `json_string:${nested.format ?? "unknown"}` }
        : { value: parsed, format: "json_string" };
    }
    return { value: parsed, format: "json" };
  } catch {
    // Window cache in Zilcode is normally zipson, not plain JSON.
  }

  try {
    return { value: getZipsonRuntime().parse(text), format: "zipson" };
  } catch (error) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) {
        const parsed = decodeZilcodeCachePayload(decoded);
        if (parsed.value !== null) {
          return { ...parsed, format: `uri:${parsed.format ?? "unknown"}` };
        }
      }
    } catch {
      // Ignore malformed URI escape sequences.
    }

    return { value: null, error: getErrorText(error) };
  }
}

function normalizeZilcodeWindowConfig(
  rawConfig: unknown,
  tableById: Map<string, Record<string, unknown>>
): Record<string, unknown> | null {
  const config = asRecord(rawConfig);
  if (!config) return null;

  const windowRecord = mapZilcodeArrayRecord(config.window, ZILCODE_ERD.window);
  const tabRecords = Array.isArray(config.tabs)
    ? config.tabs
      .map(tab => mapZilcodeArrayRecord(tab, ZILCODE_ERD.tab))
      .filter((tab): tab is Record<string, unknown> => Boolean(tab))
    : [];
  const fieldRecords = Array.isArray(config.fields)
    ? config.fields
      .map(field => mapZilcodeArrayRecord(field, ZILCODE_ERD.field))
      .filter((field): field is Record<string, unknown> => Boolean(field))
    : [];
  const menuRecords = Array.isArray(config.menus)
    ? config.menus
      .map(menu => mapZilcodeArrayRecord(menu, ZILCODE_ERD.menu))
      .filter((menu): menu is Record<string, unknown> => Boolean(menu))
    : [];
  const tabById = new Map<string, Record<string, unknown>>();

  for (const tab of tabRecords) {
    const tableId = String(tab.tableid ?? tab.linktableid ?? "");
    const linkedTable = tableId ? tableById.get(tableId) : undefined;
    if (linkedTable) {
      tab.linked_table = {
        tableid: linkedTable.tableid,
        tablename: linkedTable.tablename,
        alias: linkedTable.alias,
        columnkey: linkedTable.columnkey,
        columndisplay: linkedTable.columndisplay
      };
    }

    if (tab.tabid !== undefined && tab.tabid !== null) {
      tabById.set(String(tab.tabid), tab);
    }
  }

  for (const field of fieldRecords) {
    const tabid = String(field.tabid ?? "");
    const tab = tabid ? tabById.get(tabid) : undefined;
    if (tab && !tab.tableid && field.tableid) tab.tableid = field.tableid;
  }

  return {
    window: windowRecord ? [windowRecord] : [],
    tabs: tabRecords,
    fields: fieldRecords,
    menus: menuRecords
  };
}

function getOptionalBooleanArg(
  args: Record<string, unknown>,
  name: string,
  fallback: boolean
): boolean {
  const value = args[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function getLimitArg(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  max: number
): number {
  const value = args[name];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.round(parsed)));
}

type BlueprintMode = "graph" | "subgraph" | "detail";

function getBlueprintMode(args: Record<string, unknown>): BlueprintMode {
  const mode = getStringArg(args, "mode").toLowerCase();
  if (mode === "subgraph" || mode === "detail") return mode;
  return "graph";
}

function getNodeIdsArg(args: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const single = getStringArg(args, "node_id");
  if (single) ids.add(single);

  const raw = args.node_ids;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) ids.add(item.trim());
    }
  } else if (typeof raw === "string") {
    for (const item of raw.split(",")) {
      if (item.trim()) ids.add(item.trim());
    }
  }

  return [...ids];
}

function getFirstConfigArray(
  roots: unknown[],
  names: string[]
): Record<string, unknown>[] {
  for (const root of roots) {
    const record = asRecord(root);
    if (!record) continue;

    for (const name of names) {
      const value = getCaseInsensitiveValue(record, name);
      const valueRecord = asRecord(value);
      const items = Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : valueRecord
          ? Object.values(valueRecord).some(item => Boolean(item) && typeof item === "object")
            ? Object.values(valueRecord).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            : [valueRecord]
          : [];
      if (items.length) return items;
    }
  }

  return [];
}

function summarizeBlueprintTable(
  table: Record<string, unknown>,
  app: Record<string, unknown>
): Record<string, unknown> {
  return {
    appid: app.appid,
    app_name: app.app_name,
    ...pickRecordFields(table, [
      "tableid",
      "tablename",
      "tabletype",
      "alias",
      "description",
      "columnkey",
      "columncode",
      "columndisplay",
      "columnfind",
      "urlview",
      "urledit",
      "serviceid",
      "servicetype",
      "isreadonly",
      "isview"
    ])
  };
}

function summarizeBlueprintMenu(menu: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(menu, [
    "menuid",
    "menuname",
    "translate",
    "parentid",
    "seqno",
    "linktype",
    "linkwindowid",
    "windowid",
    "appid",
    "execname",
    "icon"
  ]);
}

function summarizeBlueprintDomain(domain: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(domain, [
    "domainid",
    "domainname",
    "name",
    "description",
    "domainjson",
    "datatype",
    "controltype"
  ]);
}

function summarizeBlueprintRelation(relation: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(relation, [
    "relateid",
    "relatename",
    "parenttableid",
    "childtableid",
    "parentfield",
    "childfield",
    "relatetype",
    "description"
  ]);
}

function extractWindowIdsFromAppMetadata(metadata: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const candidates = [
    ...toArrayValues(metadata.menus),
    ...toArrayValues(metadata.windows),
    ...toArrayValues(metadata.window)
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = getRecordId(candidate, WINDOW_ID_KEYS);
    if (id !== undefined && id !== null && String(id).trim()) {
      ids.add(String(id).trim());
    }
  }

  return [...ids];
}

async function fetchZilcodeWindowCache(
  env: Env,
  session: ZilcodeSession,
  windowid: string
): Promise<Record<string, unknown>> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    `rest/token/cache/${encodeURIComponent(windowid)}`,
    { token: session.token, baseUrl: session.base_url }
  );
  return assertZilcodeSuccess(envelope) as Record<string, unknown>;
}

function summarizeBlueprintTab(
  tab: Record<string, unknown>,
  tableById: Map<string, Record<string, unknown>>
): Record<string, unknown> {
  const tableId = String(
    getRecordId(tab, ["tableid", "table_id", "linktableid", "link_table_id"]) ?? ""
  );
  const linkedTable = tableId ? tableById.get(tableId) : undefined;

  return {
    ...pickRecordFields(tab, [
      "tabid",
      "tabname",
      "parenttabid",
      "tablevel",
      "tableid",
      "linktableid",
      "linkchildfield",
      "linkparentfield",
      "relatetableid",
      "relatechildfield",
      "relateparentfield",
      "workflowid",
      "isviewonly",
      "noinsert",
      "noupdate",
      "nodelete",
      "noselect",
      "noexport",
      "seqno"
    ]),
    label: getRecordLabel(tab, TAB_LABEL_KEYS, tableId || undefined),
    linked_table: linkedTable ? {
      tableid: linkedTable.tableid,
      tablename: linkedTable.tablename,
      alias: linkedTable.alias,
      columnkey: linkedTable.columnkey,
      columndisplay: linkedTable.columndisplay
    } : undefined
  };
}

function summarizeBlueprintField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pickRecordFields(field, [
      "fieldid",
      "fieldname",
      "columnname",
      "tablename",
      "tableid",
      "tabid",
      "caption",
      "label",
      "datatype",
      "controltype",
      "fieldtype",
      "columntype",
      "domainid",
      "defaultvalue",
      "isrequired",
      "isrequire",
      "isreadonly",
      "isvisible",
      "hideingrid",
      "hideinform",
      "hideinfind",
      "isprimarykey",
      "seqno"
    ]),
    label: getRecordLabel(field, FIELD_LABEL_KEYS, undefined)
  };
}

function buildTabRelations(tabs: Record<string, unknown>[]): Record<string, unknown> {
  const parentChild = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      parenttabid: tab.parenttabid,
      linktableid: tab.linktableid ?? tab.tableid,
      linkchildfield: tab.linkchildfield,
      linkparentfield: tab.linkparentfield
    }))
    .filter(item => item.parenttabid || item.linkchildfield || item.linkparentfield);

  const manyToMany = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      relatetableid: tab.relatetableid,
      relatechildfield: tab.relatechildfield,
      relateparentfield: tab.relateparentfield
    }))
    .filter(item => item.relatetableid || item.relatechildfield || item.relateparentfield);

  const tabTable = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      tableid: tab.tableid ?? tab.linktableid,
      linked_table: tab.linked_table
    }))
    .filter(item => item.tableid || item.linked_table);

  return {
    tab_table: tabTable,
    parent_child: parentChild,
    many_to_many: manyToMany
  };
}

function summarizeWindowBlueprint(
  windowid: string,
  cache: Record<string, unknown>,
  tableById: Map<string, Record<string, unknown>>,
  includeFields: boolean,
  includeRaw: boolean
): Record<string, unknown> {
  const decodedConfig = decodeZilcodeCachePayload(cache.configjson);
  const decodedLayout = decodeZilcodeCachePayload(cache.layoutjson);
  const parsedConfig = decodedConfig.value;
  const parsedLayout = decodedLayout.value;
  const normalizedConfig = normalizeZilcodeWindowConfig(parsedConfig, tableById);
  const roots = [
    normalizedConfig,
    parsedConfig,
    asRecord(parsedConfig)?.data,
    asRecord(parsedConfig)?.result,
    parsedLayout,
    asRecord(parsedLayout)?.data,
    asRecord(parsedLayout)?.result,
    cache
  ];
  const windowRecords = getFirstConfigArray(roots, ["window", "windows", "win"]);
  const tabs = getFirstConfigArray(roots, ["tabs", "tab", "windowtabs", "wintabs"])
    .map(tab => summarizeBlueprintTab(tab, tableById));
  const fields = includeFields
    ? getFirstConfigArray(roots, ["fields", "field", "columns", "controls"])
      .map(summarizeBlueprintField)
    : [];
  const menuTools = getFirstConfigArray(roots, ["menutools", "menu_tools", "tools", "menus"])
    .map(tool => pickRecordFields(tool, ["id", "name", "text", "label", "command", "execname", "seqno"]));

  return {
    windowid,
    parsed_config: Boolean(normalizedConfig || parsedConfig),
    config_format: decodedConfig.format,
    layout_format: decodedLayout.format,
    label: getRecordLabel(windowRecords[0] ?? cache, WINDOW_LABEL_KEYS, windowid),
    window: windowRecords[0] ? pickRecordFields(windowRecords[0], [
      "windowid",
      "windowname",
      "title",
      "description",
      "defaulttabid",
      "width",
      "height"
    ]) : undefined,
    tabs_count: tabs.length,
    tabs,
    fields_count: fields.length,
    fields: includeFields ? fields : undefined,
    menu_tools_count: menuTools.length,
    menu_tools: menuTools.length ? menuTools : undefined,
    relations: buildTabRelations(tabs),
    raw: includeRaw ? {
      cache,
      parsed_config: parsedConfig,
      parsed_layout: parsedLayout
    } : undefined,
    warning: normalizedConfig || parsedConfig
      ? undefined
      : `Không parse được configjson. Lỗi: ${decodedConfig.error ?? "unknown"}`
  };
}

interface SystemGraphNode {
  id: string;
  type: string;
  label: string;
  appid?: string;
  counts?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  detail_available?: boolean;
}

interface SystemGraphEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

interface SystemGraph {
  nodes: SystemGraphNode[];
  edges: SystemGraphEdge[];
  node_counts: Record<string, number>;
  edge_count: number;
}

function graphIdPart(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim() || fallback;
  return text.replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 96) || fallback;
}

function graphNodeId(type: string, ...parts: unknown[]): string {
  return [type, ...parts.map((part, index) => graphIdPart(part, `node${index}`))].join(":");
}

function addGraphNode(nodes: Map<string, SystemGraphNode>, node: SystemGraphNode): void {
  const current = nodes.get(node.id);
  nodes.set(node.id, current ? { ...current, ...node, summary: { ...current.summary, ...node.summary } } : node);
}

function addGraphEdge(edges: Map<string, SystemGraphEdge>, edge: SystemGraphEdge): void {
  if (!edge.from || !edge.to || edge.from === edge.to) return;
  edges.set(`${edge.from}|${edge.type}|${edge.to}`, edge);
}

function rememberGraphLookup(map: Map<string, string>, appid: string, value: unknown, nodeId: string): void {
  if (value === undefined || value === null || value === "") return;
  map.set(`${appid}:${String(value)}`, nodeId);
}

function lookupGraphNode(map: Map<string, string>, appid: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return map.get(`${appid}:${String(value)}`);
}

function compactGraphSummary(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const key of keys) {
    const value = getCaseInsensitiveValue(record, key);
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") {
      summary[key] = value.length > 140 ? `${value.slice(0, 140)}...` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    }
  }

  const domainJson = getCaseInsensitiveValue(record, "domainjson");
  if (typeof domainJson === "string" && domainJson) {
    summary.domainjson_chars = domainJson.length;
  }

  return summary;
}

function finalizeSystemGraph(nodes: Map<string, SystemGraphNode>, edges: Map<string, SystemGraphEdge>): SystemGraph {
  const nodeList = [...nodes.values()];
  const nodeCounts: Record<string, number> = {};
  for (const node of nodeList) {
    nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
  }

  return {
    nodes: nodeList,
    edges: [...edges.values()],
    node_counts: nodeCounts,
    edge_count: edges.size
  };
}

function buildSystemGraphFromBlueprint(
  sessionSummary: Record<string, unknown>,
  appBlueprints: Record<string, unknown>[]
): SystemGraph {
  const nodes = new Map<string, SystemGraphNode>();
  const edges = new Map<string, SystemGraphEdge>();
  const tableLookup = new Map<string, string>();
  const domainLookup = new Map<string, string>();
  const tabLookup = new Map<string, string>();
  const sessionNodeId = "session:current";

  addGraphNode(nodes, {
    id: sessionNodeId,
    type: "session",
    label: "Phiên đăng nhập hiện tại",
    summary: {
      base_url: sessionSummary.base_url,
      roleid: sessionSummary.roleid,
      role_name: sessionSummary.role_name,
      orgid: sessionSummary.orgid,
      org_name: sessionSummary.org_name
    }
  });

  for (const app of appBlueprints) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;
    const appNodeId = graphNodeId("app", appid);

    addGraphNode(nodes, {
      id: appNodeId,
      type: "app",
      label: String(app.app_name ?? app.app_code ?? appid),
      appid,
      counts: asRecord(app.counts) ?? undefined,
      summary: {
        appid,
        app_name: app.app_name,
        app_code: app.app_code
      },
      detail_available: true
    });
    addGraphEdge(edges, { from: sessionNodeId, to: appNodeId, type: "session_has_app" });

    const tables = toArrayValues(app.tables).filter((table): table is Record<string, unknown> => Boolean(table) && typeof table === "object");
    tables.forEach((table, index) => {
      const tableKey = table.tableid ?? table.tablename ?? table.alias ?? index;
      const tableNodeId = graphNodeId("table", appid, tableKey);
      rememberGraphLookup(tableLookup, appid, table.tableid, tableNodeId);
      rememberGraphLookup(tableLookup, appid, table.tablename, tableNodeId);
      rememberGraphLookup(tableLookup, appid, table.alias, tableNodeId);

      addGraphNode(nodes, {
        id: tableNodeId,
        type: "table",
        label: String(table.alias ?? table.tablename ?? table.tableid ?? tableKey),
        appid,
        summary: compactGraphSummary(table, [
          "tableid",
          "tablename",
          "tabletype",
          "alias",
          "columnkey",
          "columncode",
          "columndisplay",
          "isreadonly",
          "isview"
        ]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: tableNodeId, type: "app_has_table" });
    });

    const domains = toArrayValues(app.domains).filter((domain): domain is Record<string, unknown> => Boolean(domain) && typeof domain === "object");
    domains.forEach((domain, index) => {
      const domainKey = domain.domainid ?? domain.domainname ?? domain.name ?? index;
      const domainNodeId = graphNodeId("domain", appid, domainKey);
      rememberGraphLookup(domainLookup, appid, domain.domainid, domainNodeId);
      rememberGraphLookup(domainLookup, appid, domain.domainname, domainNodeId);
      rememberGraphLookup(domainLookup, appid, domain.name, domainNodeId);

      addGraphNode(nodes, {
        id: domainNodeId,
        type: "domain",
        label: String(domain.name ?? domain.domainname ?? domain.domainid ?? domainKey),
        appid,
        summary: compactGraphSummary(domain, ["domainid", "domainname", "name", "description", "datatype", "controltype"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: domainNodeId, type: "app_has_domain" });
    });

    const menus = toArrayValues(app.menus).filter((menu): menu is Record<string, unknown> => Boolean(menu) && typeof menu === "object");
    menus.forEach((menu, index) => {
      const menuKey = menu.menuid ?? menu.menuname ?? menu.translate ?? index;
      const menuNodeId = graphNodeId("menu", appid, menuKey);
      const windowId = menu.linkwindowid ?? menu.windowid;

      addGraphNode(nodes, {
        id: menuNodeId,
        type: "menu",
        label: String(menu.translate ?? menu.menuname ?? menu.menuid ?? menuKey),
        appid,
        summary: compactGraphSummary(menu, ["menuid", "menuname", "translate", "parentid", "seqno", "linktype", "linkwindowid", "windowid"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: menuNodeId, type: "app_has_menu" });

      if (windowId !== undefined && windowId !== null && windowId !== "") {
        const windowNodeId = graphNodeId("window", windowId);
        addGraphNode(nodes, {
          id: windowNodeId,
          type: "window",
          label: String(windowId),
          appid,
          summary: { windowid: windowId },
          detail_available: true
        });
        addGraphEdge(edges, { from: menuNodeId, to: windowNodeId, type: "menu_links_window" });
      }
    });

    const relates = toArrayValues(app.relates).filter((relation): relation is Record<string, unknown> => Boolean(relation) && typeof relation === "object");
    relates.forEach((relation, index) => {
      const relationKey = relation.relateid ?? relation.relatename ?? index;
      const relationNodeId = graphNodeId("relation", appid, relationKey);

      addGraphNode(nodes, {
        id: relationNodeId,
        type: "relation",
        label: String(relation.relatename ?? relation.relateid ?? relationKey),
        appid,
        summary: compactGraphSummary(relation, ["relateid", "relatename", "parenttableid", "childtableid", "parentfield", "childfield", "relatetype", "description"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: relationNodeId, type: "app_has_relation" });

      const parentTableNodeId = lookupGraphNode(tableLookup, appid, relation.parenttableid);
      const childTableNodeId = lookupGraphNode(tableLookup, appid, relation.childtableid);
      if (parentTableNodeId) addGraphEdge(edges, { from: relationNodeId, to: parentTableNodeId, type: "relation_parent_table" });
      if (childTableNodeId) addGraphEdge(edges, { from: relationNodeId, to: childTableNodeId, type: "relation_child_table" });
    });

    const windows = toArrayValues(app.windows).filter((window): window is Record<string, unknown> => Boolean(window) && typeof window === "object");
    for (const window of windows) {
      const windowid = String(window.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      addGraphNode(nodes, {
        id: windowNodeId,
        type: "window",
        label: String(window.label ?? windowid),
        appid,
        counts: {
          tabs: window.tabs_count,
          fields: window.fields_count,
          menu_tools: window.menu_tools_count
        },
        summary: compactGraphSummary(window, ["windowid", "label", "parsed_config", "warning"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: windowNodeId, type: "app_has_window" });

      const tabs = toArrayValues(window.tabs).filter((tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === "object");
      tabs.forEach((tab, index) => {
        const tabKey = tab.tabid ?? tab.tabname ?? tab.label ?? index;
        const tabNodeId = graphNodeId("tab", windowid, tabKey);
        rememberGraphLookup(tabLookup, windowid, tab.tabid, tabNodeId);

        addGraphNode(nodes, {
          id: tabNodeId,
          type: "tab",
          label: String(tab.label ?? tab.tabname ?? tab.tabid ?? tabKey),
          appid,
          summary: compactGraphSummary(tab, [
            "tabid",
            "tabname",
            "label",
            "parenttabid",
            "tablevel",
            "tableid",
            "linktableid",
            "linkchildfield",
            "linkparentfield",
            "relatetableid",
            "relatechildfield",
            "relateparentfield",
            "workflowid",
            "isviewonly",
            "noinsert",
            "noupdate",
            "nodelete",
            "noselect",
            "noexport",
            "seqno"
          ]),
          detail_available: true
        });
        addGraphEdge(edges, { from: windowNodeId, to: tabNodeId, type: "window_has_tab" });

        const tableId = tab.tableid ?? tab.linktableid ?? asRecord(tab.linked_table)?.tableid;
        const tableNodeId = lookupGraphNode(tableLookup, appid, tableId);
        if (tableNodeId) {
          addGraphEdge(edges, {
            from: tabNodeId,
            to: tableNodeId,
            type: "tab_uses_table",
            metadata: compactGraphSummary(tab, ["linkchildfield", "linkparentfield"])
          });
        }
      });

      tabs.forEach(tab => {
        const tabKey = tab.tabid ?? tab.tabname ?? tab.label;
        const tabNodeId = tabKey === undefined ? undefined : graphNodeId("tab", windowid, tabKey);
        const parentNodeId = lookupGraphNode(tabLookup, windowid, tab.parenttabid);
        if (tabNodeId && parentNodeId) {
          addGraphEdge(edges, {
            from: parentNodeId,
            to: tabNodeId,
            type: "tab_parent_child",
            metadata: compactGraphSummary(tab, ["linkchildfield", "linkparentfield"])
          });
        }

        const relationTableNodeId = lookupGraphNode(tableLookup, appid, tab.relatetableid);
        if (tabNodeId && relationTableNodeId) {
          addGraphEdge(edges, {
            from: tabNodeId,
            to: relationTableNodeId,
            type: "tab_many_to_many_table",
            metadata: compactGraphSummary(tab, ["relatechildfield", "relateparentfield"])
          });
        }
      });

      const fields = toArrayValues(window.fields).filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === "object");
      fields.forEach((field, index) => {
        const fieldKey = field.fieldid ?? field.columnname ?? field.fieldname ?? index;
        const fieldNodeId = graphNodeId("field", windowid, fieldKey);
        const fieldTabNodeId = lookupGraphNode(tabLookup, windowid, field.tabid);

        addGraphNode(nodes, {
          id: fieldNodeId,
          type: "field",
          label: String(field.label ?? field.caption ?? field.columnname ?? field.fieldname ?? fieldKey),
          appid,
          summary: compactGraphSummary(field, [
            "fieldid",
            "fieldname",
            "columnname",
            "tablename",
            "tableid",
            "tabid",
            "caption",
            "label",
            "datatype",
            "controltype",
            "fieldtype",
            "columntype",
            "domainid",
            "defaultvalue",
            "isrequired",
            "isrequire",
            "isreadonly",
            "isvisible",
            "hideingrid",
            "hideinform",
            "hideinfind",
            "isprimarykey",
            "seqno"
          ]),
          detail_available: true
        });
        addGraphEdge(edges, { from: fieldTabNodeId ?? windowNodeId, to: fieldNodeId, type: fieldTabNodeId ? "tab_has_field" : "window_has_field" });

        const domainNodeId = lookupGraphNode(domainLookup, appid, field.domainid);
        if (domainNodeId) addGraphEdge(edges, { from: fieldNodeId, to: domainNodeId, type: "field_uses_domain" });
      });
    }

    const windowErrors = toArrayValues(app.window_errors).filter((error): error is Record<string, unknown> => Boolean(error) && typeof error === "object");
    for (const error of windowErrors) {
      const windowid = String(error.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      addGraphNode(nodes, {
        id: windowNodeId,
        type: "window",
        label: windowid,
        appid,
        summary: { windowid, error: error.error },
        detail_available: false
      });
      addGraphEdge(edges, { from: appNodeId, to: windowNodeId, type: "app_has_window_error" });
    }
  }

  return finalizeSystemGraph(nodes, edges);
}

function filterGraphByNeighborhood(graph: SystemGraph, nodeIds: string[], depth: number): SystemGraph {
  if (nodeIds.length === 0) return graph;

  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  const queue = nodeIds
    .filter(id => graph.nodes.some(node => node.id === id))
    .map(id => ({ id, level: 0 }));

  for (const item of queue) visited.add(item.id);

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.level >= depth) continue;
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, level: current.level + 1 });
    }
  }

  const nodes = graph.nodes.filter(node => visited.has(node.id));
  const edges = graph.edges.filter(edge => visited.has(edge.from) && visited.has(edge.to));
  return finalizeSystemGraph(new Map(nodes.map(node => [node.id, node])), new Map(edges.map(edge => [`${edge.from}|${edge.type}|${edge.to}`, edge])));
}

function cleanDetailRecord(record: Record<string, unknown>, includeFields: boolean): Record<string, unknown> {
  const detail: Record<string, unknown> = { ...record };
  delete detail.raw_metadata;
  delete detail.raw;

  if (!includeFields && Array.isArray(detail.windows)) {
    detail.windows = detail.windows
      .filter((window): window is Record<string, unknown> => Boolean(window) && typeof window === "object")
      .map(window => {
        const copy: Record<string, unknown> = { ...window };
        delete copy.fields;
        delete copy.raw;
        return copy;
      });
  }

  return detail;
}

function collectBlueprintDetails(
  appBlueprints: Record<string, unknown>[],
  nodeIds: string[],
  includeFields: boolean
): Record<string, unknown>[] {
  const selected = new Set(nodeIds);
  if (selected.size === 0) return [];

  const details: Record<string, unknown>[] = [];

  for (const app of appBlueprints) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;
    const appNodeId = graphNodeId("app", appid);
    if (selected.has(appNodeId)) {
      details.push({ node_id: appNodeId, type: "app", data: cleanDetailRecord(app, includeFields) });
    }

    for (const [index, table] of toArrayValues(app.tables).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const tableNodeId = graphNodeId("table", appid, table.tableid ?? table.tablename ?? table.alias ?? index);
      if (selected.has(tableNodeId)) details.push({ node_id: tableNodeId, type: "table", data: table });
    }

    for (const [index, menu] of toArrayValues(app.menus).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const menuNodeId = graphNodeId("menu", appid, menu.menuid ?? menu.menuname ?? menu.translate ?? index);
      if (selected.has(menuNodeId)) details.push({ node_id: menuNodeId, type: "menu", data: menu });
    }

    for (const [index, domain] of toArrayValues(app.domains).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const domainNodeId = graphNodeId("domain", appid, domain.domainid ?? domain.domainname ?? domain.name ?? index);
      if (selected.has(domainNodeId)) details.push({ node_id: domainNodeId, type: "domain", data: domain });
    }

    for (const [index, relation] of toArrayValues(app.relates).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const relationNodeId = graphNodeId("relation", appid, relation.relateid ?? relation.relatename ?? index);
      if (selected.has(relationNodeId)) details.push({ node_id: relationNodeId, type: "relation", data: relation });
    }

    for (const window of toArrayValues(app.windows).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")) {
      const windowid = String(window.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      if (selected.has(windowNodeId)) details.push({ node_id: windowNodeId, type: "window", data: cleanDetailRecord(window, includeFields) });

      for (const [index, tab] of toArrayValues(window.tabs).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
        const tabNodeId = graphNodeId("tab", windowid, tab.tabid ?? tab.tabname ?? tab.label ?? index);
        if (selected.has(tabNodeId)) details.push({ node_id: tabNodeId, type: "tab", data: tab });
      }

      if (includeFields) {
        for (const [index, field] of toArrayValues(window.fields).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
          const fieldNodeId = graphNodeId("field", windowid, field.fieldid ?? field.columnname ?? field.fieldname ?? index);
          if (selected.has(fieldNodeId)) details.push({ node_id: fieldNodeId, type: "field", data: field });
        }
      }
    }
  }

  return details;
}

function buildOverviewExamples(
  records: unknown,
  keys: string[],
  limit: number
): Record<string, unknown>[] {
  return toArrayValues(records)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, limit)
    .map(record => compactGraphSummary(record, keys));
}

function buildSystemOverview(
  sessionSummary: Record<string, unknown>,
  appBlueprints: Record<string, unknown>[],
  graph: SystemGraph,
  errors: Record<string, unknown>[]
): Record<string, unknown> {
  const user = asRecord(sessionSummary.user);
  const apps = appBlueprints.map(app => ({
    appid: app.appid,
    app_name: app.app_name,
    app_code: app.app_code,
    counts: app.counts,
    examples: {
      tables: buildOverviewExamples(app.tables, ["tableid", "tablename", "alias", "tabletype", "columnkey", "columndisplay"], 8),
      menus: buildOverviewExamples(app.menus, ["menuid", "menuname", "translate", "linkwindowid", "parentid"], 6),
      windows: buildOverviewExamples(app.windows, ["windowid", "label", "tabs_count", "fields_count", "warning"], 6),
      domains: buildOverviewExamples(app.domains, ["domainid", "domainname", "name", "datatype", "controltype"], 6),
      relations: buildOverviewExamples(app.relates, ["relateid", "relatename", "parenttableid", "childtableid", "parentfield", "childfield"], 6)
    }
  }));

  return {
    intent: "Tóm tắt thân thiện cho người dùng về hệ thống Zilcode hiện tại; không cần liệt kê toàn bộ node khi người dùng chỉ hỏi tổng quan.",
    session: {
      base_url: sessionSummary.base_url,
      user: user ? pickRecordFields(user, ["userid", "username", "fullname", "email", "siteid", "sitecode", "sitename"]) : undefined,
      roleid: sessionSummary.roleid,
      role_name: sessionSummary.role_name,
      orgid: sessionSummary.orgid,
      org_name: sessionSummary.org_name
    },
    totals: {
      apps: appBlueprints.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      node_counts: graph.node_counts,
      app_errors: errors.length,
      window_errors: appBlueprints.reduce((total, app) => total + toArrayValues(app.window_errors).length, 0)
    },
    apps,
    reading_notes: [
      "Graph chỉ là bản đồ tổng quan để biết các thành phần và quan hệ chính.",
      "Khi cần chi tiết bảng/window/tab/field cụ thể, dùng node_id trong graph để lấy detail."
    ]
  };
}

async function buildZilcodeSystemBlueprint(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const mode = getBlueprintMode(args);
  const appidFilter = getStringArg(args, "appid");
  const includeFields = getOptionalBooleanArg(args, "include_fields", mode === "detail");
  const includeRaw = getOptionalBooleanArg(args, "include_raw", false);
  const maxApps = getLimitArg(args, "max_apps", 5, 100);
  const maxWindowsPerApp = getLimitArg(args, "max_windows_per_app", 20, 300);
  const nodeIds = getNodeIdsArg(args);
  const depth = getLimitArg(args, "depth", 1, 4);
  const apps = listSessionApplicationSummaries(session)
    .filter(app => !appidFilter || String(app.appid ?? "") === appidFilter)
    .slice(0, maxApps);
  const appBlueprints: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  for (const app of apps) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;

    try {
      const metadata = await fetchZilcodeAppMetadata(env, session, appid);
      const tables = toArrayValues(metadata.tables)
        .filter((table): table is Record<string, unknown> => Boolean(table) && typeof table === "object")
        .map(table => summarizeBlueprintTable(table, app));
      const tableById = new Map<string, Record<string, unknown>>();
      for (const table of tables) {
        const tableId = String(table.tableid ?? "");
        if (tableId) tableById.set(tableId, table);
      }

      const menus = toArrayValues(metadata.menus)
        .filter((menu): menu is Record<string, unknown> => Boolean(menu) && typeof menu === "object")
        .map(summarizeBlueprintMenu);
      const domains = toArrayValues(metadata.domains)
        .filter((domain): domain is Record<string, unknown> => Boolean(domain) && typeof domain === "object")
        .map(summarizeBlueprintDomain);
      const relates = toArrayValues(metadata.relates)
        .filter((relation): relation is Record<string, unknown> => Boolean(relation) && typeof relation === "object")
        .map(summarizeBlueprintRelation);
      const windowIds = extractWindowIdsFromAppMetadata(metadata).slice(0, maxWindowsPerApp);
      const windows: Record<string, unknown>[] = [];
      const windowErrors: Record<string, unknown>[] = [];

      for (const windowid of windowIds) {
        try {
          const cache = await fetchZilcodeWindowCache(env, session, windowid);
          windows.push(summarizeWindowBlueprint(windowid, cache, tableById, includeFields, includeRaw));
        } catch (error) {
          windowErrors.push({ windowid, error: getErrorText(error) });
        }
      }

      appBlueprints.push({
        appid,
        app_name: app.app_name,
        app_code: app.app_code,
        counts: {
          tables: tables.length,
          menus: menus.length,
          domains: domains.length,
          relates: relates.length,
          windows: windows.length,
          window_errors: windowErrors.length
        },
        tables,
        menus,
        domains,
        relates,
        windows,
        window_errors: windowErrors.length ? windowErrors : undefined,
        raw_metadata: includeRaw ? metadata : undefined
      });
    } catch (error) {
      errors.push({
        appid,
        app_name: app.app_name,
        error: getErrorText(error)
      });
    }
  }

  const sessionSummary = {
    base_url: session.base_url,
    user: stripSensitiveUserFields(session.user),
    roleid: session.roleid,
    role_name: getSelectedRoleName(session),
    orgid: session.orgid,
    org_name: getSelectedOrgName(session)
  };
  const graph = buildSystemGraphFromBlueprint(sessionSummary, appBlueprints);
  const focusedGraph = mode === "graph" ? graph : filterGraphByNeighborhood(graph, nodeIds, depth);
  const details = mode === "detail" || mode === "subgraph"
    ? collectBlueprintDetails(appBlueprints, nodeIds, includeFields)
    : [];
  const overview = buildSystemOverview(sessionSummary, appBlueprints, graph, errors);

  return {
    mode,
    session: sessionSummary,
    scan: {
      attempted_apps_count: apps.length,
      attempted_apps: apps.map(app => ({
        appid: app.appid,
        app_name: app.app_name,
        app_code: app.app_code
      }))
    },
    filters: {
      appid: appidFilter || undefined,
      node_ids: nodeIds.length ? nodeIds : undefined,
      depth: mode === "subgraph" ? depth : undefined,
      include_fields: includeFields,
      include_raw: includeRaw,
      max_apps: maxApps,
      max_windows_per_app: maxWindowsPerApp
    },
    apps_count: appBlueprints.length,
    overview,
    graph: focusedGraph,
    details_count: details.length || undefined,
    details: details.length ? details : undefined,
    errors: errors.length ? errors : undefined,
    note: apps.length === 0
      ? "Phiên hiện tại không có app nào hoặc appid không khớp. Hãy đăng nhập và chọn role/org role system trước."
      : mode === "graph"
        ? "Đây là graph compact. Nếu cần dữ liệu chi tiết, gọi lại tool với mode=subgraph hoặc mode=detail và node_id/node_ids từ graph.nodes."
        : details.length
          ? "Đã trả graph vùng liên quan và dữ liệu chi tiết cho node_id/node_ids đã chọn."
          : "Không tìm thấy detail cho node_id/node_ids đã truyền. Hãy dùng đúng id trong graph.nodes."
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


