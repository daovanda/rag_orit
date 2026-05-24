import {
  CHAT_MODEL,
  CHART_IMAGE_MODEL,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  EMBEDDING_MODEL,
  INTERNAL_CHAT_FALLBACK_MODEL,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_MESSAGES,
  QUERY_REWRITE_MODEL,
  RAG_MAX_CONTEXT_CHUNKS,
  RAG_MIN_SCORE,
  RAG_QUERY_REWRITE_MAX_TOKENS,
  RAG_RERANK_MAX_TOKENS,
  RAG_RERANK_TEXT_MAX_CHARS,
  RAG_VECTOR_DIMENSIONS,
  RAG_VECTOR_TOP_K,
  type Env
} from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { TOOLS } from "./tools";
import type { AIMessage, EmbeddingResult, GeneratedImage, RagCandidate, RagQueryDebug, RagSource, StoredChunk, ToolExecutionResult, VectorMatch } from "./types";

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
      description: getRuntimeToolDescription(String(tool.name), String(tool.description ?? "")),
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
        description: getRuntimeToolDescription(String(tool.name), String(tool.description ?? ""))
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

export async function runChatModel(
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

export async function embedQuery(
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

export async function generateChartImage(
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

export async function searchRag(
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
