import {
  CHAT_MODEL,
  DEFAULT_MODEL_PROVIDER,
  EMBEDDING_MODEL,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_MESSAGES,
  NVIDIA_DEFAULT_BASE_URL,
  NVIDIA_DEFAULT_CHAT_MODEL,
  QUERY_REWRITE_MODEL,
  RAG_MAX_BATCH_QUERIES,
  RAG_MAX_CONTEXT_CHUNKS,
  RAG_MAX_VISIBLE_SOURCES,
  RAG_MIN_SCORE,
  RAG_QUERY_REWRITE_MAX_TOKENS,
  RAG_RERANK_MAX_TOKENS,
  RAG_RERANK_TEXT_MAX_CHARS,
  RAG_VECTOR_TOP_K,
  type Env,
  type ModelProvider
} from "./config";
import { RAG_KNOWLEDGE_SCOPE, RAG_TOOL_ROUTING_GUIDANCE } from "./rag-knowledge";
import { addDebugStep, type DebugStep } from "./debug";
import type { AIMessage, EmbeddingResult, RagCandidate, RagQueryDebug, RagSource, StoredChunk, ToolDefinition, ToolExecutionResult, VectorMatch } from "./types";

interface ChatModelRequest {
  messages: AIMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: readonly ToolDefinition[];
}

interface ChatModelResponse {
  response?: string;
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    id?: string;
  }>;
  model?: string;
}

type OpenAICompatibleRole = "system" | "user" | "assistant";

interface OpenAICompatibleMessage {
  role: OpenAICompatibleRole;
  content: string;
}

function getStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getModelProvider(env: Env): ModelProvider {
  const provider = String(env.MODEL_PROVIDER ?? DEFAULT_MODEL_PROVIDER).trim().toLowerCase();
  if (provider === "cloudflare" || provider === "cf") return "cloudflare";
  if (provider === "nvidia") return "nvidia";
  throw new Error(`MODEL_PROVIDER không được hỗ trợ: ${provider || "(empty)"}`);
}

function getNvidiaBaseUrl(env: Env): string {
  return String(env.NVIDIA_BASE_URL || NVIDIA_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getNvidiaChatModel(env: Env): string {
  return String(env.NVIDIA_CHAT_MODEL || NVIDIA_DEFAULT_CHAT_MODEL).trim() || NVIDIA_DEFAULT_CHAT_MODEL;
}

function getNvidiaStreamValue(env: Env): boolean {
  const value = String(env.NVIDIA_STREAM ?? "false").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export function getActiveChatModelDebugInfo(
  env: Env,
  requestedCloudflareModel = CHAT_MODEL
): { provider: ModelProvider; model: string; requested_model?: string } {
  const provider = getModelProvider(env);
  if (provider === "nvidia") {
    return {
      provider,
      model: getNvidiaChatModel(env),
      requested_model: requestedCloudflareModel
    };
  }

  return {
    provider,
    model: requestedCloudflareModel
  };
}

function truncateErrorBody(text: string, maxChars = 1200): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars)}...`;
}

function isCloudflareNeuronQuotaResult(result: unknown): boolean {
  const text = getErrorText(result).toLowerCase();
  return text.includes("4006")
    && (text.includes("daily free allocation") || text.includes("neurons"));
}

function getRuntimeToolDescription(name: string, description: string): string {
  if (name !== "rag_search") return description;

  return `${description}

${RAG_TOOL_ROUTING_GUIDANCE}`;
}

function buildOpenAICompatibleTools(request: ChatModelRequest): Record<string, unknown>[] | undefined {
  return request.tools?.map(tool => ({
    type: "function",
    function: {
      name: String(tool.name),
      description: getRuntimeToolDescription(String(tool.name), String(tool.description ?? "")),
      parameters: tool.parameters
    }
  }));
}

function buildCloudflareChatCompletionsRequest(request: ChatModelRequest): Record<string, unknown> {
  return {
    messages: request.messages.map(message => ({
      role: message.role,
      content: message.content ?? ""
    })),
    tools: buildOpenAICompatibleTools(request),
    tool_choice: request.tools ? "auto" : undefined,
    max_tokens: request.max_tokens,
    temperature: request.temperature
  };
}

function buildCloudflareChatRequest(_cfModel: string, request: ChatModelRequest): Record<string, unknown> {
  return buildCloudflareChatCompletionsRequest(request);
}

function appendOpenAICompatibleMessage(
  messages: OpenAICompatibleMessage[],
  role: OpenAICompatibleRole,
  content: string
): void {
  const cleanContent = content ?? "";
  const last = messages[messages.length - 1];
  if (last?.role === role) {
    last.content = [last.content, cleanContent].filter(Boolean).join("\n\n");
    return;
  }

  messages.push({ role, content: cleanContent });
}

function normalizeMessagesForNvidia(messages: AIMessage[]): OpenAICompatibleMessage[] {
  const systemMessages: string[] = [];
  const dialogueMessages: OpenAICompatibleMessage[] = [];

  for (const message of messages) {
    const content = message.content ?? "";
    if (message.role === "system") {
      systemMessages.push(content);
      continue;
    }

    if (message.role === "tool") {
      appendOpenAICompatibleMessage(
        dialogueMessages,
        "user",
        [
          `Kết quả công cụ ${message.tool_call_id ? `(${message.tool_call_id})` : ""}:`.trim(),
          content
        ].filter(Boolean).join("\n")
      );
      continue;
    }

    appendOpenAICompatibleMessage(
      dialogueMessages,
      message.role === "assistant" ? "assistant" : "user",
      content
    );
  }

  const normalized: OpenAICompatibleMessage[] = [];
  if (systemMessages.length) {
    normalized.push({
      role: "system",
      content: systemMessages.filter(Boolean).join("\n\n")
    });
  }
  normalized.push(...dialogueMessages);
  return normalized;
}

function buildNvidiaChatRequest(model: string, request: ChatModelRequest, env: Env): Record<string, unknown> {
  if (getNvidiaStreamValue(env)) {
    throw new Error("NVIDIA_STREAM=true chưa được hỗ trợ trong agent hiện tại. Hãy dùng NVIDIA_STREAM=false.");
  }

  return {
    model,
    messages: normalizeMessagesForNvidia(request.messages),
    tools: buildOpenAICompatibleTools(request),
    tool_choice: request.tools ? "auto" : undefined,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    stream: false
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    const text = value
      .map(part => {
        if (typeof part === "string") return part;
        const record = asObject(part);
        if (!record) return "";
        return extractTextContent(record.text)
          ?? extractTextContent(record.content)
          ?? extractTextContent(record.output_text)
          ?? "";
      })
      .filter(Boolean)
      .join("");
    return text || undefined;
  }

  const record = asObject(value);
  if (!record) return undefined;

  return extractTextContent(record.text)
    ?? extractTextContent(record.content)
    ?? extractTextContent(record.output_text)
    ?? extractTextContent(record.response);
}

function getRecordType(value: Record<string, unknown>): string {
  return typeof value.type === "string" ? value.type.toLowerCase() : "";
}

function extractResponsesMessageText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;

  const messageText = output
    .map(item => {
      const itemRecord = asObject(item);
      if (!itemRecord) return "";

      const type = getRecordType(itemRecord);
      if (type && type !== "message") return "";

      return extractTextContent(itemRecord.content)
        ?? extractTextContent(itemRecord.output_text)
        ?? extractTextContent(itemRecord.text)
        ?? "";
    })
    .filter(Boolean)
    .join("");

  if (messageText) return messageText;

  const directText = output
    .map(item => {
      const itemRecord = asObject(item);
      if (!itemRecord) return extractTextContent(item) ?? "";

      const type = getRecordType(itemRecord);
      if (["reasoning", "function_call", "tool_call"].includes(type)) return "";

      return extractTextContent(itemRecord.content)
        ?? extractTextContent(itemRecord.output_text)
        ?? extractTextContent(itemRecord.text)
        ?? "";
    })
    .filter(Boolean)
    .join("");

  return directText || undefined;
}

function extractOutputText(value: unknown): string | undefined {
  const record = asObject(value);
  if (!record) return undefined;

  const direct = extractTextContent(record.response)
    ?? extractTextContent(record.output_text)
    ?? extractTextContent(record.text);
  if (direct !== undefined) return direct;

  const responsesText = extractResponsesMessageText(record.output);
  if (responsesText) return responsesText;

  return undefined;
}

function normalizeCloudflareChatResponse(data: unknown): ChatModelResponse {
  const wrapped = asObject(data);
  const nestedResult = asObject(wrapped?.result);
  if (nestedResult) {
    const nested = normalizeCloudflareChatResponse(nestedResult);
    if (nested.response !== undefined || nested.tool_calls?.length) return nested;
  }

  const payload = data as {
    choices?: Array<{
      text?: string | null;
      message?: {
        content?: unknown;
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
  if (message !== undefined) {
    const toolCalls = message.tool_calls
      ?.map(toolCall => ({
        id: toolCall.id,
        name: toolCall.function?.name ?? "",
        arguments: parseToolArguments(toolCall.function?.arguments)
      }))
      .filter(toolCall => toolCall.name);

    return {
      response: extractTextContent(message.content) ?? undefined,
      tool_calls: toolCalls?.length ? toolCalls : undefined
    };
  }

  const choiceText = payload.choices?.[0]?.text;
  if (typeof choiceText === "string") return { response: choiceText };

  const directToolCalls = Array.isArray(wrapped?.tool_calls)
    ? wrapped.tool_calls
      .map(toolCall => {
        const record = asObject(toolCall);
        const fn = asObject(record?.function);
        const directName = typeof record?.name === "string" ? record.name : "";
        const functionName = typeof fn?.name === "string" ? fn.name : "";
        return {
          id: typeof record?.id === "string" ? record.id : undefined,
          name: functionName || directName,
          arguments: parseToolArguments(fn?.arguments ?? record?.arguments)
        };
      })
      .filter(toolCall => toolCall.name)
    : undefined;

  const directText = extractOutputText(data);
  if (directText !== undefined || directToolCalls?.length) {
    return {
      response: directText,
      tool_calls: directToolCalls?.length ? directToolCalls : undefined
    };
  }

  return {};
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

  return {
    ...normalizeCloudflareChatResponse(result),
    model: cfModel
  };
}

async function callNvidiaChatModel(
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  const apiKey = env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Thiếu NVIDIA_API_KEY. Hãy đặt secret/env NVIDIA_API_KEY trước khi dùng MODEL_PROVIDER=nvidia.");
  }

  const model = getNvidiaChatModel(env);
  const url = `${getNvidiaBaseUrl(env)}/chat/completions`;
  const payload = buildNvidiaChatRequest(model, request, env);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  let data: unknown = {};
  if (bodyText) {
    try {
      data = JSON.parse(bodyText) as unknown;
    } catch {
      data = { raw_response: bodyText };
    }
  }

  if (!response.ok) {
    throw new Error(`NVIDIA API lỗi ${response.status}: ${truncateErrorBody(bodyText || response.statusText)}`);
  }

  return {
    ...normalizeCloudflareChatResponse(data),
    model
  };
}

export async function runChatModel(
  cfModel: string,
  request: ChatModelRequest,
  env: Env
): Promise<ChatModelResponse> {
  const provider = getModelProvider(env);
  if (provider === "nvidia") {
    return callNvidiaChatModel(request, env);
  }

  return callCloudflareChatModel(cfModel, request, env);
}
export async function embedQuery(
  text: string,
  env: Env
): Promise<EmbeddingResult> {
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
  return [...candidates].sort((a, b) =>
    (b.fusion_score ?? b.vector_score ?? -Infinity)
    - (a.fusion_score ?? a.vector_score ?? -Infinity)
  );
}

function selectRagCandidatesByVectorScore(candidates: RagCandidate[]): RagCandidate[] {
  return sortByVectorScore(candidates)
    .slice(0, RAG_MAX_CONTEXT_CHUNKS)
    .map((candidate, index) => ({ ...candidate, rerank_rank: index + 1 }));
}

function shouldUseModelRerank(candidates: RagCandidate[]): boolean {
  return candidates.length > RAG_MAX_CONTEXT_CHUNKS;
}

interface FusedVectorMatch extends VectorMatch {
  fusion_score: number;
  matched_queries: number;
}

function normalizeRagQuery(query: string): string {
  return normalizeSpaces(query).toLocaleLowerCase("vi");
}

export function dedupeRagQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const query of queries) {
    const cleaned = normalizeSpaces(String(query || ""));
    const key = normalizeRagQuery(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
  }

  return deduped;
}

export function fuseVectorMatchSets(
  matchSets: VectorMatch[][],
  limit = RAG_VECTOR_TOP_K
): FusedVectorMatch[] {
  const byId = new Map<string, {
    id: string;
    best_score?: number;
    fusion_score: number;
    query_indexes: Set<number>;
  }>();
  const rrfConstant = 60;

  matchSets.forEach((matches, queryIndex) => {
    matches.forEach((match, rankIndex) => {
      if (!match?.id) return;
      const current = byId.get(match.id) ?? {
        id: match.id,
        best_score: undefined,
        fusion_score: 0,
        query_indexes: new Set<number>()
      };
      current.fusion_score += 1 / (rrfConstant + rankIndex + 1);
      current.query_indexes.add(queryIndex);
      if (typeof match.score === "number"
        && (current.best_score === undefined || match.score > current.best_score)) {
        current.best_score = match.score;
      }
      byId.set(match.id, current);
    });
  });

  return [...byId.values()]
    .sort((a, b) =>
      b.fusion_score - a.fusion_score
      || (b.best_score ?? -Infinity) - (a.best_score ?? -Infinity)
    )
    .slice(0, Math.max(1, limit))
    .map(item => ({
      id: item.id,
      score: item.best_score,
      fusion_score: item.fusion_score,
      matched_queries: item.query_indexes.size
    }));
}

export function mergeRagSources(
  current: RagSource[],
  incoming: RagSource[],
  limit = RAG_MAX_VISIBLE_SOURCES
): RagSource[] {
  const byId = new Map<string, RagSource>();

  for (const source of [...current, ...incoming]) {
    if (!source?.id) continue;
    const existing = byId.get(source.id);
    if (!existing) {
      byId.set(source.id, source);
      continue;
    }

    const sourceRank = source.rerank_rank ?? Number.MAX_SAFE_INTEGER;
    const existingRank = existing.rerank_rank ?? Number.MAX_SAFE_INTEGER;
    const sourceScore = source.vector_score ?? -Infinity;
    const existingScore = existing.vector_score ?? -Infinity;
    if (sourceRank < existingRank || (sourceRank === existingRank && sourceScore > existingScore)) {
      byId.set(source.id, source);
    }
  }

  return [...byId.values()]
    .sort((a, b) =>
      (a.rerank_rank ?? Number.MAX_SAFE_INTEGER) - (b.rerank_rank ?? Number.MAX_SAFE_INTEGER)
      || (b.vector_score ?? -Infinity) - (a.vector_score ?? -Infinity)
    )
    .slice(0, Math.max(1, limit));
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
    const modelDebug = getActiveChatModelDebugInfo(env, QUERY_REWRITE_MODEL);
    addDebugStep(debugSteps, "rag.query_rewrite", "start", "Rewrite query mơ hồ bằng history.", {
      ...modelDebug,
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
          content: `Bạn là bộ rewrite query cho hệ thống RAG tài liệu Zilcode và Phần mềm Quản lý Sản xuất Nhựa Đại Việt.
Nhiệm vụ: dựa vào lịch sử hội thoại và câu hỏi hiện tại, viết lại thành một truy vấn tìm kiếm độc lập, rõ nghĩa.
Chỉ trả về đúng một câu truy vấn, không giải thích, không markdown, không JSON.
Phạm vi corpus: ${RAG_KNOWLEDGE_SCOPE}.
Giữ nguyên tên sản phẩm, bộ phận, quy trình và thuật ngữ quan trọng như Đại Việt, App Builder, SQL Cloud, User, Role, Organization, Application, Window, Tab, Field, Workflow nếu có.
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
            "Truy vấn tìm kiếm độc lập cho corpus tài liệu:"
          ].join("\n")
        }
      ]
    }, env);

    const rewrittenQuery = cleanRewrittenQuery(response.response ?? "", originalQuery);
    const used = rewrittenQuery.toLowerCase() !== originalQuery.toLowerCase();

    addDebugStep(debugSteps, "rag.query_rewrite", "ok", used ? "Đã rewrite query cho retrieval." : "Model giữ nguyên query gốc.", {
      original_query: originalQuery,
      rewritten_query: rewrittenQuery,
      used,
      model: response.model
    });

    return {
      query: rewrittenQuery,
      debug: {
        original_query: originalQuery,
        rewritten_query: rewrittenQuery,
        used,
        reason,
        model: response.model ?? modelDebug.model
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
        model: getActiveChatModelDebugInfo(env, QUERY_REWRITE_MODEL).model
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

  const modelDebug = getActiveChatModelDebugInfo(env, CHAT_MODEL);
  addDebugStep(debugSteps, "rag.rerank", "start", "Bắt đầu rerank các chunk từ Vectorize.", {
    ...modelDebug,
    candidates: candidates.length,
    query
  });

  const rerankPayload = candidates.map(candidate => ({
    id: candidate.id,
    source: candidate.source_label,
    vector_score: candidate.vector_score,
    fusion_score: candidate.fusion_score,
    matched_queries: candidate.matched_queries,
    text: truncateForRerank(candidate.text)
  }));

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_RERANK_MAX_TOKENS,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn là bộ rerank tài liệu cho chatbot RAG Zilcode và Phần mềm Quản lý Sản xuất Nhựa Đại Việt.
Nhiệm vụ: xếp hạng các chunk theo mức liên quan với câu hỏi người dùng.
Ưu tiên chunk trả lời trực tiếp câu hỏi, đúng sản phẩm/phân hệ/bộ phận, đúng đối tượng người dùng/quản trị, và có nội dung thao tác cụ thể. Không ưu tiên tài liệu Zilcode chung khi câu hỏi đang hỏi quy trình Đại Việt và ngược lại.
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

    return selectRagCandidatesByVectorScore(candidates);
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
    selected_ids: selected.map(candidate => candidate.id),
    model: response.model
  });

  return selected;
}

export async function searchRag(
  query: string,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<ToolExecutionResult> {
  return searchRagQueries([query], env, chatHistory, debugSteps);
}

export async function searchRagQueries(
  inputQueries: string[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<ToolExecutionResult> {
  const queries = dedupeRagQueries(inputQueries).slice(0, RAG_MAX_BATCH_QUERIES);
  if (!queries.length) return { content: "Lỗi: bắt buộc phải có câu truy vấn." };

  addDebugStep(debugSteps, "rag.search", "start", "Bắt đầu RAG retrieval có fusion.", {
    original_queries: queries,
    query_count: queries.length,
    history_messages: chatHistory.length
  });

  const rewrittenResults = await Promise.all(
    queries.map(query => maybeRewriteRagQuery(query, chatHistory, env, debugSteps))
  );
  const retrievalQueries = dedupeRagQueries(rewrittenResults.map(result => result.query));

  addDebugStep(debugSteps, "rag.embedding", "start", "Embedding các query retrieval song song.", {
    queries: retrievalQueries,
    query_count: retrievalQueries.length,
    model: EMBEDDING_MODEL
  });

  const retrievalResults = await Promise.all(retrievalQueries.map(async retrievalQuery => {
    const embedding = await embedQuery(retrievalQuery, env);
    const matches = await env.VECTORIZE.query(embedding.vector, {
      topK: RAG_VECTOR_TOP_K,
      returnMetadata: "all"
    });
    return {
      query: retrievalQuery,
      embedding,
      matches: matches.matches as VectorMatch[]
    };
  }));
  const embeddingResult = retrievalResults[0]?.embedding;

  addDebugStep(debugSteps, "rag.embedding", "ok", "Embedding và Vectorize query hoàn tất.", {
    query_count: retrievalResults.length,
    provider: embeddingResult?.debug.provider,
    model: embeddingResult?.debug.model,
    dimensions: embeddingResult?.debug.dimensions,
    matches_per_query: retrievalResults.map(result => result.matches.length)
  });

  const filteredMatchSets = retrievalResults.map(result =>
    result.matches.filter(match =>
      typeof match.score !== "number" || match.score >= RAG_MIN_SCORE
    )
  );
  const fusedMatches = fuseVectorMatchSets(filteredMatchSets, RAG_VECTOR_TOP_K);

  addDebugStep(debugSteps, "rag.fusion", "ok", "Đã fusion và khử trùng ứng viên trước khi đọc KV.", {
    query_count: retrievalResults.length,
    raw_matches: retrievalResults.reduce((sum, result) => sum + result.matches.length, 0),
    filtered_matches: filteredMatchSets.reduce((sum, matches) => sum + matches.length, 0),
    unique_candidates: fusedMatches.length,
    candidate_limit: RAG_VECTOR_TOP_K
  });

  const primaryDebug: RagQueryDebug = {
    ...(rewrittenResults[0]?.debug ?? {
      original_query: queries[0],
      rewritten_query: retrievalQueries[0] ?? queries[0],
      used: false,
      reason: "query được dùng trực tiếp"
    }),
    batch_queries: rewrittenResults.map(result => result.debug)
  };

  if (!fusedMatches.length) {
    const scores = retrievalResults.flatMap(result =>
      result.matches
        .map(match => match.score)
        .filter((score): score is number => typeof score === "number")
    );
    const topScore = scores.length ? Math.max(...scores) : undefined;
    const detail = topScore !== undefined
      ? ` Điểm liên quan cao nhất là ${formatScore(topScore)}, thấp hơn ngưỡng ${RAG_MIN_SCORE}.`
      : "";
    return {
      content: `Không tìm thấy tài liệu đủ liên quan.${detail}`,
      embedding_debug: embeddingResult?.debug,
      rag_query_debug: primaryDebug
    };
  }

  addDebugStep(debugSteps, "rag.kv", "start", "Đọc song song các chunk duy nhất từ KV.", {
    requested_chunks: fusedMatches.length
  });

  const chunkResults = await Promise.all(fusedMatches.map(async (match): Promise<RagCandidate | null> => {
    const raw = await env.CHUNKS.get(`chunk:${match.id}`);
    if (!raw) return null;
    const chunk = JSON.parse(raw) as StoredChunk;
    return {
      ...chunk,
      id: match.id,
      vector_score: match.score,
      fusion_score: match.fusion_score,
      matched_queries: match.matched_queries,
      source_label: getSourceLabel(chunk)
    };
  }));
  const candidates = chunkResults.filter((candidate): candidate is RagCandidate => candidate !== null);

  addDebugStep(debugSteps, "rag.kv", "ok", "Đã tải nội dung ứng viên duy nhất từ KV.", {
    requested_chunks: fusedMatches.length,
    loaded_chunks: candidates.length,
    duplicate_reads_avoided: Math.max(
      0,
      filteredMatchSets.reduce((sum, matches) => sum + matches.length, 0) - fusedMatches.length
    )
  });

  if (!candidates.length) {
    return {
      content: "Không tìm thấy nội dung chunk tương ứng trong KV.",
      embedding_debug: embeddingResult?.debug,
      rag_query_debug: primaryDebug
    };
  }

  const useModelRerank = shouldUseModelRerank(candidates);
  let selected: RagCandidate[];
  if (useModelRerank) {
    try {
      selected = await rerankRagCandidates(
        retrievalQueries.join("\n"),
        candidates,
        env,
        debugSteps
      );
    } catch (error) {
      selected = selectRagCandidatesByVectorScore(candidates);
      addDebugStep(debugSteps, "rag.rerank", "error", "Rerank lỗi; fallback theo fusion score.", {
        error: getErrorText(error),
        selected_ids: selected.map(candidate => candidate.id)
      });
    }
  } else {
    selected = selectRagCandidatesByVectorScore(candidates);
    addDebugStep(debugSteps, "rag.rerank", "skip", "Không cần rerank vì số ứng viên vừa với context.", {
      candidates: candidates.length,
      context_limit: RAG_MAX_CONTEXT_CHUNKS,
      selected_ids: selected.map(candidate => candidate.id)
    });
  }

  const content = selected
    .map((candidate, index) => [
      `[Nguồn ${index + 1}: ${candidate.source_label}]`,
      `ID: ${candidate.id}`,
      `Điểm Vectorize: ${formatScore(candidate.vector_score)}`,
      `Số query khớp: ${candidate.matched_queries ?? 1}`,
      `Thứ hạng chọn: ${candidate.rerank_rank ?? index + 1}`,
      "",
      candidate.text
    ].join("\n"))
    .join("\n\n---\n\n");
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  const coverage = retrievalQueries.map((retrievalQuery, index) => {
    const matches = filteredMatchSets[index] ?? [];
    return {
      query: retrievalQuery,
      candidate_hits: matches.length,
      selected_hits: matches.filter(match => selectedIds.has(match.id)).length
    };
  });
  const missingQueries = coverage
    .filter(item => item.selected_hits === 0)
    .map(item => item.query);
  const retrievalSummary = {
    query_count: retrievalQueries.length,
    unique_candidates: candidates.length,
    selected_chunks: selected.length,
    covered_queries: coverage.filter(item => item.selected_hits > 0).map(item => item.query),
    missing_queries: missingQueries,
    coverage
  };

  return {
    content: [
      `[RAG_RETRIEVAL_SUMMARY]${JSON.stringify(retrievalSummary)}[/RAG_RETRIEVAL_SUMMARY]`,
      content
    ].join("\n\n"),
    sources: mergeRagSources([], selected.map(toRagSource), RAG_MAX_VISIBLE_SOURCES),
    embedding_debug: embeddingResult?.debug,
    rag_query_debug: primaryDebug
  };
}
