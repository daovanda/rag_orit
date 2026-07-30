import type { TOOLS } from "./tools";

export type ToolDefinition = (typeof TOOLS)[number];

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
  rag_retrieval_summary?: RagRetrievalSummary;
}

export interface EmbeddingDebug {
  provider: "cloudflare";
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
  batch_queries?: RagQueryDebug[];
}

export interface VectorMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
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

export interface RagRetrievalCoverage {
  query: string;
  candidate_hits: number;
  selected_hits: number;
}

export interface RagRetrievalSummary {
  query_count: number;
  unique_candidates: number;
  selected_chunks: number;
  covered_queries: string[];
  missing_queries: string[];
  coverage: RagRetrievalCoverage[];
  candidate_source: "vector_metadata_excerpt" | "kv_fallback";
  used_model_rerank: boolean;
}

export interface RagCandidate extends StoredChunk {
  id: string;
  vector_score?: number;
  fusion_score?: number;
  matched_queries?: number;
  rerank_rank?: number;
  source_label: string;
}

export interface ChatModelRequest {
  messages: AIMessage[];
  tools?: readonly ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatModelResponse {
  response?: string;
  tool_calls?: ToolCall[];
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentMode = "default" | "search";

export type AgentRequestKind =
  | "conversation"
  | "knowledge"
  | "read"
  | "prepare_change"
  | "unknown";

export type AgentRequiredOutcome = "answer" | "pending_confirmation";

export interface ChatRequest {
  message: string;
  mode?: AgentMode;
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
  approved_change_envelope?: Record<string, unknown>;
  applied_count?: number;
  failed_count?: number;
  skipped_count?: number;
  verification_status?: string;
  verification_summary?: Record<string, unknown>;
  residual_plan_id?: string;
  error?: string;
  updated_at?: string;
}

export type AgentRunTerminalStatus =
  | "running"
  | "waiting_confirmation"
  | "repairing"
  | "succeeded"
  | "failed"
  | "blocked"
  | "verification_failed";

export interface AgentRunBudget {
  used: number;
  limit: number;
}

export interface AgentRunBudgets {
  read: AgentRunBudget;
  prepare_repair: AgentRunBudget;
  apply_repair: AgentRunBudget;
}

export interface AgentToolAttempt {
  tool_name: string;
  arguments: Record<string, unknown>;
  input_fingerprint: string;
  result_fingerprint: string;
  result_status: string;
  progress_revision: number;
  attempted_at: string;
}

export interface AgentEvidenceRecord {
  tool_name: string;
  result_status: string;
  summary: Record<string, unknown>;
  collected_at: string;
}

export interface AgentRepairAttempts {
  prepare: number;
  apply: number;
}

export interface AgentRunState {
  run_id: string;
  job_id?: string;
  conversation_id?: string;
  user_key?: string;
  goal: string;
  original_request: string;
  clarified_request: string;
  request_kind: AgentRequestKind;
  required_outcome: AgentRequiredOutcome;
  resolved_targets: Array<Record<string, unknown>>;
  collected_evidence: AgentEvidenceRecord[];
  desired_graph?: Record<string, unknown>;
  attempted_tool_calls: AgentToolAttempt[];
  prepared_operations: Array<Record<string, unknown>>;
  completed_operations: Array<Record<string, unknown>>;
  failed_operation?: Record<string, unknown>;
  verification_results: Array<Record<string, unknown>>;
  repair_attempts: AgentRepairAttempts;
  approved_change_envelope?: Record<string, unknown>;
  active_plan_id?: string;
  residual_plan_ids: string[];
  phase_checkpoints: Record<string, string>;
  budgets: AgentRunBudgets;
  progress_revision: number;
  terminal_status: AgentRunTerminalStatus;
  blocker?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentRunOptions {
  run_id?: string;
  job_id?: string;
  conversation_id?: string;
  user_key?: string;
  initial_state?: AgentRunState;
  on_state_change?: (state: AgentRunState) => void | Promise<void>;
}

export interface AgenticLoopResult {
  answer: string;
  toolsCalled: string[];
  sources?: RagSource[];
  embedding_debug?: EmbeddingDebug;
  rag_query_debug?: RagQueryDebug;
  action_state?: AgentActionState;
  run_state?: AgentRunState;
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
