import type {
  AgentEvidenceRecord,
  AgentRunBudget,
  AgentRunOptions,
  AgentRunState,
  AgentToolAttempt
} from "./types";

export type ToolOutcomeStatus =
  | "success"
  | "invalid"
  | "not_found"
  | "partial_success"
  | "verification_failed"
  | "error"
  | "unknown";

export interface ToolOutcome {
  status: ToolOutcomeStatus;
  parsed?: Record<string, unknown>;
  summary: Record<string, unknown>;
  has_error: boolean;
  has_new_evidence: boolean;
}

export interface ToolExecutionGuardResult {
  allowed: boolean;
  reason?: "repeated_without_progress" | "read_budget_exhausted" | "prepare_repair_budget_exhausted";
  fingerprint: string;
}

const DEFAULT_READ_BUDGET = 10;
const DEFAULT_PREPARE_REPAIR_BUDGET = 3;
const DEFAULT_APPLY_REPAIR_BUDGET = 2;
const MAX_EVIDENCE_RECORDS = 40;
const MAX_TOOL_ATTEMPTS = 60;

export function createAgentRunState(
  originalRequest: string,
  options: AgentRunOptions = {}
): AgentRunState {
  if (options.initial_state) return normalizeAgentRunState(options.initial_state);

  const now = new Date().toISOString();
  return {
    run_id: options.run_id || `run_${crypto.randomUUID()}`,
    job_id: options.job_id,
    conversation_id: options.conversation_id,
    user_key: options.user_key,
    goal: originalRequest,
    original_request: originalRequest,
    clarified_request: originalRequest,
    request_kind: "unknown",
    required_outcome: "answer",
    resolved_targets: [],
    collected_evidence: [],
    attempted_tool_calls: [],
    prepared_operations: [],
    completed_operations: [],
    verification_results: [],
    repair_attempts: { prepare: 0, apply: 0 },
    residual_plan_ids: [],
    phase_checkpoints: {},
    budgets: {
      read: { used: 0, limit: DEFAULT_READ_BUDGET },
      prepare_repair: { used: 0, limit: DEFAULT_PREPARE_REPAIR_BUDGET },
      apply_repair: { used: 0, limit: DEFAULT_APPLY_REPAIR_BUDGET }
    },
    progress_revision: 0,
    terminal_status: "running",
    created_at: now,
    updated_at: now
  };
}

export function normalizeAgentRunState(state: AgentRunState): AgentRunState {
  return {
    ...state,
    request_kind: state.request_kind || "unknown",
    required_outcome: state.required_outcome || "answer",
    resolved_targets: Array.isArray(state.resolved_targets) ? state.resolved_targets : [],
    collected_evidence: Array.isArray(state.collected_evidence) ? state.collected_evidence : [],
    attempted_tool_calls: Array.isArray(state.attempted_tool_calls) ? state.attempted_tool_calls : [],
    prepared_operations: Array.isArray(state.prepared_operations) ? state.prepared_operations : [],
    completed_operations: Array.isArray(state.completed_operations) ? state.completed_operations : [],
    verification_results: Array.isArray(state.verification_results) ? state.verification_results : [],
    residual_plan_ids: Array.isArray(state.residual_plan_ids) ? state.residual_plan_ids : [],
    repair_attempts: {
      prepare: Number(state.repair_attempts?.prepare || 0),
      apply: Number(state.repair_attempts?.apply || 0)
    },
    phase_checkpoints: state.phase_checkpoints || {},
    budgets: {
      read: normalizeBudget(state.budgets?.read, DEFAULT_READ_BUDGET),
      prepare_repair: normalizeBudget(state.budgets?.prepare_repair, DEFAULT_PREPARE_REPAIR_BUDGET),
      apply_repair: normalizeBudget(state.budgets?.apply_repair, DEFAULT_APPLY_REPAIR_BUDGET)
    },
    progress_revision: Number(state.progress_revision || 0),
    terminal_status: state.terminal_status || "running",
    updated_at: state.updated_at || new Date().toISOString()
  };
}

export function updateRunContext(
  state: AgentRunState,
  clarifiedRequest: string,
  resolvedTargets: Array<Record<string, unknown>>,
  requestContract?: Pick<AgentRunState, "request_kind" | "required_outcome">
): void {
  const normalizedTargets = dedupeRecords(resolvedTargets);
  const contextChanged = state.clarified_request !== clarifiedRequest
    || stableStringify(state.resolved_targets) !== stableStringify(normalizedTargets)
    || (requestContract !== undefined && (
      state.request_kind !== requestContract.request_kind
      || state.required_outcome !== requestContract.required_outcome
    ));

  state.clarified_request = clarifiedRequest;
  state.goal = clarifiedRequest || state.original_request;
  state.resolved_targets = normalizedTargets;
  if (requestContract) {
    state.request_kind = requestContract.request_kind;
    state.required_outcome = requestContract.required_outcome;
  }
  if (contextChanged) markRunProgress(state);
  touchRunState(state);
}

export function inspectToolResult(toolName: string, content: string): ToolOutcome {
  let parsed: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(content) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = undefined;
  }

  const status = classifyToolOutcome(parsed, content);
  const summary = summarizeToolOutcome(toolName, parsed, content, status);
  return {
    status,
    parsed,
    summary,
    has_error: ["invalid", "not_found", "partial_success", "verification_failed", "error"].includes(status),
    has_new_evidence: status !== "error" || Boolean(parsed)
  };
}

export function guardToolExecution(
  state: AgentRunState,
  toolName: string,
  args: Record<string, unknown>
): ToolExecutionGuardResult {
  const fingerprint = createToolInputFingerprint(toolName, args);
  const lastSameInput = [...state.attempted_tool_calls]
    .reverse()
    .find(attempt => attempt.input_fingerprint === fingerprint);

  if (lastSameInput && lastSameInput.progress_revision === state.progress_revision) {
    return { allowed: false, reason: "repeated_without_progress", fingerprint };
  }

  if (isReadTool(toolName) && isBudgetExhausted(state.budgets.read)) {
    return { allowed: false, reason: "read_budget_exhausted", fingerprint };
  }

  if (toolName === "app_builder_prepare_change"
    && state.repair_attempts.prepare > 0
    && isBudgetExhausted(state.budgets.prepare_repair)) {
    return { allowed: false, reason: "prepare_repair_budget_exhausted", fingerprint };
  }

  return { allowed: true, fingerprint };
}

export function recordToolOutcome(
  state: AgentRunState,
  toolName: string,
  args: Record<string, unknown>,
  outcome: ToolOutcome
): AgentToolAttempt {
  const progressBefore = state.progress_revision;
  const inputFingerprint = createToolInputFingerprint(toolName, args);
  const resultFingerprint = createToolResultFingerprint(toolName, args, outcome.status);

  if (isReadTool(toolName)) state.budgets.read.used += 1;
  if (toolName === "app_builder_prepare_change" && ["invalid", "error"].includes(outcome.status)) {
    state.repair_attempts.prepare += 1;
    state.budgets.prepare_repair.used += 1;
  }

  const evidence: AgentEvidenceRecord = {
    tool_name: toolName,
    result_status: outcome.status,
    summary: outcome.summary,
    collected_at: new Date().toISOString()
  };
  const evidenceKey = stableStringify(evidence.summary);
  const hasEquivalentEvidence = state.collected_evidence.some(item =>
    item.tool_name === toolName
    && item.result_status === outcome.status
    && stableStringify(item.summary) === evidenceKey
  );
  if (!hasEquivalentEvidence && outcome.has_new_evidence) {
    state.collected_evidence.push(evidence);
    state.collected_evidence = state.collected_evidence.slice(-MAX_EVIDENCE_RECORDS);
    markRunProgress(state);
  }

  updateWriteStateFromOutcome(state, toolName, outcome);

  const attempt: AgentToolAttempt = {
    tool_name: toolName,
    arguments: normalizeJsonValue(args) as Record<string, unknown>,
    input_fingerprint: inputFingerprint,
    result_fingerprint: resultFingerprint,
    result_status: outcome.status,
    progress_revision: progressBefore,
    attempted_at: new Date().toISOString()
  };
  state.attempted_tool_calls.push(attempt);
  state.attempted_tool_calls = state.attempted_tool_calls.slice(-MAX_TOOL_ATTEMPTS);
  touchRunState(state);
  return attempt;
}

export function blockAgentRun(
  state: AgentRunState,
  code: string,
  detail: string,
  evidence?: Record<string, unknown>
): void {
  state.terminal_status = "blocked";
  state.blocker = { code, detail, evidence };
  touchRunState(state);
}

export function setAgentRunTerminalStatus(
  state: AgentRunState,
  status: AgentRunState["terminal_status"]
): void {
  state.terminal_status = status;
  touchRunState(state);
}

export function createToolInputFingerprint(toolName: string, args: Record<string, unknown>): string {
  return hashText(stableStringify({ tool_name: toolName, arguments: args }));
}

export function createToolResultFingerprint(
  toolName: string,
  args: Record<string, unknown>,
  resultStatus: string
): string {
  return hashText(stableStringify({ tool_name: toolName, arguments: args, result_status: resultStatus }));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function updateWriteStateFromOutcome(state: AgentRunState, toolName: string, outcome: ToolOutcome): void {
  if (toolName !== "app_builder_prepare_change" || !outcome.parsed) return;

  if (outcome.status === "success") {
    const operations = Array.isArray(outcome.parsed.operations)
      ? outcome.parsed.operations.filter(isRecord)
      : [];
    state.prepared_operations = operations;
    state.approved_change_envelope = isRecord(outcome.parsed.approved_change_envelope)
      ? outcome.parsed.approved_change_envelope
      : {
        plan_id: outcome.parsed.plan_id,
        intent: outcome.parsed.intent,
        summary: outcome.parsed.summary,
        operations
      };
    state.terminal_status = "waiting_confirmation";
    markRunProgress(state);
    return;
  }

  if (outcome.status === "invalid") {
    state.terminal_status = "repairing";
  }
}

function classifyToolOutcome(parsed: Record<string, unknown> | undefined, content: string): ToolOutcomeStatus {
  const statusText = String(parsed?.status ?? "").toLowerCase();
  if (statusText === "verification_failed") return "verification_failed";
  if (statusText === "partial_success") return "partial_success";
  if (statusText === "not_found") return "not_found";
  if (statusText === "invalid" || parsed?.valid === false) return "invalid";
  if (parsed?.ok === false || parsed?.error || parsed?.has_error === true) return "error";
  if (parsed?.ok === true || parsed?.valid === true || ["success", "ready_for_confirmation"].includes(statusText)) {
    return "success";
  }
  if (parsed) return "success";
  return content.trim() ? "success" : "unknown";
}

function summarizeToolOutcome(
  toolName: string,
  parsed: Record<string, unknown> | undefined,
  content: string,
  status: ToolOutcomeStatus
): Record<string, unknown> {
  if (!parsed) {
    return { status, content_chars: content.length };
  }

  const summary: Record<string, unknown> = { status };
  for (const key of [
    "mode", "plan_id", "valid", "ok", "matches_count", "graph_nodes", "graph_edges",
    "operation_count", "applied_count", "failed_count", "skipped_count", "truncated"
  ]) {
    if (parsed[key] !== undefined) summary[key] = parsed[key];
  }

  if (Array.isArray(parsed.matches)) {
    summary.matches = parsed.matches.slice(0, 5).map(item => compactRecord(item));
  }
  if (parsed.node && typeof parsed.node === "object") summary.node = compactRecord(parsed.node);
  if (parsed.blocking_errors !== undefined) summary.blocking_errors = compactUnknown(parsed.blocking_errors);
  if (parsed.failed_operation !== undefined) summary.failed_operation = compactUnknown(parsed.failed_operation);
  if (parsed.summary !== undefined) summary.plan_summary = compactUnknown(parsed.summary);
  summary.tool_name = toolName;
  return summary;
}

function compactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 10).map(compactUnknown);
  if (isRecord(value)) return compactRecord(value);
  if (typeof value === "string") return value.slice(0, 1000);
  return value;
}

function compactRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const output: Record<string, unknown> = {};
  Object.entries(value).slice(0, 24).forEach(([key, item]) => {
    output[key] = compactUnknown(item);
  });
  return output;
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((output, key) => {
        output[key] = normalizeJsonValue(value[key]);
        return output;
      }, {});
  }
  return value;
}

function normalizeBudget(value: AgentRunBudget | undefined, defaultLimit: number): AgentRunBudget {
  return {
    used: Math.max(0, Number(value?.used || 0)),
    limit: Math.max(1, Number(value?.limit || defaultLimit))
  };
}

function isBudgetExhausted(budget: AgentRunBudget): boolean {
  return budget.used >= budget.limit;
}

function isReadTool(toolName: string): boolean {
  return [
    "rag_search",
    "app_builder_graph_overview",
    "app_builder_graph_search",
    "app_builder_graph_subgraph",
    "app_builder_node_detail",
    "app_builder_creation_schema"
  ].includes(toolName);
}

function dedupeRecords(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = stableStringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function markRunProgress(state: AgentRunState): void {
  state.progress_revision += 1;
}

function touchRunState(state: AgentRunState): void {
  state.updated_at = new Date().toISOString();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
