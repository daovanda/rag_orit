export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  DB?: D1Database;
  AGENT_JOBS?: Queue;
  ZILCODE_SESSIONS?: KVNamespace;
  ZILCODE_API_TOKEN: string;
  ZILCODE_BASE?: string;
  SESSION_TTL_SECONDS?: string;
  MODEL_PROVIDER?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_BASE_URL?: string;
  NVIDIA_CHAT_MODEL?: string;
  NVIDIA_STREAM?: string;
}

export type ModelProvider = "cloudflare" | "nvidia";

export const DEFAULT_MODEL_PROVIDER: ModelProvider = "cloudflare";
export const CHAT_MODEL = "@cf/moonshotai/kimi-k2.7-code"  // "@cf/openai/gpt-oss-120b";
export const GENERAL_CHAT_MODEL = CHAT_MODEL;
export const QUERY_REWRITE_MODEL = CHAT_MODEL;
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_DEFAULT_CHAT_MODEL = "z-ai/glm-5.2";

export const TOOL_SELECTION_MAX_TOKENS = 3072; // old 2048: GLM có thêm room để trả tool_calls/arguments ổn định hơn.
export const GENERAL_CHAT_MAX_TOKENS = 2048; // old 1024: cho phép trả lời hội thoại thường đầy đủ hơn.
export const RAG_FINAL_MAX_TOKENS = 4096; // old 2048: final answer có thể diễn giải graph/RAG sâu hơn.
export const RAG_RERANK_MAX_TOKENS = 1024; // old 512: rerank nhiều chunk hơn mà vẫn đủ JSON output.
export const RAG_QUERY_REWRITE_MAX_TOKENS = 256; // old 160: rewrite query có thêm chỗ giữ ngữ cảnh Zilcode.
export const RAG_VECTOR_TOP_K = 24; // old 16: lấy thêm ứng viên tài liệu trước khi lọc/rerank.
export const RAG_MAX_CONTEXT_CHUNKS = 10; // old 6: đưa thêm nguồn RAG vào context cho model mạnh hơn.
export const RAG_MIN_SCORE = 0.35;
export const RAG_RERANK_TEXT_MAX_CHARS = 1400; // old 900: mỗi chunk giữ thêm nội dung trước khi rerank.
export const RAG_VECTOR_DIMENSIONS = 1024;
export const TOOL_RESULT_CONTEXT_MAX_CHARS = 32000; // old 16000: giữ thêm graph/tool evidence trước bước compact.
export const MAX_HISTORY_MESSAGES = 12; // old 8: tăng trí nhớ hội thoại gần đây cho contextualizer/agent.
export const MAX_HISTORY_CONTENT_CHARS = 2000; // old 1200: mỗi message giữ nhiều chi tiết hơn khi rewrite/route.
export const DEFAULT_ZILCODE_BASE = "https://demo.zilcode.com";
export const ZILCODE_SESSION_PREFIX = "zilcode_session:";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Zilcode-Token, X-Zilcode-Session, X-Zilcode-Base, X-Zilcode-UserId, X-Zilcode-Username, X-Zilcode-RoleId, X-Zilcode-OrgId, X-Zilcode-SiteCode",
};
