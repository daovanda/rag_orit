import type { TOOLS } from "./tools";

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionResult {
  content: string;
  sources?: RagSource[];
  embedding_debug?: EmbeddingDebug;
  rag_query_debug?: RagQueryDebug;
}

export interface EmbeddingDebug {
  provider: "cloudflare" | "openrouter";
  model: string;
  dimensions: number;
  fallback: boolean;
}

export interface EmbeddingResult {
  vector: number[];
  debug: EmbeddingDebug;
}

export interface RagQueryDebug {
  original_query: string;
  rewritten_query: string;
  used: boolean;
  reason: string;
  model?: string;
}

export interface VectorMatch {
  id: string;
  score?: number;
}

export interface StoredChunk {
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

export interface RagCandidate extends StoredChunk {
  id: string;
  vector_score?: number;
  rerank_rank?: number;
  source_label: string;
}

export interface ChatModelRequest {
  messages: AIMessage[];
  tools?: typeof TOOLS;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatModelResponse {
  response?: string;
  tool_calls?: ToolCall[];
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface ResponseApiOutputItem {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: unknown;
  content?: Array<{ text?: string; type?: string }>;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  debug?: boolean;
  history?: unknown;
}

export interface RagSource {
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

export interface AgentActionState {
  kind: "prepare_change" | "apply_change";
  plan_id?: string;
  status?: string;
  ok?: boolean;
  valid?: boolean;
  requires_confirmation?: boolean;
  summary?: unknown;
  operations?: unknown;
  applied_count?: number;
  failed_count?: number;
  skipped_count?: number;
  error?: string;
  updated_at?: string;
}

export interface AgenticLoopResult {
  answer: string;
  toolsCalled: string[];
  sources?: RagSource[];
  embedding_debug?: EmbeddingDebug;
  rag_query_debug?: RagQueryDebug;
  action_state?: AgentActionState;
}

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface ToolResultRecord {
  name: string;
  content: string;
}

export interface ZilcodeSession {
  base_url: string;
  token: string;
  user: Record<string, unknown>;
  roleid?: string | number;
  orgid?: string | number;
  access?: Record<string, unknown>;
  apps?: unknown[];
  notifies?: unknown[];
  roles?: unknown[];
  orgs?: unknown[];
  updated_at?: string;
}

export interface ZilcodeSessionState {
  session_id: string;
  session: ZilcodeSession;
}

export interface ZilcodeApiEnvelope<T = unknown> {
  success?: boolean;
  result?: T;
  error?: string;
  total?: number;
}

export type BlueprintMode = "graph" | "subgraph" | "detail";
