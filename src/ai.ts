import {
  CHAT_MODEL,
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
import type { AIMessage, EmbeddingResult, RagCandidate, RagQueryDebug, RagSource, StoredChunk, ToolExecutionResult, VectorMatch } from "./types";

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
      description: getRuntimeToolDescription(String(tool.name), String(tool.description ?? "")),
      parameters: tool.parameters
    }
  }));
}

function getRuntimeToolDescription(name: string, description: string): string {
  if (name !== "rag_search") return description;

  return `${description}

Bá»• sung sau ingest: rag_search cÅ©ng cÃ³ thá»ƒ tra cá»©u doc/logic/*.md. DÃ¹ng nÃ³ khi cáº§n hiá»ƒu cÃ¡ch Zilcode hoáº¡t Ä‘á»™ng, domain model, REST API contract, runtime architecture, window/tab/field config, tool safety rules, hoáº·c khi cáº§n láº¥y kiáº¿n thá»©c logic Ä‘á»ƒ chá»n/gá»i cÃ¡c tool Zilcode Ä‘Ãºng hÆ¡n vÃ  káº¿t há»£p vá»›i dá»¯ liá»‡u tháº­t.`;
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

export async function runChatModel(
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

export async function searchRag(
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
