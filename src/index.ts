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

// â”€â”€â”€ Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CONTENT_CHARS = 1200;
const DEFAULT_ZILCODE_BASE = "https://dvnb.zilcode.vn";
const ZILCODE_SESSION_PREFIX = "zilcode_session:";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

 // â”€â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Zilcode-Session",
};

// â”€â”€â”€ Tool definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TOOLS = [
  {
    name: "general_chat",
    description:
      "Tra loi hoi thoai thong thuong bang kien thuc san co cua tro ly. Dung cho chao hoi, cam on, hoi tro ly la ai/co the lam gi, cau hoi ngoai Zilcode, hoac cau hoi kien thuc chung khong can tra cuu tai lieu Zilcode.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Tin nhan nguoi dung can tra loi truc tiep"
        }
      },
      required: ["message"]
    }
  },
  {
    name: "rag_search",
    description:
      "Tra cuu kho tai lieu Zilcode da ingest, gom tai lieu huong dan su dung, quan tri va doc/logic ve cach Zilcode hoat dong. Dung khi can giai thich tinh nang, huong dan thao tac, kien truc, API contract, domain model, window/tab/field config, hoac can kien thuc logic de goi tool Zilcode dung hon.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Cau truy van tim kiem tai lieu. Giu thuat ngu Zilcode quan trong va them ngu canh neu co."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "draw_chart",
    description:
      "Tao anh bieu do, so do, flowchart, timeline, mindmap, dashboard mockup hoac infographic bang model anh Flux. Dung khi nguoi dung yeu cau ve hoac tao hinh minh hoa truc quan.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Mo ta anh bieu do/so do can tao: loai bieu do, du lieu chinh, bo cuc, phong cach, mau sac va ngon ngu nhan neu co."
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
      "Read-only tool. Lay ban do tong hop he thong Zilcode cua phien dang nhap hien tai: applications, menus/windows, window cache/config, tabs, fields, tables, domains, relations va cac rang buoc app -> window -> tab -> table. Dung khi can hieu he thong that cua tai khoan role system de tu van tao app/window/tab/table hoac kiem tra cau truc dang co.",
    parameters: {
      type: "object",
      properties: {
        appid: {
          type: "string",
          description: "Optional appid. Bo trong de quet tat ca app trong phien hien tai."
        },
        include_fields: {
          type: "string",
          description: "true/false. Mac dinh true. Dat false neu chi can app/window/tab/table summary."
        },
        include_raw: {
          type: "string",
          description: "true/false. Mac dinh false. Chi bat true khi debug vi raw payload co the lon."
        },
        max_apps: {
          type: "string",
          description: "So app toi da can doc, mac dinh 20."
        },
        max_windows_per_app: {
          type: "string",
          description: "So window/cache toi da moi app, mac dinh 100."
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
    "Táº¡o áº£nh dáº¡ng biá»ƒu Ä‘á»“/sÆ¡ Ä‘á»“ sáº¡ch, dá»… Ä‘á»c, bá»‘ cá»¥c rÃµ rÃ ng.",
    "Phong cÃ¡ch: hiá»‡n Ä‘áº¡i, chuyÃªn nghiá»‡p, ná»n sÃ¡ng, mÃ u sáº¯c cÃ¢n báº±ng.",
    "Náº¿u cÃ³ chá»¯ trong áº£nh, dÃ¹ng tiáº¿ng Viá»‡t tá»± nhiÃªn vÃ  giá»¯ nhÃ£n ngáº¯n gá»n."
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
        content: `Káº¿t quáº£ cÃ´ng cá»¥${message.tool_call_id ? ` (${message.tool_call_id})` : ""}:\n${message.content}`
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

Bo sung sau ingest: rag_search cung co the tra cuu doc/logic/*.md. Dung no khi can hieu cach Zilcode hoat dong, domain model, REST API contract, runtime architecture, window/tab/field config, tool safety rules, hoac khi can lay kien thuc logic de chon/goi cac tool zilcode_ dung hon va ket hop voi du lieu that.`;
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
    throw new Error("Thiáº¿u OPENROUTER_API_KEY hoáº·c OPENROUTER_MODEL Ä‘á»ƒ fallback sang OpenRouter.");
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
    throw new Error(`OpenRouter API lá»—i ${response.status}: ${getErrorText(data)}`);
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
      console.log(`[CHAT_MODEL] ${cfModel} lá»—i ná»™i bá»™, fallback sang ${INTERNAL_CHAT_FALLBACK_MODEL}`);
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
    throw new Error("Thiáº¿u OPENROUTER_API_KEY vÃ  OPENROUTER_EMBEDDING_MODEL/OPENROUTER_MODEL Ä‘á»ƒ fallback embedding sang OpenRouter.");
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
    throw new Error(`OpenRouter Embeddings API lá»—i ${response.status}: ${getErrorText(data)}`);
  }

  const payload = data as {
    data?: Array<{
      embedding?: number[];
    }>;
  };
  const embedding = payload.data?.[0]?.embedding;

  if (!embedding?.length) {
    throw new Error("OpenRouter Embeddings API khÃ´ng tráº£ vá» embedding.");
  }

  if (embedding.length !== RAG_VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding OpenRouter cÃ³ ${embedding.length} chiá»u, nhÆ°ng Vectorize index hiá»‡n táº¡i cáº§n ${RAG_VECTOR_DIMENSIONS} chiá»u. Cáº§n dÃ¹ng embedding model há»— trá»£ dimensions=${RAG_VECTOR_DIMENSIONS} hoáº·c táº¡o láº¡i Vectorize index vÃ  ingest láº¡i.`
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
    throw new Error("Báº¯t buá»™c pháº£i cÃ³ prompt Ä‘á»ƒ táº¡o biá»ƒu Ä‘á»“.");
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
    throw new Error("KhÃ´ng táº¡o Ä‘Æ°á»£c multipart body cho yÃªu cáº§u táº¡o áº£nh.");
  }

  const response = await env.AI.run(CHART_IMAGE_MODEL, {
    multipart: {
      body,
      contentType
    }
  }) as { image?: string };

  if (!response.image) {
    throw new Error("MÃ´ hÃ¬nh áº£nh khÃ´ng tráº£ vá» dá»¯ liá»‡u image.");
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
  return typeof score === "number" ? score.toFixed(3) : "khÃ´ng cÃ³";
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
    /(^|\s)(nÃ³|Ä‘Ã³|nÃ y|kia)(\s|$)/u,
    /(^|\s)(cÃ¡i|pháº§n|má»¥c|chá»—|bÆ°á»›c|trang|mÃ n hÃ¬nh|module|chá»©c nÄƒng|tÃ­nh nÄƒng|workflow|node)\s+(Ä‘Ã³|nÃ y|kia)(\s|$)/u,
    /(^|\s)(á»Ÿ trÃªn|nhÆ° trÃªn|vá»«a rá»“i|vá»«a nÃ³i|ban nÃ£y|tiáº¿p theo|sau Ä‘Ã³)(\s|$)/u,
    /(^|\s)(cÃ²n|váº­y|tháº¿)\s+(thÃ¬|nÃ³|pháº§n|bÆ°á»›c|má»¥c|cÃ¡i)(\s|$)/u
  ];

  if (contextualPatterns.some(pattern => pattern.test(normalized))) {
    return "query cÃ³ Ä‘áº¡i tá»« hoáº·c tham chiáº¿u phá»¥ thuá»™c lá»‹ch sá»­ chat";
  }

  const genericQueries = [
    "lÃ  gÃ¬",
    "dÃ¹ng tháº¿ nÃ o",
    "sá»­ dá»¥ng tháº¿ nÃ o",
    "hÆ°á»›ng dáº«n tÃ´i",
    "lÃ m sao",
    "lÃ m tháº¿ nÃ o",
    "cÃ¡ch lÃ m",
    "tiáº¿p theo",
    "sá»­a lá»—i",
    "giáº£i thÃ­ch thÃªm",
    "nÃ³i rÃµ hÆ¡n"
  ];

  if (genericQueries.includes(normalized)) {
    return "query quÃ¡ ngáº¯n hoáº·c quÃ¡ chung, cáº§n lá»‹ch sá»­ Ä‘á»ƒ lÃ m rÃµ";
  }

  return null;
}

function formatHistoryForRewrite(chatHistory: AIMessage[]): string {
  return chatHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => {
      const role = message.role === "user" ? "NgÆ°á»i dÃ¹ng" : "Trá»£ lÃ½";
      return `${role}: ${normalizeSpaces(message.content).slice(0, MAX_HISTORY_CONTENT_CHARS)}`;
    })
    .join("\n");
}

function cleanRewrittenQuery(raw: string, fallback: string): string {
  const cleaned = normalizeSpaces(
    raw
      .replace(/```json|```/g, "")
      .replace(/^(truy váº¥n|query|rewritten query|cÃ¢u truy váº¥n)\s*[:ï¼š-]\s*/i, "")
  ).replace(/^["'â€œâ€]+|["'â€œâ€]+$/g, "").trim();

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
    addDebugStep(debugSteps, "rag.query_rewrite", "skip", chatHistory.length ? "Query Ä‘Ã£ Ä‘á»§ rÃµ, khÃ´ng cáº§n rewrite." : "KhÃ´ng cÃ³ history Ä‘á»ƒ rewrite.", {
      original_query: originalQuery,
      history_messages: chatHistory.length
    });

    return {
      query: originalQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: originalQuery,
        used: false,
        reason: chatHistory.length ? "query Ä‘Ã£ Ä‘á»§ rÃµ, khÃ´ng cáº§n rewrite" : "khÃ´ng cÃ³ history Ä‘á»ƒ rewrite"
      }
    };
  }

  try {
    addDebugStep(debugSteps, "rag.query_rewrite", "start", "Rewrite query mÆ¡ há»“ báº±ng history.", {
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
          content: `Báº¡n lÃ  bá»™ rewrite query cho há»‡ thá»‘ng RAG tÃ i liá»‡u Zilcode.
Nhiá»‡m vá»¥: dá»±a vÃ o lá»‹ch sá»­ há»™i thoáº¡i vÃ  cÃ¢u há»i hiá»‡n táº¡i, viáº¿t láº¡i thÃ nh má»™t truy váº¥n tÃ¬m kiáº¿m Ä‘á»™c láº­p, rÃµ nghÄ©a.
Chá»‰ tráº£ vá» Ä‘Ãºng má»™t cÃ¢u truy váº¥n, khÃ´ng giáº£i thÃ­ch, khÃ´ng markdown, khÃ´ng JSON.
Giá»¯ thuáº­t ngá»¯ Zilcode quan trá»ng nhÆ° App Builder, SQL Cloud, User, Role, Organization, Application, Window, Tab, Field, Workflow náº¿u cÃ³.
Náº¿u cÃ¢u há»i hiá»‡n táº¡i Ä‘Ã£ rÃµ sau khi xÃ©t lá»‹ch sá»­, váº«n viáº¿t láº¡i thÃ nh cÃ¢u truy váº¥n ngáº¯n gá»n vÃ  Ä‘áº§y Ä‘á»§ ngá»¯ cáº£nh.`
        },
        {
          role: "user",
          content: [
            "Lá»‹ch sá»­ há»™i thoáº¡i gáº§n nháº¥t:",
            formatHistoryForRewrite(chatHistory),
            "",
            `CÃ¢u há»i/query hiá»‡n táº¡i: ${originalQuery}`,
            "",
            "Truy váº¥n tÃ¬m kiáº¿m Ä‘á»™c láº­p cho tÃ i liá»‡u Zilcode:"
          ].join("\n")
        }
      ]
    }, env);

    const rewrittenQuery = cleanRewrittenQuery(response.response ?? "", originalQuery);
    const used = rewrittenQuery.toLowerCase() !== originalQuery.toLowerCase();

    addDebugStep(debugSteps, "rag.query_rewrite", "ok", used ? "ÄÃ£ rewrite query cho retrieval." : "Model giá»¯ nguyÃªn query gá»‘c.", {
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
    console.log(`[RAG_REWRITE] Lá»—i rewrite, dÃ¹ng query gá»‘c: ${getErrorText(error)}`);
    addDebugStep(debugSteps, "rag.query_rewrite", "error", "Rewrite lá»—i, fallback vá» query gá»‘c.", {
      original_query: originalQuery,
      error: getErrorText(error)
    });

    return {
      query: originalQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: originalQuery,
        used: false,
        reason: `rewrite lá»—i, dÃ¹ng query gá»‘c: ${getErrorText(error)}`,
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

  addDebugStep(debugSteps, "rag.rerank", "start", "Báº¯t Ä‘áº§u rerank cÃ¡c chunk tá»« Vectorize.", {
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
        content: `Báº¡n lÃ  bá»™ rerank tÃ i liá»‡u cho chatbot RAG Zilcode.
Nhiá»‡m vá»¥: xáº¿p háº¡ng cÃ¡c chunk theo má»©c liÃªn quan vá»›i cÃ¢u há»i ngÆ°á»i dÃ¹ng.
Æ¯u tiÃªn chunk tráº£ lá»i trá»±c tiáº¿p cÃ¢u há»i, Ä‘Ãºng Ä‘á»‘i tÆ°á»£ng ngÆ°á»i dÃ¹ng/quáº£n trá»‹, vÃ  cÃ³ ná»™i dung thao tÃ¡c cá»¥ thá»ƒ.
Chá»‰ tráº£ vá» JSON há»£p lá»‡, khÃ´ng giáº£i thÃ­ch thÃªm.
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
    addDebugStep(debugSteps, "rag.rerank", "skip", "Rerank khÃ´ng tráº£ JSON há»£p lá»‡, fallback theo Ä‘iá»ƒm Vectorize.", {
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

  addDebugStep(debugSteps, "rag.rerank", "ok", "ÄÃ£ chá»n cÃ¡c chunk tá»‘t nháº¥t sau rerank.", {
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
  addDebugStep(debugSteps, "rag.search", "start", "Báº¯t Ä‘áº§u RAG search.", {
    original_query: query,
    history_messages: chatHistory.length
  });

  const rewritten = await maybeRewriteRagQuery(query, chatHistory, env, debugSteps);
  const retrievalQuery = rewritten.query;

  addDebugStep(debugSteps, "rag.embedding", "start", "Embedding query dÃ¹ng cho retrieval.", {
    query: retrievalQuery,
    model: EMBEDDING_MODEL
  });

  const embeddingResult = await embedQuery(retrievalQuery, env);
  const queryVector = embeddingResult.vector;

  addDebugStep(debugSteps, "rag.embedding", "ok", "Embedding query hoÃ n táº¥t.", {
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
  addDebugStep(debugSteps, "rag.vectorize", "ok", "Vectorize tráº£ káº¿t quáº£.", {
    matches: vectorMatches.length,
    top_score: vectorMatches[0]?.score
  });

  if (!vectorMatches.length) {
    return {
      content: "KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u liÃªn quan.",
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const filteredMatches = vectorMatches.filter(match =>
    typeof match.score !== "number" || match.score >= RAG_MIN_SCORE
  );

  addDebugStep(debugSteps, "rag.filter", "ok", "Lá»c match theo ngÆ°á»¡ng score.", {
    before: vectorMatches.length,
    after: filteredMatches.length,
    min_score: RAG_MIN_SCORE
  });

  if (!filteredMatches.length) {
    return {
      content: `KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u Ä‘á»§ liÃªn quan. Äiá»ƒm liÃªn quan cao nháº¥t lÃ  ${formatScore(vectorMatches[0]?.score)}, tháº¥p hÆ¡n ngÆ°á»¡ng ${RAG_MIN_SCORE}.`,
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const candidates: RagCandidate[] = [];
  addDebugStep(debugSteps, "rag.kv", "start", "Láº¥y ná»™i dung chunk tá»« KV.", {
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

  addDebugStep(debugSteps, "rag.kv", "ok", "ÄÃ£ táº£i ná»™i dung chunk tá»« KV.", {
    loaded_chunks: candidates.length
  });

  if (!candidates.length) {
    return {
      content: "KhÃ´ng tÃ¬m tháº¥y ná»™i dung chunk tÆ°Æ¡ng á»©ng trong KV.",
      embedding_debug: embeddingResult.debug,
      rag_query_debug: rewritten.debug
    };
  }

  const reranked = await rerankRagCandidates(retrievalQuery, candidates, env, debugSteps);
  const content = reranked
    .map((candidate, index) => [
      `[Nguá»“n ${index + 1}: ${candidate.source_label}]`,
      `ID: ${candidate.id}`,
      `Äiá»ƒm Vectorize: ${formatScore(candidate.vector_score)}`,
      `Thá»© háº¡ng rerank: ${candidate.rerank_rank ?? index + 1}`,
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
    throw new Error(`Zilcode API lá»—i ${response.status} táº¡i ${endpoint}: ${getErrorText(data)}`);
  }

  return data as ZilcodeApiEnvelope<T>;
}

function assertZilcodeSuccess<T>(envelope: ZilcodeApiEnvelope<T>): T {
  if (envelope.success === false) {
    throw new Error(`Zilcode API tráº£ lá»—i: ${getErrorText(envelope.result ?? envelope.error)}`);
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

function noZilcodeSessionResult(): ToolExecutionResult {
  return {
    content: JSON.stringify({
      error: "ChÆ°a Ä‘Äƒng nháº­p Zilcode trong chatbot. HÃ£y Ä‘Äƒng nháº­p báº±ng form Zilcode á»Ÿ giao diá»‡n chat trÆ°á»›c khi dÃ¹ng tool Ä‘á»c dá»¯ liá»‡u Zilcode."
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
      if (!message) return { content: "Lá»—i: báº¯t buá»™c pháº£i cÃ³ tin nháº¯n Ä‘á»ƒ tráº£ lá»i." };

      addDebugStep(debugSteps, "tool.general_chat", "start", "Gá»i model chat thÆ°á»ng.", {
        model: GENERAL_CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const response = await runChatModel(GENERAL_CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Báº¡n lÃ  trá»£ lÃ½ há»™i thoáº¡i.
HÃ£y tráº£ lá»i trá»±c tiáº¿p báº±ng cÃ¹ng ngÃ´n ngá»¯ vá»›i ngÆ°á»i há»i, trá»« khi ngÆ°á»i há»i yÃªu cáº§u ngÃ´n ngá»¯ khÃ¡c.
Báº¡n cÃ³ thá»ƒ dÃ¹ng kiáº¿n thá»©c sáºµn cÃ³ Ä‘á»ƒ tráº£ lá»i cÃ¢u há»i chung.
Náº¿u ngÆ°á»i dÃ¹ng há»i báº¡n lÃ  ai, hÃ£y nÃ³i báº¡n lÃ  trá»£ lÃ½ AI cÃ³ thá»ƒ trÃ² chuyá»‡n thÃ´ng thÆ°á»ng vÃ  há»— trá»£ tra cá»©u thÃ´ng tin Zilcode khi cáº§n.
Tráº£ lá»i ngáº¯n gá»n, tá»± nhiÃªn, khÃ´ng nháº¯c Ä‘áº¿n function/tool ná»™i bá»™.`
          },
          ...chatHistory,
          { role: "user", content: message }
        ]
      }, env);

      addDebugStep(debugSteps, "tool.general_chat", "ok", "general_chat tráº£ káº¿t quáº£.", {
        response_chars: (response.response ?? "").length
      });

      return { content: response.response ?? "KhÃ´ng táº¡o Ä‘Æ°á»£c cÃ¢u tráº£ lá»i." };
    }

    case "rag_search": {
      const query = getStringArg(tool.arguments, "query");
      if (!query) return { content: "Lá»—i: báº¯t buá»™c pháº£i cÃ³ cÃ¢u truy váº¥n." };
      return searchRag(query, env, chatHistory, debugSteps);
    }

    case "zilcode_get_system_blueprint": {
      if (!zilcodeSession) return noZilcodeSessionResult();

      addDebugStep(debugSteps, "tool.zilcode_get_system_blueprint", "start", "Lay ban do tong hop he thong Zilcode.", {
        appid: getStringArg(tool.arguments, "appid") || undefined,
        include_fields: getOptionalBooleanArg(tool.arguments, "include_fields", true),
        include_raw: getOptionalBooleanArg(tool.arguments, "include_raw", false)
      });

      const blueprint = await buildZilcodeSystemBlueprint(env, zilcodeSession.session, tool.arguments);

      addDebugStep(debugSteps, "tool.zilcode_get_system_blueprint", "ok", "Da lay system blueprint.", {
        apps_count: blueprint.apps_count,
        errors: Array.isArray(blueprint.errors) ? blueprint.errors.length : 0
      });

      return { content: JSON.stringify(blueprint, null, 2) };
    }

    default:
      return { content: `KhÃ´ng nháº­n diá»‡n Ä‘Æ°á»£c cÃ´ng cá»¥: ${tool.name}` };
  }
}

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


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

// â”€â”€â”€ Agentic loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MAX_ITERATIONS = 6;
const AVAILABLE_TOOL_NAMES = new Set(TOOLS.map(tool => tool.name));

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
  addDebugStep(debugSteps, "rag.final_answer", "start", "Táº¡o cÃ¢u tráº£ lá»i cuá»‘i tá»« context RAG.", {
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
        content: `Báº¡n lÃ  trá»£ lÃ½ há»— trá»£ Zilcode.
HÃ£y tráº£ lá»i báº±ng cÃ¹ng ngÃ´n ngá»¯ vá»›i ngÆ°á»i há»i.
Dá»±a chá»§ yáº¿u vÃ o káº¿t quáº£ rag_search trong ngá»¯ cáº£nh Ä‘Æ°á»£c cung cáº¥p.
Náº¿u cÃ³ káº¿t quáº£ general_chat trong ngá»¯ cáº£nh, chá»‰ xem lÃ  thÃ´ng tin phá»¥; khÃ´ng dÃ¹ng nÃ³ Ä‘á»ƒ phá»§ Ä‘á»‹nh hoáº·c thay tháº¿ tÃ i liá»‡u Zilcode.
Náº¿u tÃ i liá»‡u khÃ´ng Ä‘á»§ thÃ´ng tin, hÃ£y nÃ³i rÃµ pháº§n nÃ o chÆ°a tÃ¬m tháº¥y trong tÃ i liá»‡u hiá»‡n cÃ³.
KhÃ´ng nháº¯c Ä‘áº¿n tool/function ná»™i bá»™.
TÃ i liá»‡u nguá»“n cÃ³ thá»ƒ chá»©a cÃº phÃ¡p Markdown nhÆ° ###, -, +, ** hoáº·c dáº¥u backtick. KhÃ´ng sao chÃ©p cÃ¡c kÃ½ tá»± Ä‘á»‹nh dáº¡ng Ä‘Ã³ vÃ o cÃ¢u tráº£ lá»i cuá»‘i; hÃ£y chuyá»ƒn thÃ nh vÄƒn báº£n sáº¡ch, tá»± nhiÃªn.
Tráº£ lá»i Ä‘Ãºng má»©c chi tiáº¿t theo yÃªu cáº§u cá»§a ngÆ°á»i dÃ¹ng. Náº¿u ngÆ°á»i dÃ¹ng yÃªu cáº§u chi tiáº¿t, hÃ£y chia thÃ nh cÃ¡c pháº§n/bÆ°á»›c rÃµ rÃ ng; náº¿u khÃ´ng yÃªu cáº§u chi tiáº¿t, hÃ£y tráº£ lá»i gá»n.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Ngá»¯ cáº£nh tá»« cÃ¡c cÃ´ng cá»¥:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "KhÃ´ng táº¡o Ä‘Æ°á»£c cÃ¢u tráº£ lá»i.");
  addDebugStep(debugSteps, "rag.final_answer", "ok", "ÄÃ£ táº¡o cÃ¢u tráº£ lá»i cuá»‘i tá»« RAG.", {
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

  addDebugStep(debugSteps, "agent.start", "start", "Báº¯t Ä‘áº§u agentic loop.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    tools: TOOLS.map(tool => tool.name)
  });

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Báº¡n lÃ  trá»£ lÃ½ AI há»™i thoáº¡i vÃ  trá»£ lÃ½ há»— trá»£ ná»n táº£ng Zilcode.
HÃ£y tráº£ lá»i báº±ng cÃ¹ng ngÃ´n ngá»¯ vá»›i ngÆ°á»i há»i. Náº¿u ngÆ°á»i há»i yÃªu cáº§u má»™t ngÃ´n ngá»¯ hoáº·c phong cÃ¡ch cá»¥ thá»ƒ, hÃ£y lÃ m theo yÃªu cáº§u Ä‘Ã³.
Báº¡n cÃ³ cÃ¡c cÃ´ng cá»¥ Ä‘á»ƒ xá»­ lÃ½ tá»«ng loáº¡i yÃªu cáº§u. HÃ£y chá»n cÃ´ng cá»¥ phÃ¹ há»£p nháº¥t thay vÃ¬ nÃ³i ráº±ng yÃªu cáº§u náº±m ngoÃ i pháº¡m vi cÃ´ng cá»¥.
DÃ¹ng general_chat cho chÃ o há»i, cáº£m Æ¡n, trÃ² chuyá»‡n thÃ´ng thÆ°á»ng, há»i báº¡n lÃ  ai/cÃ³ thá»ƒ lÃ m gÃ¬, há»i báº¡n cÃ³ tráº£ lá»i ngoÃ i Zilcode khÃ´ng, cÃ¢u há»i kiáº¿n thá»©c chung, hoáº·c cÃ¢u há»i khÃ´ng liÃªn quan Ä‘áº¿n Zilcode.
Chá»‰ dÃ¹ng rag_search khi cÃ¢u há»i cáº§n thÃ´ng tin cá»¥ thá»ƒ tá»« tÃ i liá»‡u Zilcode, vÃ­ dá»¥ tÃ­nh nÄƒng, khÃ¡i niá»‡m, hÆ°á»›ng dáº«n thao tÃ¡c, hoáº·c cÃ¡ch sá»­ dá»¥ng Zilcode.
Náº¿u Zilcode lÃ  chá»§ Ä‘á» chÃ­nh cáº§n giáº£i thÃ­ch, hoáº·c ngÆ°á»i dÃ¹ng há»i Zilcode lÃ  gÃ¬, tÃ­nh nÄƒng/cÃ¡ch dÃ¹ng/hÆ°á»›ng dáº«n thao tÃ¡c trong Zilcode, hÃ£y Æ°u tiÃªn rag_search thay vÃ¬ general_chat.
DÃ¹ng draw_chart khi ngÆ°á»i dÃ¹ng yÃªu cáº§u váº½/táº¡o áº£nh biá»ƒu Ä‘á»“, sÆ¡ Ä‘á»“, flowchart, timeline, mindmap, dashboard mockup hoáº·c infographic. Vá»›i biá»ƒu Ä‘á»“ cáº§n sá»‘ liá»‡u chÃ­nh xÃ¡c tuyá»‡t Ä‘á»‘i, hÃ£y nÃ³i ngáº¯n gá»n ráº±ng áº£nh AI chá»‰ mang tÃ­nh minh há»a vÃ  váº«n cÃ³ thá»ƒ táº¡o áº£nh náº¿u ngÆ°á»i dÃ¹ng muá»‘n.
Bo cong cu hien tai gom: general_chat, rag_search, draw_chart, zilcode_get_system_blueprint. Khi can doc he thong Zilcode that, dung zilcode_get_system_blueprint de lay mot lan ban do apps, windows, tabs, tables, domains, relations va rang buoc app -> window -> tab -> table.
Khi dÃ¹ng rag_search, thÆ°á»ng chá»‰ gá»i má»™t láº§n vá»›i query tá»•ng há»£p tá»‘t. Chá»‰ gá»i láº¡i náº¿u káº¿t quáº£ chÆ°a Ä‘á»§ vÃ  query má»›i khÃ¡c rÃµ rÃ ng vá» Ã½ Ä‘á»‹nh hoáº·c pháº¡m vi; khÃ´ng gá»i láº¡i cÃ¹ng query hoáº·c query tÆ°Æ¡ng Ä‘Æ°Æ¡ng.
Dung zilcode_get_system_blueprint khi nguoi dung hoi du lieu/cau truc he thong Zilcode that cua tai khoan dang dang nhap: app, window/menu, tab, table, domain, relation, field, quyen hoac cac rang buoc tao app. Neu chua dang nhap Zilcode, hay yeu cau nguoi dung dang nhap o giao dien chat truoc. Khong dung zilcode_get_system_blueprint cho chao hoi hoac kien thuc chung co the tra loi bang general_chat/RAG.
Vá»›i cÃ¢u há»i ngoÃ i pháº¡m vi Zilcode, hÃ£y dÃ¹ng general_chat.
Sau khi Ä‘Ã£ cÃ³ Ä‘á»§ thÃ´ng tin tá»« cÃ´ng cá»¥, hÃ£y tráº£ lá»i ngay thay vÃ¬ tiáº¿p tá»¥c gá»i thÃªm cÃ´ng cá»¥. Náº¿u general_chat Ä‘Ã£ tráº£ lá»i vÃ  chÆ°a dÃ¹ng rag_search, hÃ£y dÃ¹ng ná»™i dung Ä‘Ã³ lÃ m cÆ¡ sá»Ÿ cho cÃ¢u tráº£ lá»i cuá»‘i cÃ¹ng.
Khi Ä‘Ã£ dÃ¹ng rag_search vÃ  cÃ³ káº¿t quáº£, khÃ´ng gá»i general_chat Ä‘á»ƒ há»i láº¡i kiáº¿n thá»©c chung; hÃ£y tá»•ng há»£p cÃ¢u tráº£ lá»i tá»« káº¿t quáº£ rag_search.
Khi Ä‘Ã£ dÃ¹ng rag_search nhÆ°ng khÃ´ng tÃ¬m tháº¥y thÃ´ng tin phÃ¹ há»£p, hÃ£y nÃ³i rÃµ lÃ  chÆ°a tÃ¬m tháº¥y trong tÃ i liá»‡u hiá»‡n cÃ³ thay vÃ¬ bá»‹a ná»™i dung.
Tráº£ lá»i Ä‘Ãºng má»©c chi tiáº¿t theo yÃªu cáº§u cá»§a ngÆ°á»i dÃ¹ng, cá»¥ thá»ƒ vÃ  Æ°u tiÃªn cÃ¡c bÆ°á»›c thao tÃ¡c rÃµ rÃ ng.`
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
    console.log(`[VÃ’NG Láº¶P] Láº§n ${i + 1}`);
    addDebugStep(debugSteps, "agent.tool_selection", "start", "Model chá»n tool hoáº·c tráº£ lá»i trá»±c tiáº¿p.", {
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
      console.log(`[VÃ’NG Láº¶P] KhÃ´ng cÃ³ tool call, tráº£ vá» cÃ¢u tráº£ lá»i cuá»‘i cÃ¹ng`);
      addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model khÃ´ng gá»i tool, tráº£ lá»i trá»±c tiáº¿p.", {
        iteration: i + 1,
        response_chars: (response.response ?? "").length
      });

      return {
        answer: response.response ?? "KhÃ´ng táº¡o Ä‘Æ°á»£c cÃ¢u tráº£ lá»i.",
        toolsCalled
      };
    }

    const supportedToolCalls = response.tool_calls.filter(toolCall => AVAILABLE_TOOL_NAMES.has(toolCall.name));
    const skippedUnsupportedToolCalls = response.tool_calls
      .filter(toolCall => !AVAILABLE_TOOL_NAMES.has(toolCall.name))
      .map(toolCall => toolCall.name);

    if (!supportedToolCalls.length) {
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chon tool khong con duoc ho tro, bo qua tool call.", {
        iteration: i + 1,
        tool_calls: response.tool_calls.map(toolCall => toolCall.name),
        skipped_tool_calls: skippedUnsupportedToolCalls
      });

      return {
        answer: response.response ?? "Model Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân tool khÃƒÂ´ng cÃƒÂ²n Ã„â€˜Ã†Â°Ã¡Â»Â£c hÃ¡Â»â€” trÃ¡Â»Â£. HÃƒÂ£y thÃ¡Â»Â­ hÃ¡Â»Âi lÃ¡ÂºÂ¡i theo cÃƒÂ¡ch khÃƒÂ¡c.",
        toolsCalled
      };
    }

    const hasRagSearchCall = supportedToolCalls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? supportedToolCalls.filter(toolCall => toolCall.name !== "general_chat")
      : supportedToolCalls;

    addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model Ä‘Ã£ chá»n tool.", {
      iteration: i + 1,
      tool_calls: response.tool_calls.map(toolCall => toolCall.name),
      executed_tool_calls: toolCallsToExecute.map(toolCall => toolCall.name),
      skipped_tool_calls: skippedUnsupportedToolCalls,
      skipped_general_chat_because_rag: hasRagSearchCall && toolCallsToExecute.length !== supportedToolCalls.length
    });

    let generalChatResult: string | null = null;

    for (const toolCall of toolCallsToExecute) {
      console.log(`[CÃ”NG Cá»¤] Gá»i: ${toolCall.name}`, toolCall.arguments);
      toolsCalled.push(toolCall.name);
      addDebugStep(debugSteps, "tool.call", "start", `Gá»i tool ${toolCall.name}.`, {
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      if (toolCall.name === "draw_chart") {
        const image = await generateChartImage(toolCall.arguments, env);
        addDebugStep(debugSteps, "tool.draw_chart", "ok", "ÄÃ£ táº¡o áº£nh biá»ƒu Ä‘á»“.", {
          width: image.width,
          height: image.height,
          model: CHART_IMAGE_MODEL
        });

        return {
          answer: "MÃ¬nh Ä‘Ã£ táº¡o biá»ƒu Ä‘á»“ theo yÃªu cáº§u. LÆ°u Ã½: áº£nh do mÃ´ hÃ¬nh táº¡o sinh phÃ¹ há»£p Ä‘á»ƒ minh há»a, khÃ´ng nÃªn dÃ¹ng lÃ m biá»ƒu Ä‘á»“ sá»‘ liá»‡u cáº§n Ä‘á»™ chÃ­nh xÃ¡c tuyá»‡t Ä‘á»‘i.",
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

      console.log(`[CÃ”NG Cá»¤] Äá»™ dÃ i káº¿t quáº£: ${toolResult.length} kÃ½ tá»±`);
      addDebugStep(debugSteps, "tool.call", "ok", `Tool ${toolCall.name} Ä‘Ã£ tráº£ káº¿t quáº£.`, {
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
      addDebugStep(debugSteps, "general.final_answer", "start", "Táº¡o cÃ¢u tráº£ lá»i cuá»‘i tá»« general_chat.", {
        model: CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const finalResponse = await runChatModel(CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Báº¡n lÃ  trá»£ lÃ½ AI há»™i thoáº¡i.
HÃ£y tráº£ lá»i cuá»‘i cÃ¹ng báº±ng cÃ¹ng ngÃ´n ngá»¯ vá»›i ngÆ°á»i há»i.
Dá»±a trÃªn ná»™i dung tá»« general_chat, tráº£ lá»i tá»± nhiÃªn vÃ  khÃ´ng nháº¯c Ä‘áº¿n tool/function ná»™i bá»™.`
          },
          ...chatHistory,
          { role: "user", content: userMessage },
          {
            role: "assistant",
            content: `Ná»™i dung tá»« general_chat:\n${generalChatResult}`
          }
        ]
      }, env);

      addDebugStep(debugSteps, "general.final_answer", "ok", "ÄÃ£ táº¡o cÃ¢u tráº£ lá»i cuá»‘i tá»« general_chat.", {
        answer_chars: (finalResponse.response ?? "").length
      });

      return {
        answer: finalResponse.response ?? "KhÃ´ng táº¡o Ä‘Æ°á»£c cÃ¢u tráº£ lá»i.",
        toolsCalled
      };
    }
  }

  addDebugStep(debugSteps, "agent.stop", "error", "Äáº¡t sá»‘ vÃ²ng gá»i tool tá»‘i Ä‘a.", {
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
    answer: "ÄÃ£ Ä‘áº¡t sá»‘ vÃ²ng gá»i cÃ´ng cá»¥ tá»‘i Ä‘a nhÆ°ng chÆ°a táº¡o Ä‘Æ°á»£c cÃ¢u tráº£ lá»i cuá»‘i cÃ¹ng.",
    toolsCalled
  };
}

// â”€â”€â”€ Zilcode auth handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    return "KhÃ´ng chá»n tá»• chá»©c";
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
      "domainid",
      "defaultvalue",
      "isrequired",
      "isreadonly",
      "isvisible",
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
  const parsedConfig = tryParseJsonObject(cache.configjson);
  const parsedLayout = tryParseJsonObject(cache.layoutjson);
  const roots = [
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
    parsed_config: Boolean(parsedConfig),
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
    warning: parsedConfig ? undefined : "configjson khong parse duoc bang JSON.parse; co the dang o dang nen/format rieng cua Zilcode."
  };
}

async function buildZilcodeSystemBlueprint(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const appidFilter = getStringArg(args, "appid");
  const includeFields = getOptionalBooleanArg(args, "include_fields", true);
  const includeRaw = getOptionalBooleanArg(args, "include_raw", false);
  const maxApps = getLimitArg(args, "max_apps", 20, 100);
  const maxWindowsPerApp = getLimitArg(args, "max_windows_per_app", 100, 300);
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

  return {
    session: {
      base_url: session.base_url,
      user: stripSensitiveUserFields(session.user),
      roleid: session.roleid,
      role_name: getSelectedRoleName(session),
      orgid: session.orgid,
      org_name: getSelectedOrgName(session)
    },
    filters: {
      appid: appidFilter || undefined,
      include_fields: includeFields,
      include_raw: includeRaw,
      max_apps: maxApps,
      max_windows_per_app: maxWindowsPerApp
    },
    apps_count: appBlueprints.length,
    apps: appBlueprints,
    errors: errors.length ? errors : undefined,
    note: apps.length === 0
      ? "Phien hien tai khong co app nao hoac appid khong khop. Hay dang nhap va chon role/org role system truoc."
      : "Blueprint la ban do read-only de agent hieu cau truc he thong. Neu window config khong parse duoc, can bo sung parser format config cua Zilcode."
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
      { success: false, error: "Báº¯t buá»™c pháº£i cÃ³ username, sitecode vÃ  password." },
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
    throw new Error("Zilcode login thÃ nh cÃ´ng nhÆ°ng response khÃ´ng cÃ³ token.");
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
      { success: false, error: "ChÆ°a cÃ³ phiÃªn Zilcode hoáº·c phiÃªn Ä‘Ã£ háº¿t háº¡n." },
      { status: 401, headers: CORS }
    );
  }

  const body = await request.json() as {
    roleid?: string | number;
    orgid?: string | number;
  };

  if (body.roleid === undefined || body.roleid === "") {
    return Response.json(
      { success: false, error: "Báº¯t buá»™c pháº£i cÃ³ roleid." },
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

// â”€â”€â”€ Worker handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    const url = new URL(request.url);

    // â”€â”€ OPTIONS â€” CORS preflight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // â”€â”€ GET / â€” health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/") {
      return Response.json({
        success: true,
        message: "Workers AI Ä‘ang cháº¡y",
        tools: TOOLS.map(t => t.name)
      }, { headers: CORS });
    }

    // â”€â”€ POST /chat â€” agentic chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/auth/login" && request.method === "POST") {
      try {
        return await handleZilcodeLogin(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lá»—i Ä‘Äƒng nháº­p Zilcode." },
          { status: 500, headers: CORS }
        );
      }
    }

    if (url.pathname === "/auth/select-role-org" && request.method === "POST") {
      try {
        return await handleZilcodeSelectRoleOrg(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lá»—i chá»n role/org Zilcode." },
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
            { success: false, error: "Báº¯t buá»™c pháº£i cÃ³ trÆ°á»ng message." },
            { status: 400, headers: CORS }
          );
        }

        const debugEnabled = body.debug === true;
        debugSteps = debugEnabled ? [] as DebugStep[] : undefined;
        const zilcodeSession = await loadZilcodeSession(request, env);

        addDebugStep(debugSteps, "request.received", "ok", "Worker nháº­n request /chat.", {
          message_chars: body.message.length,
          raw_history_messages: Array.isArray(body.history) ? body.history.length : 0,
          has_zilcode_session: Boolean(zilcodeSession)
        });

        const chatHistory = sanitizeChatHistory(body.history);
        addDebugStep(debugSteps, "history.sanitized", "ok", "LÃ m sáº¡ch history trÆ°á»›c khi Ä‘Æ°a vÃ o model.", {
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

        addDebugStep(debugSteps, "response.ready", "ok", "Chuáº©n bá»‹ tráº£ response vá» client.", {
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
        addDebugStep(debugSteps, "response.error", "error", "Worker gáº·p lá»—i khi xá»­ lÃ½ /chat.", {
          error: error instanceof Error ? error.message : "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh"
        });

        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh",
            debug_steps: debugSteps
          },
          { status: 500, headers: CORS }
        );
      }
    }

    // â”€â”€ POST /embed â€” raw embedding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/embed" && request.method === "POST") {
      try {
        const body = await request.json() as { text?: string };

        if (!body.text) {
          return Response.json(
            { success: false, error: "Báº¯t buá»™c pháº£i cÃ³ trÆ°á»ng text." },
            { status: 400, headers: CORS }
          );
        }

        const embedding = await env.AI.run(EMBEDDING_MODEL, { text: body.text });
        return Response.json({ success: true, embedding }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh"
          },
          { status: 500, headers: CORS }
        );
      }
    }

    return new Response("KhÃ´ng tÃ¬m tháº¥y", { status: 404, headers: CORS });
  }
};


