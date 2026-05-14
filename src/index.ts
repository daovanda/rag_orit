// src/index.ts

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  ZILCODE_API_TOKEN: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_EMBEDDING_MODEL?: string;
}

// ─── Models ───────────────────────────────────────────────────────────────────

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const GENERAL_CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHART_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-dev";

const TOOL_SELECTION_MAX_TOKENS = 512;
const GENERAL_CHAT_MAX_TOKENS = 1024;
const RAG_FINAL_MAX_TOKENS = 2048;
const RAG_RERANK_MAX_TOKENS = 512;
const DEFAULT_CHART_WIDTH = 1024;
const DEFAULT_CHART_HEIGHT = 768;
const RAG_VECTOR_TOP_K = 10;
const RAG_MAX_CONTEXT_CHUNKS = 4;
const RAG_MIN_SCORE = 0.35;
const RAG_RERANK_TEXT_MAX_CHARS = 900;
const RAG_VECTOR_DIMENSIONS = 1024;

 // ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

async function runChatModel(
  cfModel: string,
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  try {
    const result = await env.AI.run(
      cfModel as string & {},
      request as unknown as Record<string, unknown>
    ) as ChatModelResponse;
    if (isCloudflareNeuronQuotaResult(result)) {
      console.log("[CHAT_MODEL] Cloudflare quota result, fallback sang OpenRouter");
      return callOpenRouterChat(request, env);
    }
    return result;
  } catch (error) {
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
      { text: [text] }
    ) as { data: number[][] };

    const vector = embeddingResult.data[0];
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

function extractJsonObject(text: string): Record<string, unknown> | null {
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

async function rerankRagCandidates(
  query: string,
  candidates: RagCandidate[],
  env: Env
): Promise<RagCandidate[]> {
  if (candidates.length === 0) return [];

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

  return ordered
    .slice(0, RAG_MAX_CONTEXT_CHUNKS)
    .map((candidate, index) => ({ ...candidate, rerank_rank: index + 1 }));
}

async function searchRag(
  query: string,
  env: Env
): Promise<ToolExecutionResult> {
  const embeddingResult = await embedQuery(query, env);
  const queryVector = embeddingResult.vector;

  const matches = await env.VECTORIZE.query(queryVector, {
    topK: RAG_VECTOR_TOP_K,
    returnMetadata: "all"
  });

  const vectorMatches = matches.matches as VectorMatch[];
  if (!vectorMatches.length) {
    return {
      content: "Không tìm thấy tài liệu liên quan.",
      embedding_debug: embeddingResult.debug
    };
  }

  const filteredMatches = vectorMatches.filter(match =>
    typeof match.score !== "number" || match.score >= RAG_MIN_SCORE
  );

  if (!filteredMatches.length) {
    return {
      content: `Không tìm thấy tài liệu đủ liên quan. Điểm liên quan cao nhất là ${formatScore(vectorMatches[0]?.score)}, thấp hơn ngưỡng ${RAG_MIN_SCORE}.`,
      embedding_debug: embeddingResult.debug
    };
  }

  const candidates: RagCandidate[] = [];
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

  if (!candidates.length) {
    return {
      content: "Không tìm thấy nội dung chunk tương ứng trong KV.",
      embedding_debug: embeddingResult.debug
    };
  }

  const reranked = await rerankRagCandidates(query, candidates, env);
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
    embedding_debug: embeddingResult.debug
  };
}

async function executeTool(
  tool: ToolCall,
  env: Env,
  screenContext?: ScreenContext
): Promise<ToolExecutionResult> {

  switch (tool.name) {

    case "general_chat": {
      const message = getStringArg(tool.arguments, "message");
      if (!message) return { content: "Lỗi: bắt buộc phải có tin nhắn để trả lời." };

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
          { role: "user", content: message }
        ]
      }, env);

      return { content: response.response ?? "Không tạo được câu trả lời." };
    }

    case "rag_search": {
      const query = getStringArg(tool.arguments, "query");
      if (!query) return { content: "Lỗi: bắt buộc phải có câu truy vấn." };
      return searchRag(query, env);
    }

    case "get_workflow": {
      const id = getStringArg(tool.arguments, "id");
      if (!id) return { content: "Lỗi: bắt buộc phải có ID workflow." };

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

interface ChatRequest {
  message: string;
  context?: ScreenContext;
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

async function createFinalAnswerFromRag(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env
): Promise<string> {
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
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Ngữ cảnh từ các công cụ:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  return cleanMarkdownArtifacts(response.response ?? "Không tạo được câu trả lời.");
}

async function runAgenticLoop(
  userMessage: string,
  env: Env,
  screenContext?: ScreenContext
): Promise<AgenticLoopResult> {

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
Với câu hỏi ngoài phạm vi Zilcode, hãy dùng general_chat.
Sau khi đã có đủ thông tin từ công cụ, hãy trả lời ngay thay vì tiếp tục gọi thêm công cụ. Nếu general_chat đã trả lời và chưa dùng rag_search, hãy dùng nội dung đó làm cơ sở cho câu trả lời cuối cùng.
Khi đã dùng rag_search và có kết quả, không gọi general_chat để hỏi lại kiến thức chung; hãy tổng hợp câu trả lời từ kết quả rag_search.
Khi đã dùng rag_search nhưng không tìm thấy thông tin phù hợp, hãy nói rõ là chưa tìm thấy trong tài liệu hiện có thay vì bịa nội dung.
Trả lời đúng mức chi tiết theo yêu cầu của người dùng, cụ thể và ưu tiên các bước thao tác rõ ràng.`
    },
    {
      role: "user",
      content: userMessage
    }
  ];

  const toolsCalled: string[] = [];
  const toolResults: ToolResultRecord[] = [];
  const ragSources: RagSource[] = [];
  let embeddingDebug: EmbeddingDebug | undefined;
  let hasRagSearchResult = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[VÒNG LẶP] Lần ${i + 1}`);

    const response = await runChatModel(CHAT_MODEL, {
      max_tokens: TOOL_SELECTION_MAX_TOKENS,
      messages,
      tools: TOOLS
    }, env);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`[VÒNG LẶP] Không có tool call, trả về câu trả lời cuối cùng`);
      return {
        answer: response.response ?? "Không tạo được câu trả lời.",
        toolsCalled
      };
    }

    const hasRagSearchCall = response.tool_calls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? response.tool_calls.filter(toolCall => toolCall.name !== "general_chat")
      : response.tool_calls;

    let generalChatResult: string | null = null;

    for (const toolCall of toolCallsToExecute) {
      console.log(`[CÔNG CỤ] Gọi: ${toolCall.name}`, toolCall.arguments);
      toolsCalled.push(toolCall.name);

      if (toolCall.name === "draw_chart") {
        const image = await generateChartImage(toolCall.arguments, env);
        return {
          answer: "Mình đã tạo biểu đồ theo yêu cầu. Lưu ý: ảnh do mô hình tạo sinh phù hợp để minh họa, không nên dùng làm biểu đồ số liệu cần độ chính xác tuyệt đối.",
          toolsCalled,
          images: [image]
        };
      }

      const toolExecution = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        screenContext
      );
      const toolResult = toolExecution.content;

      console.log(`[CÔNG CỤ] Độ dài kết quả: ${toolResult.length} ký tự`);
      toolResults.push({ name: toolCall.name, content: toolResult });

      if (toolCall.name === "rag_search" && toolExecution.sources?.length) {
        ragSources.push(...toolExecution.sources);
      }

      if (toolCall.name === "rag_search" && toolExecution.embedding_debug) {
        embeddingDebug = toolExecution.embedding_debug;
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
        env
      );

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug
      };
    }

    if (generalChatResult) {
      const finalResponse = await runChatModel(CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Bạn là trợ lý AI hội thoại.
Hãy trả lời cuối cùng bằng cùng ngôn ngữ với người hỏi.
Dựa trên nội dung từ general_chat, trả lời tự nhiên và không nhắc đến tool/function nội bộ.`
          },
          { role: "user", content: userMessage },
          {
            role: "assistant",
            content: `Nội dung từ general_chat:\n${generalChatResult}`
          }
        ]
      }, env);

      return {
        answer: finalResponse.response ?? "Không tạo được câu trả lời.",
        toolsCalled
      };
    }
  }

  return {
    answer: "Đã đạt số vòng gọi công cụ tối đa nhưng chưa tạo được câu trả lời cuối cùng.",
    toolsCalled
  };
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
    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json() as ChatRequest;

        if (!body.message) {
          return Response.json(
            { success: false, error: "Bắt buộc phải có trường message." },
            { status: 400, headers: CORS }
          );
        }

        const { answer, toolsCalled, images, sources, embedding_debug } = await runAgenticLoop(
          body.message,
          env,
          body.context
        );

        return Response.json({
          success: true,
          response: answer,
          tools_called: toolsCalled,
          images,
          sources,
          embedding_debug
        }, { headers: CORS });

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