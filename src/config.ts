export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  ZILCODE_SESSIONS?: KVNamespace;
  ZILCODE_API_TOKEN: string;
  ZILCODE_BASE?: string;
  SESSION_TTL_SECONDS?: string;
}

export const CHAT_MODEL = "@cf/openai/gpt-oss-120b";
export const GENERAL_CHAT_MODEL = CHAT_MODEL;
export const QUERY_REWRITE_MODEL = CHAT_MODEL;
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";

export const TOOL_SELECTION_MAX_TOKENS = 2048;
export const GENERAL_CHAT_MAX_TOKENS = 1024;
export const RAG_FINAL_MAX_TOKENS = 2048;
export const RAG_RERANK_MAX_TOKENS = 512;
export const RAG_QUERY_REWRITE_MAX_TOKENS = 160;
export const RAG_VECTOR_TOP_K = 16;
export const RAG_MAX_CONTEXT_CHUNKS = 6;
export const RAG_MIN_SCORE = 0.35;
export const RAG_RERANK_TEXT_MAX_CHARS = 900;
export const RAG_VECTOR_DIMENSIONS = 1024;
export const TOOL_RESULT_CONTEXT_MAX_CHARS = 16000;
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_HISTORY_CONTENT_CHARS = 1200;
export const DEFAULT_ZILCODE_BASE = "https://demo.zilcode.com";
export const ZILCODE_SESSION_PREFIX = "zilcode_session:";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Zilcode-Token, X-Zilcode-Session, X-Zilcode-Base, X-Zilcode-UserId, X-Zilcode-Username, X-Zilcode-RoleId, X-Zilcode-OrgId, X-Zilcode-SiteCode",
};
