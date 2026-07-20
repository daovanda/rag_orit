import { CORS, MAX_HISTORY_CONTENT_CHARS, MAX_HISTORY_MESSAGES, type Env } from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { parseAgentMode, runAgenticLoop, sanitizeHistoryContentForModel } from "./agent";
import { createAgentRunState } from "./agent-run-state";
import {
  buildPendingChangeVerificationInput,
  deletePendingChangePlan,
  loadPendingChangePlan,
  runAppBuilderWriteTool,
  type PendingChange,
  type WriteOperationJournalEvent
} from "./app-builder-write";
import {
  verifyAppBuilderWriteResult,
  type AppBuilderVerificationReport,
  type OperationVerificationResult
} from "./app-builder-verification";
import {
  buildApprovedChangeEnvelope,
  type ApprovedChangeEnvelope
} from "./app-builder-envelope";
import { aggregateRecoveryVerification, runApplyRecovery } from "./app-builder-recovery";
import { repairInvalidPrepareOperations } from "./app-builder-prepare-repair";
import { ActiveJobLeaseError, canScheduleJobRetry, isRetryableJobError } from "./job-retry";
import { redactSensitiveData, redactSensitiveString } from "./security-redaction";
import { loadZilcodeSessionFromRequestHeaders, type ZilcodeSessionState } from "./zilcode";
import type { AgentActionState, AgentMode, AgentRunState, AIMessage, RagSource } from "./types";

const MAX_STORED_MESSAGES = 200;
const JOB_AUTH_TTL_SECONDS = 60 * 60 * 2;
const RUNNING_JOB_STALE_SECONDS = 60 * 60 * 2;
const JOB_POLL_EVENT_LIMIT = 80;
const MAX_JOB_EVENT_PAYLOAD_CHARS = 12_000;
const JOB_EVENT_RETENTION_DAYS = 14;
const JOB_MAX_ATTEMPTS = 3;
const JOB_LEASE_SECONDS = 5 * 60;
const JOB_RETRY_DELAY_SECONDS = 5;

type JobStatus = "queued" | "running" | "waiting_confirmation" | "succeeded" | "failed" | "cancelled" | "expired";
type MessageStatus = "completed" | "generating" | "failed";
type JobKind = "message" | "apply_pending_action";

interface ConversationOwner {
  userid: string;
  sitecode: string;
  roleid: string;
  orgid: string;
  user_key: string;
}

interface ConversationRow {
  conversation_id: string;
  user_key: string;
  userid: string;
  sitecode: string;
  roleid: string | null;
  orgid: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageRow {
  message_id: string;
  conversation_id: string;
  user_key: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  mode: AgentMode | null;
  tools_called_json: string | null;
  sources_json: string | null;
  debug_steps_json: string | null;
  action_state_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  job_id: string;
  conversation_id: string;
  user_key: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  kind: JobKind;
  mode: AgentMode;
  status: JobStatus;
  stage: string | null;
  progress_text: string | null;
  error: string | null;
  idempotency_key: string | null;
  auth_context_json: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  expires_at: string | null;
  attempt_count: number;
  max_attempts: number;
  lease_expires_at: string | null;
  last_error_json: string | null;
}

interface PendingActionRow {
  action_id: string;
  conversation_id: string;
  user_key: string;
  job_id: string | null;
  assistant_message_id: string | null;
  plan_id: string;
  status: "waiting_confirmation" | "confirmed" | "cancelled" | "applied" | "failed" | "expired";
  payload_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface JobEventRow {
  event_id: string;
  job_id: string;
  user_key: string;
  seq: number;
  type: string;
  payload_json: string | null;
  created_at: string;
}

interface StoredMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  created_at: string;
  updated_at?: string;
  mode?: AgentMode | null;
  tools_called?: string[];
  sources?: RagSource[];
  debug_steps?: DebugStep[];
  action_state?: AgentActionState;
  error?: string | null;
}

interface JobPayload {
  message?: string;
  debug?: boolean;
  action_id?: string;
  plan_id?: string;
}

interface AgentJobQueueMessage {
  job_id: string;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers ?? {})
    }
  });
}

async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as T
      : {} as T;
  } catch {
    return {} as T;
  }
}

function requireDb(env: Env): D1Database | Response {
  if (env.DB) return env.DB;
  return jsonResponse({
    success: false,
    error: [
      "D1 database binding DB chưa được cấu hình.",
      "Tạo bằng: npx wrangler d1 create ragorit-agent-db",
      "Sau đó thêm binding d1_databases trong wrangler.jsonc và chạy migration."
    ].join(" ")
  }, { status: 500 });
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function toLimitedJson(value: unknown, maxChars: number): string | null {
  const json = toJson(redactSensitiveData(value));
  if (!json || json.length <= maxChars) return json;
  return JSON.stringify({
    truncated: true,
    original_chars: json.length,
    preview: json.slice(0, maxChars)
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

interface OperationJournalRow {
  operation_id: string;
  plan_id: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "verification_failed";
  attempt: number;
  postcondition_json: string | null;
}

function isTerminalRunStatus(status: AgentRunState["terminal_status"]): boolean {
  return ["succeeded", "failed", "blocked", "verification_failed"].includes(status);
}

async function loadAgentRunForJob(
  db: D1Database,
  job: JobRow
): Promise<AgentRunState | undefined> {
  const row = await db.prepare(
    `SELECT * FROM agent_runs WHERE job_id = ?1 AND user_key = ?2 LIMIT 1`
  ).bind(job.job_id, job.user_key).first<AgentRunRow>();
  return row ? safeJsonParse<AgentRunState | undefined>(row.state_json, undefined) : undefined;
}

async function loadAgentRunByJobId(
  db: D1Database,
  userKey: string,
  jobId: string | null
): Promise<AgentRunState | undefined> {
  if (!jobId) return undefined;
  const row = await db.prepare(
    `SELECT * FROM agent_runs WHERE job_id = ?1 AND user_key = ?2 LIMIT 1`
  ).bind(jobId, userKey).first<AgentRunRow>();
  return row ? safeJsonParse<AgentRunState | undefined>(row.state_json, undefined) : undefined;
}

async function persistAgentRunState(
  db: D1Database,
  job: JobRow,
  state: AgentRunState
): Promise<void> {
  const finishedAt = isTerminalRunStatus(state.terminal_status) ? state.updated_at : null;
  await db.prepare(
    `INSERT INTO agent_runs (
       run_id, job_id, conversation_id, user_key, status, goal,
       state_json, created_at, updated_at, finished_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(run_id) DO UPDATE SET
       status = excluded.status,
       goal = excluded.goal,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at,
       finished_at = excluded.finished_at`
  ).bind(
    state.run_id,
    job.job_id,
    job.conversation_id,
    job.user_key,
    state.terminal_status,
    state.goal,
    JSON.stringify(redactSensitiveData(state)),
    state.created_at,
    state.updated_at,
    finishedAt
  ).run();
}

async function persistOperationJournalEvent(
  db: D1Database,
  job: JobRow,
  runId: string,
  event: WriteOperationJournalEvent
): Promise<void> {
  const now = nowIso();
  const journalId = `journal_${runId}_${event.plan_id}_${event.operation_id}_${event.attempt}`;
  const safeEvent = redactSensitiveData(event) as WriteOperationJournalEvent;
  await db.prepare(
    `INSERT INTO operation_journal (
       journal_id, run_id, job_id, plan_id, operation_id, phase, status, attempt,
       precondition_json, expected_effect_json, request_json, result_json,
       error_json, postcondition_json, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
     ON CONFLICT(run_id, plan_id, operation_id, attempt) DO UPDATE SET
       status = excluded.status,
       precondition_json = COALESCE(excluded.precondition_json, operation_journal.precondition_json),
       expected_effect_json = COALESCE(excluded.expected_effect_json, operation_journal.expected_effect_json),
       request_json = COALESCE(excluded.request_json, operation_journal.request_json),
       result_json = COALESCE(excluded.result_json, operation_journal.result_json),
       error_json = COALESCE(excluded.error_json, operation_journal.error_json),
       postcondition_json = COALESCE(excluded.postcondition_json, operation_journal.postcondition_json),
       updated_at = excluded.updated_at`
  ).bind(
    journalId,
    runId,
    job.job_id,
    event.plan_id,
    event.operation_id,
    event.phase,
    event.status,
    event.attempt,
    toLimitedJson(safeEvent.precondition, MAX_JOB_EVENT_PAYLOAD_CHARS),
    toLimitedJson(safeEvent.expected_effect, MAX_JOB_EVENT_PAYLOAD_CHARS),
    toLimitedJson(safeEvent.request, MAX_JOB_EVENT_PAYLOAD_CHARS),
    toLimitedJson(safeEvent.result, MAX_JOB_EVENT_PAYLOAD_CHARS),
    toLimitedJson(safeEvent.error, MAX_JOB_EVENT_PAYLOAD_CHARS),
    toLimitedJson(safeEvent.postcondition, MAX_JOB_EVENT_PAYLOAD_CHARS),
    now,
    now
  ).run();
}

async function persistVerificationJournal(
  db: D1Database,
  runId: string,
  planId: string,
  attempt: number,
  report: AppBuilderVerificationReport
): Promise<void> {
  const now = nowIso();
  for (const result of report.operation_results) {
    await db.prepare(
      `UPDATE operation_journal
       SET status = CASE
             WHEN status IN ('failed', 'skipped') THEN status
             ELSE ?1
           END,
           postcondition_json = ?2,
           updated_at = ?3
       WHERE run_id = ?4 AND plan_id = ?5 AND operation_id = ?6 AND attempt = ?7`
    ).bind(
      result.status === "passed" ? "succeeded" : "verification_failed",
      toLimitedJson(redactSensitiveData({
        verified: result.status === "passed",
        status: result.status,
        observed_state: result.observed_state,
        node_id: result.node_id,
        reference: result.reference,
        actual_record: result.actual_record,
        mismatches: result.mismatches,
        relations_checked: result.relations_checked,
        evidence: result.evidence,
        error: result.error
      }), MAX_JOB_EVENT_PAYLOAD_CHARS),
      now,
      runId,
      planId,
      result.operation_id,
      attempt
    ).run();
  }
  if (report.cache_results.length) {
    const cacheVerified = report.cache_results.every(result => result.status === "passed");
    await db.prepare(
      `UPDATE operation_journal
       SET status = ?1, postcondition_json = ?2, updated_at = ?3
       WHERE run_id = ?4 AND plan_id = ?5
         AND operation_id = 'auto_deploy_window_cache' AND attempt = ?6`
    ).bind(
      cacheVerified ? "succeeded" : "verification_failed",
      toLimitedJson(redactSensitiveData({
        verified: cacheVerified,
        cache_results: report.cache_results
      }), MAX_JOB_EVENT_PAYLOAD_CHARS),
      now,
      runId,
      planId,
      attempt
    ).run();
  }
}

async function loadResumeJournalSnapshot(
  db: D1Database,
  runId: string,
  planId: string
): Promise<{
  attempt: number;
  has_execution_progress: boolean;
  verified_operations: Record<string, Record<string, unknown>>;
}> {
  const result = await db.prepare(
    `SELECT operation_id, plan_id, status, attempt, postcondition_json
     FROM operation_journal
     WHERE run_id = ?1
     ORDER BY attempt DESC, updated_at ASC`
  ).bind(runId).all<OperationJournalRow>();
  const rows = result.results ?? [];
  const activeRows = rows.filter(row => row.plan_id === planId);
  const attempt = activeRows.length ? Math.max(...activeRows.map(row => Number(row.attempt || 1))) : 0;
  const latestRows = activeRows.filter(row => Number(row.attempt || 1) === attempt);
  const verifiedOperations: Record<string, Record<string, unknown>> = {};

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(verifiedOperations, row.operation_id)) continue;
    const postcondition = safeJsonParse<Record<string, unknown>>(row.postcondition_json, {});
    if (postcondition.verified !== true) continue;
    const reference = postcondition.reference
      && typeof postcondition.reference === "object"
      && !Array.isArray(postcondition.reference)
      ? postcondition.reference as Record<string, unknown>
      : postcondition.actual_record
        && typeof postcondition.actual_record === "object"
        && !Array.isArray(postcondition.actual_record)
        ? postcondition.actual_record as Record<string, unknown>
        : undefined;
    verifiedOperations[row.operation_id] = reference ?? {};
  }

  return {
    attempt,
    has_execution_progress: latestRows.some(row => row.status !== "pending"),
    verified_operations: verifiedOperations
  };
}

async function observePendingPlanForResume(
  db: D1Database,
  env: Env,
  state: ZilcodeSessionState,
  runId: string,
  plan: PendingChange,
  approvedEnvelope: ApprovedChangeEnvelope,
  journalAttempt: number,
  verifiedOperations: Record<string, Record<string, unknown>>,
  debugSteps: DebugStep[]
): Promise<{ write_result: Record<string, unknown>; verification: AppBuilderVerificationReport }> {
  let writeResult = buildPendingChangeVerificationInput(plan, verifiedOperations);
  addDebugStep(debugSteps, "pending_action.resume_observe", "start", "Đọc lại trạng thái thật trước khi resume apply.", {
    plan_id: plan.plan_id,
    journal_attempt: journalAttempt,
    previously_verified: Object.keys(verifiedOperations)
  });
  let verification = await verifyAppBuilderWriteResult(env, state.session, writeResult);
  const combinedReferences = {
    ...verifiedOperations,
    ...verification.verified_operations
  };
  if (Object.keys(combinedReferences).length > Object.keys(verifiedOperations).length) {
    writeResult = buildPendingChangeVerificationInput(plan, combinedReferences);
    verification = await verifyAppBuilderWriteResult(env, state.session, writeResult);
  }
  const operationResults = new Map(
    verification.operation_results.map(result => [result.operation_id, result])
  );
  for (const operation of approvedEnvelope.operations) {
    if (operationResults.has(operation.operation_id)) continue;
    if (!Object.prototype.hasOwnProperty.call(verifiedOperations, operation.operation_id)) continue;
    const reference = verifiedOperations[operation.operation_id];
    operationResults.set(operation.operation_id, {
      operation_id: operation.operation_id,
      target: operation.target,
      action: operation.original_action,
      status: "passed",
      observed_state: operation.original_action === "delete" ? "absent" : "present",
      reference,
      actual_record: reference,
      mismatches: [],
      relations_checked: []
    });
  }
  verification = aggregateRecoveryVerification(
    operationResults,
    new Map(verification.cache_results.map(result => [result.windowid, result])),
    approvedEnvelope.operations.map(operation => operation.operation_id)
  );
  await persistVerificationJournal(db, runId, plan.plan_id, journalAttempt, verification);
  addDebugStep(
    debugSteps,
    "pending_action.resume_observe",
    verification.ok ? "ok" : "error",
    "Đã đối chiếu journal với metadata hiện tại.",
    { plan_id: plan.plan_id, verification: verification.summary }
  );
  return { write_result: writeResult, verification };
}

function parseApprovedChangeEnvelope(value: unknown): ApprovedChangeEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.source !== "confirmed_plan" || !Array.isArray(record.operations)) return undefined;
  const operations = record.operations.filter(operation =>
    Boolean(operation) && typeof operation === "object" && !Array.isArray(operation)
  ) as ApprovedChangeEnvelope["operations"];
  if (!operations.length || operations.some(operation =>
    !operation.operation_id
    || !["create", "update", "delete"].includes(operation.original_action)
    || !operation.target
    || !operation.collection
    || !Array.isArray(operation.allowed_fields)
  )) return undefined;
  return {
    source: "confirmed_plan",
    plan_id: typeof record.plan_id === "string" ? record.plan_id : undefined,
    operations
  };
}

async function loadApprovedEnvelopeFromPendingPlan(
  env: Env,
  planId: string
): Promise<ApprovedChangeEnvelope | undefined> {
  const raw = await env.CHUNKS.get(`app_builder_change:${planId}`);
  if (!raw) return undefined;
  const plan = safeJsonParse<PendingChange | undefined>(raw, undefined);
  if (!plan) return undefined;
  const storedEnvelope = parseApprovedChangeEnvelope(plan.approved_change_envelope);
  if (storedEnvelope) return storedEnvelope;
  if (!Array.isArray(plan.operations) || !plan.operations.length) return undefined;
  return buildApprovedChangeEnvelope(
    planId,
    plan.operations.map(operation => ({
      id: operation.id,
      action: operation.action,
      target: operation.target,
      collection: operation.collection,
      record: operation.record,
      id_value: operation.id_value,
      where: operation.where
    }))
  );
}

async function persistPhaseCheckpoints(
  db: D1Database,
  runId: string,
  report: AppBuilderVerificationReport
): Promise<void> {
  const phases = new Map<string, OperationVerificationResult[]>();
  for (const result of report.operation_results) {
    const phase = result.phase || "cache_verification";
    phases.set(phase, [...(phases.get(phase) ?? []), result]);
  }

  if (report.cache_results.length) {
    const cacheResults: OperationVerificationResult[] = report.cache_results.map((result, index) => ({
      operation_id: `verify_cache_${index + 1}`,
      target: "cache",
      action: "update",
      phase: "cache_verification",
      status: result.status,
      observed_state: result.status === "passed" ? "present" : "unknown",
      mismatches: [],
      relations_checked: [],
      error: result.error
    }));
    phases.set("cache_verification", [...(phases.get("cache_verification") ?? []), ...cacheResults]);
  }

  for (const [phase, results] of phases) {
    const status = results.every(result => result.status === "passed")
      ? "succeeded"
      : "verification_failed";
    const now = nowIso();
    await db.prepare(
      `INSERT INTO agent_phase_checkpoints (
         checkpoint_id, run_id, phase, status, state_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(run_id, phase) DO UPDATE SET
         status = excluded.status,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`
    ).bind(
      `checkpoint_${runId}_${phase}`,
      runId,
      phase,
      status,
      toLimitedJson(redactSensitiveData({ results }), MAX_JOB_EVENT_PAYLOAD_CHARS),
      now,
      now
    ).run();
  }
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.@-]/g, "_") || "unknown";
}

function getOwnerFromSession(state: ZilcodeSessionState | null): ConversationOwner | null {
  if (!state) return null;
  const user = state.session.user ?? {};
  const userid = String(user.userid ?? user.user_id ?? "").trim();
  const sitecode = String(user.sitecode ?? "").trim();
  const roleid = String(state.session.roleid ?? user.roleid ?? "").trim();
  const orgid = String(state.session.orgid ?? user.orgid ?? "0").trim() || "0";
  if (!userid || !sitecode) return null;
  return {
    userid,
    sitecode,
    roleid,
    orgid,
    user_key: [
      sanitizeKeyPart(sitecode),
      sanitizeKeyPart(userid),
      sanitizeKeyPart(roleid || "no-role"),
      sanitizeKeyPart(orgid || "0")
    ].join(":")
  };
}

function requireZilcodeContext(request: Request, env: Env): { state: ZilcodeSessionState; owner: ConversationOwner } | Response {
  const state = loadZilcodeSessionFromRequestHeaders(request, env);
  const owner = getOwnerFromSession(state);
  if (!state || !owner) {
    return jsonResponse({
      success: false,
      error: "Thiếu Zilcode token/context. Hãy gửi Authorization: Bearer <token>, X-Zilcode-UserId và X-Zilcode-SiteCode."
    }, { status: 401 });
  }
  return { state, owner };
}

function summarizeConversation(row: ConversationRow, messagesCount = 0, pendingAction?: PendingActionRow | null): Record<string, unknown> {
  return {
    conversation_id: row.conversation_id,
    title: row.title,
    userid: row.userid,
    sitecode: row.sitecode,
    roleid: row.roleid,
    orgid: row.orgid,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages_count: messagesCount,
    pending_action: pendingAction
      ? serializePendingAction(pendingAction)
      : undefined
  };
}

function serializeMessage(row: MessageRow): StoredMessage {
  return {
    message_id: row.message_id,
    role: row.role,
    content: row.content,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mode: row.mode,
    tools_called: safeJsonParse<string[]>(row.tools_called_json, []),
    sources: safeJsonParse<RagSource[]>(row.sources_json, []),
    debug_steps: safeJsonParse<DebugStep[]>(row.debug_steps_json, []),
    action_state: safeJsonParse<AgentActionState | undefined>(row.action_state_json, undefined),
    error: row.error
  };
}

function serializeJob(row: JobRow, events: JobEventRow[] = []): Record<string, unknown> {
  return {
    job_id: row.job_id,
    conversation_id: row.conversation_id,
    user_message_id: row.user_message_id,
    assistant_message_id: row.assistant_message_id,
    kind: row.kind,
    mode: row.mode,
    status: row.status,
    stage: row.stage,
    progress_text: row.progress_text,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
    expires_at: row.expires_at,
    events: events.map(event => ({
      event_id: event.event_id,
      seq: event.seq,
      type: event.type,
      payload: safeJsonParse<Record<string, unknown> | null>(event.payload_json, null),
      created_at: event.created_at
    }))
  };
}

function serializePendingAction(row: PendingActionRow): Record<string, unknown> {
  return {
    action_id: row.action_id,
    conversation_id: row.conversation_id,
    job_id: row.job_id,
    assistant_message_id: row.assistant_message_id,
    plan_id: row.plan_id,
    status: row.status,
    payload: safeJsonParse<Record<string, unknown> | null>(row.payload_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at
  };
}

async function getConversation(db: D1Database, owner: ConversationOwner, conversationId: string): Promise<ConversationRow | null> {
  return db.prepare(
    `SELECT * FROM conversations
     WHERE conversation_id = ?1 AND user_key = ?2 AND deleted_at IS NULL`
  ).bind(conversationId, owner.user_key).first<ConversationRow>();
}

async function countConversationMessages(db: D1Database, owner: ConversationOwner, conversationId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2`
  ).bind(conversationId, owner.user_key).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function getPendingActionForConversation(
  db: D1Database,
  owner: ConversationOwner,
  conversationId: string
): Promise<PendingActionRow | null> {
  return db.prepare(
    `SELECT * FROM pending_actions
     WHERE conversation_id = ?1 AND user_key = ?2 AND status = 'waiting_confirmation'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(conversationId, owner.user_key).first<PendingActionRow>();
}

async function getMessage(db: D1Database, userKey: string, messageId: string): Promise<MessageRow | null> {
  return db.prepare(
    `SELECT * FROM messages WHERE message_id = ?1 AND user_key = ?2`
  ).bind(messageId, userKey).first<MessageRow>();
}

async function getJob(db: D1Database, userKey: string, jobId: string): Promise<JobRow | null> {
  return db.prepare(
    `SELECT * FROM jobs WHERE job_id = ?1 AND user_key = ?2`
  ).bind(jobId, userKey).first<JobRow>();
}

async function getJobAnyOwner(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare(`SELECT * FROM jobs WHERE job_id = ?1`).bind(jobId).first<JobRow>();
}

interface AgentRunRow {
  run_id: string;
  job_id: string | null;
  conversation_id: string;
  user_key: string;
  status: AgentRunState["terminal_status"];
  goal: string;
  state_json: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

async function getActiveConversationJob(db: D1Database, userKey: string, conversationId: string): Promise<JobRow | null> {
  return db.prepare(
    `SELECT * FROM jobs
     WHERE conversation_id = ?1 AND user_key = ?2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(conversationId, userKey).first<JobRow>();
}

async function insertJobEvent(
  db: D1Database,
  job: Pick<JobRow, "job_id" | "user_key">,
  type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const seqRow = await db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM job_events WHERE job_id = ?1`
  ).bind(job.job_id).first<{ next_seq: number }>();
  await db.prepare(
    `INSERT INTO job_events (event_id, job_id, user_key, seq, type, payload_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    `evt_${crypto.randomUUID()}`,
    job.job_id,
    job.user_key,
    Number(seqRow?.next_seq ?? 1),
    type,
    toLimitedJson(payload, MAX_JOB_EVENT_PAYLOAD_CHARS),
    nowIso()
  ).run();
}

async function listJobEvents(db: D1Database, userKey: string, jobId: string): Promise<JobEventRow[]> {
  const result = await db.prepare(
    `SELECT * FROM job_events
     WHERE job_id = ?1 AND user_key = ?2
     ORDER BY seq ASC LIMIT ?3`
  ).bind(jobId, userKey, JOB_POLL_EVENT_LIMIT).all<JobEventRow>();
  return result.results ?? [];
}

async function updateJob(
  db: D1Database,
  job: Pick<JobRow, "job_id" | "user_key">,
  patch: Partial<Pick<JobRow,
    "status" | "stage" | "progress_text" | "error" | "finished_at" |
    "auth_context_json" | "lease_expires_at" | "last_error_json"
  >>
): Promise<void> {
  const current = await getJob(db, job.user_key, job.job_id);
  if (!current) return;
  const has = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
  const nextStatus = has("status") ? patch.status : current.status;
  const clearsLease = Boolean(nextStatus && [
    "waiting_confirmation", "succeeded", "failed", "cancelled", "expired"
  ].includes(nextStatus));
  const refreshedLease = nextStatus === "running"
    ? addSeconds(new Date(), JOB_LEASE_SECONDS)
    : current.lease_expires_at;
  await db.prepare(
    `UPDATE jobs
     SET status = ?1, stage = ?2, progress_text = ?3, error = ?4, finished_at = ?5,
         auth_context_json = ?6, lease_expires_at = ?7, last_error_json = ?8, updated_at = ?9
     WHERE job_id = ?10 AND user_key = ?11`
  ).bind(
    nextStatus,
    has("stage") ? patch.stage : current.stage,
    has("progress_text") ? patch.progress_text : current.progress_text,
    has("error") && patch.error
      ? redactSensitiveString(patch.error)
      : has("error") ? patch.error : current.error,
    has("finished_at") ? patch.finished_at : current.finished_at,
    patch.auth_context_json === undefined ? current.auth_context_json : patch.auth_context_json,
    patch.lease_expires_at === undefined
      ? clearsLease ? null : refreshedLease
      : patch.lease_expires_at,
    patch.last_error_json === undefined ? current.last_error_json : patch.last_error_json,
    nowIso(),
    job.job_id,
    job.user_key
  ).run();
}

async function claimQueuedJob(db: D1Database, job: JobRow): Promise<JobRow | null> {
  const now = nowIso();
  const leaseExpiresAt = addSeconds(new Date(), JOB_LEASE_SECONDS);
  const claimed = await db.prepare(
    `UPDATE jobs
     SET status = 'running', stage = 'starting', progress_text = 'Agent job đang bắt đầu.',
         attempt_count = attempt_count + 1, lease_expires_at = ?2, updated_at = ?1
     WHERE job_id = ?3 AND user_key = ?4 AND status = 'queued'`
  ).bind(now, leaseExpiresAt, job.job_id, job.user_key).run();

  if (Number(claimed.meta?.changes ?? 0) < 1) return null;
  return {
    ...job,
    status: "running",
    stage: "starting",
    progress_text: "Agent job đang bắt đầu.",
    attempt_count: Number(job.attempt_count || 0) + 1,
    lease_expires_at: leaseExpiresAt,
    updated_at: now
  };
}

async function setAssistantMessageFailed(
  db: D1Database,
  job: JobRow,
  error: string,
  debugSteps?: DebugStep[]
): Promise<void> {
  if (!job.assistant_message_id) return;
  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'failed', error = ?2, debug_steps_json = ?3, updated_at = ?4
     WHERE message_id = ?5 AND user_key = ?6`
  ).bind(
    `Không xử lý được yêu cầu: ${redactSensitiveString(error)}`,
    redactSensitiveString(error),
    toJson(redactSensitiveData(debugSteps ?? [])),
    nowIso(),
    job.assistant_message_id,
    job.user_key
  ).run();
}

async function redactProcessedUserMessage(db: D1Database, job: JobRow): Promise<void> {
  if (!job.user_message_id) return;
  const message = await getMessage(db, job.user_key, job.user_message_id);
  if (!message) return;
  const redacted = redactSensitiveString(message.content);
  if (redacted === message.content) return;
  await db.prepare(
    `UPDATE messages SET content = ?1, updated_at = ?2 WHERE message_id = ?3 AND user_key = ?4`
  ).bind(redacted, nowIso(), job.user_message_id, job.user_key).run();
}

function truncateMessageContent(content: string): string {
  return sanitizeHistoryContentForModel(content).slice(0, MAX_HISTORY_CONTENT_CHARS);
}

async function buildAgentHistory(db: D1Database, job: JobRow): Promise<AIMessage[]> {
  const currentUserMessage = job.user_message_id
    ? await getMessage(db, job.user_key, job.user_message_id)
    : null;
  const cutoff = currentUserMessage?.created_at ?? nowIso();
  const result = await db.prepare(
    `SELECT * FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2
       AND status = 'completed'
       AND content <> ''
       AND created_at < ?3
     ORDER BY created_at DESC LIMIT ?4`
  ).bind(job.conversation_id, job.user_key, cutoff, MAX_HISTORY_MESSAGES).all<MessageRow>();

  const messages = [...(result.results ?? [])]
    .reverse()
    .filter(message => message.role === "user" || message.role === "assistant")
    .map(message => ({
      role: message.role,
      content: truncateMessageContent(message.content)
    } satisfies AIMessage));

  const pendingAction = await db.prepare(
    `SELECT * FROM pending_actions
     WHERE conversation_id = ?1 AND user_key = ?2 AND status = 'waiting_confirmation'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(job.conversation_id, job.user_key).first<PendingActionRow>();

  if (pendingAction?.plan_id && !messages.some(message => message.content.includes(pendingAction.plan_id))) {
    return [
      {
        role: "assistant",
        content: `Trạng thái App Builder: có pending plan đang chờ xác nhận bằng nút UI. Plan ID: ${pendingAction.plan_id}.`
      },
      ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))
    ];
  }

  return messages;
}

async function updateConversationActionState(
  db: D1Database,
  job: JobRow,
  actionState: AgentActionState | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!actionState) return undefined;

  if (
    actionState.kind === "prepare_change"
    && actionState.valid !== false
    && actionState.requires_confirmation
    && actionState.plan_id
  ) {
    const now = nowIso();
    const pendingAction: PendingActionRow = {
      action_id: `act_${crypto.randomUUID()}`,
      conversation_id: job.conversation_id,
      user_key: job.user_key,
      job_id: job.job_id,
      assistant_message_id: job.assistant_message_id,
      plan_id: actionState.plan_id,
      status: "waiting_confirmation",
      payload_json: toJson(redactSensitiveData(actionState)),
      created_at: now,
      updated_at: now,
      expires_at: addSeconds(new Date(), 60 * 30)
    };

    await db.batch([
      db.prepare(
        `UPDATE pending_actions
         SET status = 'cancelled', updated_at = ?1
         WHERE conversation_id = ?2 AND user_key = ?3 AND status = 'waiting_confirmation'`
      ).bind(now, job.conversation_id, job.user_key),
      db.prepare(
        `INSERT INTO pending_actions (
          action_id, conversation_id, user_key, job_id, assistant_message_id, plan_id, status,
          payload_json, created_at, updated_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      ).bind(
        pendingAction.action_id,
        pendingAction.conversation_id,
        pendingAction.user_key,
        pendingAction.job_id,
        pendingAction.assistant_message_id,
        pendingAction.plan_id,
        pendingAction.status,
        pendingAction.payload_json,
        pendingAction.created_at,
        pendingAction.updated_at,
        pendingAction.expires_at
      )
    ]);

    return serializePendingAction(pendingAction);
  }

  if (actionState.kind === "apply_change" && actionState.plan_id) {
    await db.prepare(
      `UPDATE pending_actions
       SET status = ?1, updated_at = ?2
       WHERE user_key = ?3 AND plan_id = ?4 AND status IN ('waiting_confirmation', 'confirmed')`
    ).bind(actionState.ok ? "applied" : "failed", nowIso(), job.user_key, actionState.plan_id).run();
  }

  return undefined;
}

function responseStatus(actionState: AgentActionState | undefined): string {
  if (!actionState) return "ok";
  if (actionState.kind === "prepare_change" && actionState.requires_confirmation && actionState.valid !== false) {
    return "needs_confirmation";
  }
  if (actionState.kind === "apply_change") {
    return actionState.ok ? "completed" : "action_failed";
  }
  if (actionState.valid === false) return "invalid_plan";
  return actionState.status ?? "ok";
}

async function dispatchJob(env: Env, ctx: ExecutionContext | undefined, jobId: string): Promise<"queue" | "waitUntil" | "manual"> {
  const message: AgentJobQueueMessage = { job_id: jobId };
  if (env.AGENT_JOBS) {
    await env.AGENT_JOBS.send(message);
    return "queue";
  }
  if (ctx) {
    ctx.waitUntil(runConversationJob(env, jobId));
    return "waitUntil";
  }
  return "manual";
}

async function failJob(db: D1Database, job: JobRow, error: unknown, debugSteps?: DebugStep[]): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await redactProcessedUserMessage(db, job);
  await setAssistantMessageFailed(db, job, message, debugSteps);
  await updateJob(db, job, {
    status: "failed",
    stage: "failed",
    progress_text: "Job thất bại.",
    error: message,
    finished_at: nowIso(),
    auth_context_json: null
  });
  await insertJobEvent(db, job, "failed", { error: message });
}

async function scheduleJobRetry(
  db: D1Database,
  env: Env,
  job: JobRow,
  error: unknown
): Promise<boolean> {
  const maxAttempts = Math.max(1, Number(job.max_attempts || JOB_MAX_ATTEMPTS));
  const attemptCount = Math.max(0, Number(job.attempt_count || 0));
  const queue = env.AGENT_JOBS;
  if (!canScheduleJobRetry({
    error,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
    queue_available: Boolean(queue)
  })) return false;
  if (!queue) return false;

  const message = error instanceof Error ? error.message : String(error);
  await updateJob(db, job, {
    status: "queued",
    stage: "retry_scheduled",
    progress_text: `Lỗi tạm thời; sẽ thử lại (${attemptCount}/${maxAttempts}).`,
    error: null,
    lease_expires_at: null,
    last_error_json: toLimitedJson(redactSensitiveData({
      message,
      retryable: true,
      attempt: attemptCount,
      recorded_at: nowIso()
    }), MAX_JOB_EVENT_PAYLOAD_CHARS)
  });
  await insertJobEvent(db, job, "retry_scheduled", {
    attempt: attemptCount,
    max_attempts: maxAttempts,
    delay_seconds: JOB_RETRY_DELAY_SECONDS,
    error: message
  });
  await queue.send(
    { job_id: job.job_id },
    { delaySeconds: JOB_RETRY_DELAY_SECONDS }
  );
  return true;
}

function buildApplyChangeAnswer(result: Record<string, unknown>): string {
  if (result.ok === true) {
    const verification = asVerificationSummary(result.verification);
    return [
      "Đã thực hiện và kiểm tra xong kế hoạch App Builder.",
      `Plan ID: ${String(result.plan_id ?? "")}`,
      `Số bước đã ghi: ${String(result.applied_count ?? 0)}.`,
      `Số bước đã xác minh: ${String(verification?.passed ?? 0)}.`,
      verification?.caches_checked ? `Cache window đã kiểm tra: ${String(verification.caches_checked)}.` : ""
    ].filter(Boolean).join("\n");
  }

  if (result.requires_new_confirmation === true && result.repair_plan_id) {
    return [
      "Kế hoạch ban đầu chưa đạt đầy đủ postcondition.",
      `Đã xác minh được ${String(asVerificationSummary(result.verification)?.passed ?? 0)} bước.`,
      "Phần sửa tiếp theo cần đổi loại thao tác hoặc mở rộng phạm vi so với kế hoạch đã xác nhận, nên hệ thống chưa tự thực hiện.",
      `Plan sửa mới: ${String(result.repair_plan_id)}.`,
      "Hãy xem các bước của plan mới và bấm xác nhận nếu đồng ý."
    ].join("\n");
  }

  const failed = result.failed_operation && typeof result.failed_operation === "object"
    ? result.failed_operation as Record<string, unknown>
    : null;

  return [
    "Kế hoạch chưa đạt trạng thái hoàn tất đã xác minh.",
    `Đã ghi được: ${String(result.applied_count ?? 0)} bước.`,
    `Số bước lỗi khi ghi: ${String(result.failed_count ?? 0)}.`,
    failed ? `Dừng tại: ${String(failed.operation_id ?? "")}.` : "",
    "",
    `Lỗi chính: ${String(failed?.error ?? result.error ?? verificationError(result.verification) ?? "Không rõ lỗi.")}`,
    "",
    "Hệ thống chưa báo thành công vì postcondition chưa đạt. Phần đã ghi được giữ nguyên để lập residual plan, không apply lại plan cũ."
  ].filter(Boolean).join("\n");
}

function asVerificationSummary(value: unknown): Record<string, unknown> | undefined {
  const report = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  return report?.summary && typeof report.summary === "object"
    ? report.summary as Record<string, unknown>
    : undefined;
}

function verificationError(value: unknown): string | undefined {
  const report = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const results = Array.isArray(report?.operation_results) ? report.operation_results : [];
  const failed = results.find(result =>
    result
    && typeof result === "object"
    && (result as Record<string, unknown>).status !== "passed"
  ) as Record<string, unknown> | undefined;
  return failed?.error ? String(failed.error) : undefined;
}

async function runMessageJob(db: D1Database, env: Env, job: JobRow, state: ZilcodeSessionState): Promise<void> {
  const userMessage = job.user_message_id ? await getMessage(db, job.user_key, job.user_message_id) : null;
  if (!userMessage) throw new Error("Không tìm thấy user message cho job.");

  const payload = safeJsonParse<JobPayload>(job.payload_json, {});
  const debugSteps = payload.debug === true ? [] as DebugStep[] : undefined;
  const history = await buildAgentHistory(db, job);

  addDebugStep(debugSteps, "conversation.history_loaded", "ok", "Worker đã tải history server-side cho conversation job.", {
    conversation_id: job.conversation_id,
    job_id: job.job_id,
    mode: job.mode,
    history_messages: history.length
  });

  await updateJob(db, job, {
    status: "running",
    stage: "agent",
    progress_text: "Agent đang xử lý yêu cầu."
  });
  await insertJobEvent(db, job, "agent_started", { mode: job.mode });

  const initialRunState = await loadAgentRunForJob(db, job);
  const result = await runAgenticLoop(
    userMessage.content,
    env,
    history,
    debugSteps,
    state,
    job.mode,
    {
      run_id: initialRunState?.run_id || `run_${job.job_id}`,
      job_id: job.job_id,
      conversation_id: job.conversation_id,
      user_key: job.user_key,
      initial_state: initialRunState,
      on_state_change: currentState => persistAgentRunState(db, job, currentState)
    }
  );
  await redactProcessedUserMessage(db, job);
  const pendingAction = await updateConversationActionState(db, job, result.action_state);
  const status = responseStatus(result.action_state);
  const now = nowIso();

  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'completed', tools_called_json = ?2, sources_json = ?3,
         debug_steps_json = ?4, action_state_json = ?5, updated_at = ?6
     WHERE message_id = ?7 AND user_key = ?8`
  ).bind(
    result.answer,
    toJson(result.toolsCalled),
    toJson(result.sources ?? []),
    toJson(redactSensitiveData(debugSteps ?? [])),
    toJson(redactSensitiveData(result.action_state)),
    now,
    job.assistant_message_id,
    job.user_key
  ).run();

  const conversation = await db.prepare(
    `SELECT * FROM conversations WHERE conversation_id = ?1 AND user_key = ?2`
  ).bind(job.conversation_id, job.user_key).first<ConversationRow>();
  if (conversation) {
    const title = conversation.title === "Đoạn chat mới"
      ? userMessage.content.slice(0, 80)
      : conversation.title;
    await db.prepare(
      `UPDATE conversations SET title = ?1, updated_at = ?2 WHERE conversation_id = ?3 AND user_key = ?4`
    ).bind(title, now, job.conversation_id, job.user_key).run();
  }

  const finalStatus: JobStatus = pendingAction ? "waiting_confirmation" : "succeeded";
  await updateJob(db, job, {
    status: finalStatus,
    stage: finalStatus,
    progress_text: pendingAction ? "Đang chờ xác nhận kế hoạch." : "Job đã hoàn tất.",
    finished_at: finalStatus === "succeeded" ? now : null,
    auth_context_json: null
  });
  await insertJobEvent(db, job, finalStatus, {
    status,
    answer_chars: result.answer.length,
    tools_called: result.toolsCalled,
    pending_action: pendingAction
  });
}

async function runApplyPendingActionJob(db: D1Database, env: Env, job: JobRow, state: ZilcodeSessionState): Promise<void> {
  const payload = safeJsonParse<JobPayload>(job.payload_json, {});
  const actionId = String(payload.action_id || "");
  const planId = String(payload.plan_id || "");
  if (!actionId || !planId) throw new Error("Job apply thiếu action_id hoặc plan_id.");

  const pendingAction = await db.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, job.user_key).first<PendingActionRow>();
  if (!pendingAction) throw new Error("Không tìm thấy pending action.");
  if (pendingAction.status !== "confirmed") {
    throw new Error(`Pending action không ở trạng thái confirmed: ${pendingAction.status}.`);
  }

  await updateJob(db, job, {
    status: "running",
    stage: "apply_change",
    progress_text: "Đang thực hiện pending App Builder plan."
  });
  await insertJobEvent(db, job, "apply_started", { action_id: actionId, plan_id: planId });

  const debugSteps: DebugStep[] = [];
  addDebugStep(debugSteps, "pending_action.apply", "start", "Bắt đầu apply pending App Builder action.", {
    action_id: actionId,
    plan_id: planId
  });

  const pendingActionPayload = safeJsonParse<Record<string, unknown>>(pendingAction.payload_json, {});
  const confirmedEnvelope = parseApprovedChangeEnvelope(pendingActionPayload.approved_change_envelope);

  let runState = await loadAgentRunByJobId(db, job.user_key, pendingAction.job_id);
  if (!runState) {
    runState = createAgentRunState(`Apply confirmed App Builder plan ${planId}`, {
      run_id: `run_apply_${actionId}`,
      job_id: job.job_id,
      conversation_id: job.conversation_id,
      user_key: job.user_key
    });
    runState.approved_change_envelope = confirmedEnvelope as unknown as Record<string, unknown>
      ?? { plan_id: planId };
    await persistAgentRunState(db, job, runState);
  }

  const approvedEnvelope = confirmedEnvelope
    ?? parseApprovedChangeEnvelope(runState.approved_change_envelope)
    ?? await loadApprovedEnvelopeFromPendingPlan(env, planId);
  if (!approvedEnvelope) {
    throw new Error("Không đọc được approved change envelope từ pending plan; dừng apply để tránh mở rộng phạm vi.");
  }
  runState.approved_change_envelope = approvedEnvelope as unknown as Record<string, unknown>;
  runState.residual_plan_ids = runState.residual_plan_ids ?? [];
  runState.active_plan_id = runState.active_plan_id || planId;
  await persistAgentRunState(db, job, runState);

  const resumePlanId = runState.active_plan_id;
  const resumeJournal = await loadResumeJournalSnapshot(db, runState.run_id, resumePlanId);
  let initialObservation: {
    write_result: Record<string, unknown>;
    verification: AppBuilderVerificationReport;
  } | undefined;
  if (resumeJournal.has_execution_progress) {
    const resumePlan = await loadPendingChangePlan(env, resumePlanId);
    if (!resumePlan) {
      throw new Error(
        `Không thể resume plan ${resumePlanId}: pending plan không còn nhưng journal cho thấy apply đã bắt đầu.`
      );
    }
    await updateJob(db, job, {
      status: "running",
      stage: "resume_observation",
      progress_text: "Đang đối chiếu operation journal với metadata thật trước khi tiếp tục."
    });
    initialObservation = await observePendingPlanForResume(
      db,
      env,
      state,
      runState.run_id,
      resumePlan,
      approvedEnvelope,
      resumeJournal.attempt,
      resumeJournal.verified_operations,
      debugSteps
    );
  }

  const recovery = await runApplyRecovery({
    original_plan_id: planId,
    approved_change_envelope: approvedEnvelope,
    apply_repair_limit: runState.budgets.apply_repair.limit,
    prepare_repair_limit: runState.budgets.prepare_repair.limit,
    initial_apply_repairs: runState.repair_attempts.apply,
    initial_prepare_repairs: runState.repair_attempts.prepare,
    initial_current_plan_id: resumePlanId,
    initial_observation: initialObservation
  }, {
    execute_attempt: async (currentPlanId, applyAttempt, verifiedOperations) => {
      const attemptResult = await executeVerifiedApplyAttempt(
        db,
        env,
        job,
        state,
        runState.run_id,
        currentPlanId,
        applyAttempt,
        debugSteps,
        verifiedOperations
      );
      runState.verification_results = [
        ...runState.verification_results,
        redactSensitiveData({
          attempt: applyAttempt,
          plan_id: currentPlanId,
          report: attemptResult.verification
        }) as Record<string, unknown>
      ];
      runState.updated_at = nowIso();
      await persistAgentRunState(db, job, runState);
      return {
        write_result: attemptResult.writeResult,
        verification: attemptResult.verification
      };
    },
    prepare_plan: async (operations, kind, context) => {
      await updateJob(db, job, {
        status: "running",
        stage: kind === "residual" ? "prepare_residual" : "prepare_scope_expansion",
        progress_text: kind === "residual"
          ? "Đang chuẩn bị residual plan cho phần chưa đạt postcondition."
          : "Đang chuẩn bị plan mở rộng để yêu cầu xác nhận lại."
      });
      addDebugStep(debugSteps, `pending_action.${kind}_prepare`, "start", "Chuẩn bị repair plan mới.", {
        operation_count: operations.length,
        ...context
      });
      const prepared = await runAppBuilderWriteTool(
        env,
        state.session,
        "app_builder_prepare_change",
        {
          intent: `${kind}_repair:${planId}`,
          user_summary: kind === "residual"
            ? "Tự sửa phần metadata chưa đạt postcondition trong phạm vi plan đã xác nhận."
            : "Repair thay đổi action/phạm vi nên bắt buộc xác nhận lại.",
          operations
        }
      );
      addDebugStep(
        debugSteps,
        `pending_action.${kind}_prepare`,
        prepared.valid === true ? "ok" : "error",
        prepared.valid === true ? "Đã tạo repair plan mới." : "Repair plan không vượt qua prepare validation.",
        { plan_id: prepared.plan_id, blocking_errors: prepared.blocking_errors }
      );
      return {
        ...prepared,
        valid: prepared.valid === true,
        plan_id: typeof prepared.plan_id === "string" ? prepared.plan_id : undefined
      };
    },
    repair_invalid_prepare: async (operations, blockingErrors, repairAttempt) => {
      await updateJob(db, job, {
        status: "running",
        stage: "repair_invalid_prepare",
        progress_text: `Đang sửa residual plan không hợp lệ (lần ${repairAttempt}).`
      });
      const repaired = await repairInvalidPrepareOperations(env, {
        operations,
        blocking_errors: blockingErrors,
        attempt: repairAttempt
      });
      addDebugStep(
        debugSteps,
        "pending_action.prepare_repair",
        repaired.operations ? "ok" : "error",
        repaired.operations
          ? "Đã tạo đề xuất sửa operation có cấu trúc; backend sẽ kiểm tra lại approved envelope và live schema."
          : "Không thể tự sửa operation mà vẫn giữ nguyên phạm vi đã xác nhận.",
        {
          attempt: repairAttempt,
          model: repaired.model,
          operation_count: repaired.operations?.length ?? 0,
          error: repaired.error
        }
      );
      return repaired.operations;
    },
    on_event: async event => {
      if (event.type === "residual_prepared") {
        runState.repair_attempts.apply = Number(event.attempt ?? runState.repair_attempts.apply + 1);
        runState.budgets.apply_repair.used = runState.repair_attempts.apply;
        runState.terminal_status = "repairing";
        if (event.plan_id) {
          runState.active_plan_id = event.plan_id;
          runState.residual_plan_ids = [...new Set([...(runState.residual_plan_ids ?? []), event.plan_id])];
        }
      }
      if (event.type === "resume_observed") {
        runState.terminal_status = "repairing";
      }
      if (event.type === "prepare_repair_attempt") {
        runState.repair_attempts.prepare = Math.max(
          runState.repair_attempts.prepare,
          Number(event.attempt ?? 0)
        );
        runState.budgets.prepare_repair.used = runState.repair_attempts.prepare;
        runState.terminal_status = "repairing";
      }
      runState.updated_at = nowIso();
      await persistAgentRunState(db, job, runState);
    }
  });

  const finalWriteResult = recovery.final_write_result;
  const recoveryPlanIds = new Set([
    planId,
    resumePlanId,
    recovery.current_plan_id,
    ...(runState.residual_plan_ids ?? [])
  ]);
  const verification = recovery.verification;
  const residualPlanId = recovery.residual_plan_id;
  const scopeExpansionRepair = recovery.repair_plan as Record<string, unknown> | undefined;
  const repairBlockers = recovery.blockers;
  const totalApplied = recovery.totals.applied;
  const totalFailed = recovery.totals.failed;
  const totalSkipped = recovery.totals.skipped;
  const result: Record<string, unknown> = {
    ...finalWriteResult,
    plan_id: planId,
    last_plan_id: recovery.current_plan_id,
    residual_plan_id: residualPlanId,
    ok: verification.ok,
    status: recovery.status,
    verification,
    attempts: recovery.attempts,
    repair_blockers: repairBlockers,
    applied_count: totalApplied,
    failed_count: totalFailed,
    skipped_count: totalSkipped,
    original_apply_status: recovery.attempts[0]?.apply_status
  };
  if (recovery.status === "waiting_confirmation" && scopeExpansionRepair) {
    result.status = "waiting_confirmation";
    result.requires_new_confirmation = true;
    result.repair_plan_id = scopeExpansionRepair.plan_id;
    result.repair_plan = scopeExpansionRepair;
  }

  runState.completed_operations = verification.operation_results
    .filter(item => item.status === "passed")
    .map(item => ({
      operation_id: item.operation_id,
      target: item.target,
      action: item.action,
      reference: item.reference,
      verified_at: nowIso()
    }));
  runState.failed_operation = verification.operation_results
    .find(item => item.status !== "passed") as unknown as Record<string, unknown> | undefined
    ?? repairBlockers[0];
  runState.phase_checkpoints = Object.fromEntries(
    Object.entries(groupVerificationByPhase(verification))
      .map(([phase, ok]) => [phase, ok ? "succeeded" : "verification_failed"])
  );
  runState.repair_attempts.apply = recovery.apply_repairs_used;
  runState.repair_attempts.prepare = recovery.prepare_repairs_used;
  runState.budgets.apply_repair.used = recovery.apply_repairs_used;
  runState.budgets.prepare_repair.used = recovery.prepare_repairs_used;
  runState.terminal_status = verification.ok
    ? "succeeded"
    : scopeExpansionRepair
      ? "waiting_confirmation"
      : "verification_failed";
  if (scopeExpansionRepair) {
    runState.prepared_operations = Array.isArray(scopeExpansionRepair.operations)
      ? scopeExpansionRepair.operations.filter(item => item && typeof item === "object") as Record<string, unknown>[]
      : [];
    runState.approved_change_envelope = scopeExpansionRepair.approved_change_envelope as Record<string, unknown>;
    runState.active_plan_id = typeof scopeExpansionRepair.plan_id === "string"
      ? scopeExpansionRepair.plan_id
      : undefined;
    runState.residual_plan_ids = [];
    runState.repair_attempts.apply = 0;
    runState.budgets.apply_repair.used = 0;
  }
  if (verification.ok) runState.active_plan_id = undefined;
  runState.blocker = verification.ok ? undefined : repairBlockers[0];
  runState.updated_at = nowIso();
  await persistAgentRunState(db, job, runState);

  const supersededPlanIds = new Set(
    [...recoveryPlanIds].filter(candidate => candidate && candidate !== scopeExpansionRepair?.plan_id)
  );
  for (const supersededPlanId of supersededPlanIds) {
    try {
      await deletePendingChangePlan(env, supersededPlanId);
    } catch (error) {
      addDebugStep(debugSteps, "pending_action.plan_cleanup", "error", "Không xóa được pending plan đã dùng.", {
        plan_id: supersededPlanId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const answer = buildApplyChangeAnswer(result);
  const applyActionState: AgentActionState = {
    kind: "apply_change",
    plan_id: typeof result.plan_id === "string" ? result.plan_id : planId,
    status: typeof result.status === "string" ? result.status : undefined,
    ok: verification.ok,
    applied_count: totalApplied,
    failed_count: totalFailed,
    skipped_count: totalSkipped,
    verification_status: verification.status,
    verification_summary: verification.summary,
    residual_plan_id: residualPlanId,
    error: typeof finalWriteResult.error === "string" ? finalWriteResult.error : verificationError(verification),
    updated_at: nowIso()
  };
  let actionState = applyActionState;
  let repairPendingAction: Record<string, unknown> | undefined;
  if (scopeExpansionRepair && typeof scopeExpansionRepair.plan_id === "string") {
    await updateConversationActionState(db, job, applyActionState);
    actionState = {
      kind: "prepare_change",
      plan_id: scopeExpansionRepair.plan_id,
      status: typeof scopeExpansionRepair.status === "string"
        ? scopeExpansionRepair.status
        : "ready_for_confirmation",
      valid: true,
      requires_confirmation: true,
      summary: scopeExpansionRepair.summary,
      operations: scopeExpansionRepair.operations,
      approved_change_envelope: scopeExpansionRepair.approved_change_envelope as Record<string, unknown>,
      updated_at: nowIso()
    };
    repairPendingAction = await updateConversationActionState(db, job, actionState);
  }

  await db.prepare(
    `UPDATE messages
     SET content = ?1, status = 'completed', tools_called_json = ?2, debug_steps_json = ?3,
         action_state_json = ?4, updated_at = ?5
     WHERE message_id = ?6 AND user_key = ?7`
  ).bind(
    answer,
    toJson(["app_builder_apply_change"]),
    toJson(redactSensitiveData(debugSteps)),
    toJson(redactSensitiveData(actionState)),
    nowIso(),
    job.assistant_message_id,
    job.user_key
  ).run();

  if (!scopeExpansionRepair) {
    await updateConversationActionState(db, job, actionState);
  }
  const succeeded = verification.ok;
  const waitingConfirmation = Boolean(scopeExpansionRepair && repairPendingAction);
  await updateJob(db, job, {
    status: succeeded ? "succeeded" : waitingConfirmation ? "waiting_confirmation" : "failed",
    stage: succeeded ? "succeeded" : waitingConfirmation ? "waiting_confirmation" : "failed",
    progress_text: succeeded
      ? "Apply plan đã hoàn tất."
      : waitingConfirmation
        ? "Repair cần mở rộng phạm vi và đang chờ người dùng xác nhận plan mới."
        : "Apply plan thất bại.",
    error: succeeded || waitingConfirmation
      ? null
      : String(finalWriteResult.error ?? verificationError(verification) ?? "Apply plan thất bại."),
    finished_at: succeeded || !waitingConfirmation ? nowIso() : null,
    auth_context_json: null
  });
  await insertJobEvent(db, job, succeeded ? "succeeded" : waitingConfirmation ? "waiting_confirmation" : "failed", {
    action_id: actionId,
    plan_id: planId,
    repair_pending_action: repairPendingAction,
    result: redactSensitiveData(result)
  });
}

async function executeVerifiedApplyAttempt(
  db: D1Database,
  env: Env,
  job: JobRow,
  state: ZilcodeSessionState,
  runId: string,
  planId: string,
  attempt: number,
  debugSteps: DebugStep[],
  verifiedOperations: Record<string, Record<string, unknown>> = {}
): Promise<{ writeResult: Record<string, unknown>; verification: AppBuilderVerificationReport }> {
  await updateJob(db, job, {
    status: "running",
    stage: "apply_change",
    progress_text: attempt === 1
      ? "Đang thực hiện pending App Builder plan."
      : `Đang thực hiện residual repair lần ${attempt - 1}.`
  });
  const writeResult = await runAppBuilderWriteTool(
    env,
    state.session,
    "app_builder_apply_change",
    { plan_id: planId },
    {
      attempt,
      verified_operations: verifiedOperations,
      retain_pending_plan: true,
      on_operation_event: event => persistOperationJournalEvent(db, job, runId, event)
    }
  );
  addDebugStep(debugSteps, "pending_action.apply", "ok", "app_builder_apply_change đã trả kết quả.", {
    attempt,
    ok: writeResult.ok,
    status: writeResult.status,
    plan_id: writeResult.plan_id,
    applied_count: Number(writeResult.applied_count ?? 0),
    failed_count: Number(writeResult.failed_count ?? 0),
    skipped_count: Number(writeResult.skipped_count ?? 0),
    failed_operation: writeResult.failed_operation
  });

  await updateJob(db, job, {
    status: "running",
    stage: "verify_change",
    progress_text: "Đang đọc lại graph và kiểm tra postcondition."
  });
  addDebugStep(debugSteps, "pending_action.verify", "start", "Bắt đầu verify trạng thái thật sau apply.", {
    attempt,
    expected_operations: Array.isArray(writeResult.expected_operations) ? writeResult.expected_operations.length : 0
  });
  const verification = await verifyAppBuilderWriteResult(env, state.session, writeResult);
  await persistVerificationJournal(db, runId, planId, attempt, verification);
  await persistPhaseCheckpoints(db, runId, verification);
  addDebugStep(debugSteps, "pending_action.verify", verification.ok ? "ok" : "error", "Đã hoàn tất postcondition verification.", {
    attempt,
    status: verification.status,
    summary: verification.summary,
    cache_results: verification.cache_results
  });
  return { writeResult, verification };
}

function groupVerificationByPhase(report: AppBuilderVerificationReport): Record<string, boolean> {
  const output: Record<string, boolean> = {};
  for (const result of report.operation_results) {
    const phase = result.phase || "cache_verification";
    output[phase] = (output[phase] ?? true) && result.status === "passed";
  }
  if (report.cache_results.length) {
    output.cache_verification = report.cache_results.every(result => result.status === "passed")
      && (output.cache_verification ?? true);
  }
  return output;
}

export async function runConversationJob(env: Env, jobId: string): Promise<void> {
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) throw new Error("D1 database binding DB chưa được cấu hình.");
  const db = dbOrResponse;

  let job = await getJobAnyOwner(db, jobId);
  if (!job) throw new Error(`Không tìm thấy job ${jobId}.`);
  if (job.status === "running") {
    if (job.lease_expires_at && job.lease_expires_at > nowIso()) {
      throw new ActiveJobLeaseError(job.job_id, job.lease_expires_at);
    }
    await updateJob(db, job, {
      status: "queued",
      stage: "lease_recovered",
      progress_text: "Lease cũ đã hết; job được nhận lại để resume.",
      lease_expires_at: null
    });
    await insertJobEvent(db, job, "lease_recovered", {
      previous_attempts: job.attempt_count,
      previous_lease_expires_at: job.lease_expires_at
    });
    job = { ...job, status: "queued", lease_expires_at: null };
  }
  if (job.status !== "queued") return;

  const authState = safeJsonParse<ZilcodeSessionState | null>(job.auth_context_json, null);
  if (!authState?.session?.token) {
    await failJob(db, job, "Job thiếu auth context hoặc auth context đã bị xóa.");
    return;
  }
  if (job.expires_at && job.expires_at < nowIso()) {
    const message = "Job đã hết hạn trước khi agent kịp xử lý. Hãy gửi lại yêu cầu để tạo job mới.";
    await setAssistantMessageFailed(db, job, message);
    await updateJob(db, job, {
      status: "expired",
      stage: "expired",
      progress_text: "Job đã hết hạn trước khi chạy.",
      error: message,
      finished_at: nowIso(),
      auth_context_json: null
    });
    await insertJobEvent(db, job, "expired", { error: message });
    return;
  }

  const claimedJob = await claimQueuedJob(db, job);
  if (!claimedJob) return;

  try {
    if (claimedJob.kind === "apply_pending_action") {
      await runApplyPendingActionJob(db, env, claimedJob, authState);
    } else {
      await runMessageJob(db, env, claimedJob, authState);
    }
  } catch (error) {
    if (isRetryableJobError(error) && await scheduleJobRetry(db, env, claimedJob, error)) {
      return;
    }
    await failJob(db, claimedJob, error);
  }
}

export async function handleCreateConversation(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const body = await readJsonBody<{ title?: string }>(request);
  const now = nowIso();
  const conversation: ConversationRow = {
    conversation_id: `conv_${crypto.randomUUID()}`,
    user_key: context.owner.user_key,
    userid: context.owner.userid,
    sitecode: context.owner.sitecode,
    roleid: context.owner.roleid || null,
    orgid: context.owner.orgid || "0",
    title: String(body.title || "Đoạn chat mới").trim().slice(0, 120) || "Đoạn chat mới",
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  await dbOrResponse.prepare(
    `INSERT INTO conversations (
      conversation_id, user_key, userid, sitecode, roleid, orgid, title, created_at, updated_at, deleted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)`
  ).bind(
    conversation.conversation_id,
    conversation.user_key,
    conversation.userid,
    conversation.sitecode,
    conversation.roleid,
    conversation.orgid,
    conversation.title,
    conversation.created_at,
    conversation.updated_at
  ).run();

  return jsonResponse({
    success: true,
    conversation: summarizeConversation(conversation)
  });
}

export async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const result = await dbOrResponse.prepare(
    `SELECT
       c.*,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.user_key = c.user_key) AS messages_count
     FROM conversations c
     WHERE c.user_key = ?1 AND c.deleted_at IS NULL
     ORDER BY c.updated_at DESC`
  ).bind(context.owner.user_key).all<ConversationRow & { messages_count: number }>();

  return jsonResponse({
    success: true,
    conversations: (result.results ?? []).map(row => summarizeConversation(row, Number(row.messages_count ?? 0)))
  });
}

export async function handleGetConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const conversation = await getConversation(dbOrResponse, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  const messagesResult = await dbOrResponse.prepare(
    `SELECT * FROM messages
     WHERE conversation_id = ?1 AND user_key = ?2
     ORDER BY created_at ASC LIMIT ?3`
  ).bind(conversationId, context.owner.user_key, MAX_STORED_MESSAGES).all<MessageRow>();
  const pendingAction = await getPendingActionForConversation(dbOrResponse, context.owner, conversationId);

  return jsonResponse({
    success: true,
    conversation: {
      ...summarizeConversation(conversation, messagesResult.results?.length ?? 0, pendingAction),
      messages: (messagesResult.results ?? []).map(serializeMessage),
      pending_action: pendingAction ? serializePendingAction(pendingAction) : undefined
    }
  });
}

export async function handleDeleteConversation(request: Request, env: Env, conversationId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  await dbOrResponse.prepare(
    `UPDATE conversations SET deleted_at = ?1, updated_at = ?1
     WHERE conversation_id = ?2 AND user_key = ?3`
  ).bind(nowIso(), conversationId, context.owner.user_key).run();
  return jsonResponse({ success: true, conversation_id: conversationId });
}

export async function handleConversationMessage(
  request: Request,
  env: Env,
  conversationId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  const conversation = await getConversation(db, context.owner, conversationId);
  if (!conversation) {
    return jsonResponse({ success: false, error: "Không tìm thấy đoạn chat." }, { status: 404 });
  }

  const body = await readJsonBody<{ message?: string; mode?: AgentMode; debug?: boolean; idempotency_key?: string }>(request);
  const message = String(body.message ?? "").trim();
  if (!message) {
    return jsonResponse({ success: false, error: "Bắt buộc phải có trường message." }, { status: 400 });
  }

  const mode = parseAgentMode(body.mode);
  if (!mode) {
    return jsonResponse({ success: false, error: "Mode không hợp lệ. Chỉ hỗ trợ: default, search." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") || String(body.idempotency_key || "").trim() || null;
  if (idempotencyKey) {
    const existing = await db.prepare(
      `SELECT * FROM jobs
       WHERE conversation_id = ?1 AND user_key = ?2 AND idempotency_key = ?3
       ORDER BY created_at DESC LIMIT 1`
    ).bind(conversationId, context.owner.user_key, idempotencyKey).first<JobRow>();
    if (existing) {
      const events = await listJobEvents(db, context.owner.user_key, existing.job_id);
      return jsonResponse({
        success: true,
        status: existing.status,
        conversation_id: conversationId,
        user_message_id: existing.user_message_id,
        assistant_message_id: existing.assistant_message_id,
        job_id: existing.job_id,
        job: serializeJob(existing, events),
        idempotent_replay: true
      }, { status: 202 });
    }
  }

  const activeJob = await getActiveConversationJob(db, context.owner.user_key, conversationId);
  if (activeJob) {
    return jsonResponse({
      success: false,
      error: "Đoạn chat đang có job chạy. Hãy chờ job hiện tại hoàn tất rồi gửi tiếp.",
      active_job: serializeJob(activeJob)
    }, { status: 409 });
  }
  const now = nowIso();
  const userMessageId = `msg_${crypto.randomUUID()}`;
  const assistantMessageId = `msg_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  const expiresAt = addSeconds(new Date(), JOB_AUTH_TTL_SECONDS);

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO messages (
          message_id, conversation_id, user_key, role, content, status, mode,
          tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'user', ?4, 'completed', ?5, NULL, NULL, NULL, NULL, NULL, ?6, ?6)`
      ).bind(userMessageId, conversationId, context.owner.user_key, message, mode, now),
      db.prepare(
        `INSERT INTO messages (
          message_id, conversation_id, user_key, role, content, status, mode,
          tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'assistant', '', 'generating', ?4, NULL, NULL, NULL, NULL, NULL, ?5, ?5)`
      ).bind(assistantMessageId, conversationId, context.owner.user_key, mode, now),
      db.prepare(
        `INSERT INTO jobs (
          job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind, mode, status,
          stage, progress_text, error, idempotency_key, auth_context_json, payload_json,
          created_at, updated_at, finished_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'message', ?6, 'queued',
          'queued', 'Job đã được đưa vào hàng chờ.', NULL, ?7, ?8, ?9,
          ?10, ?10, NULL, ?11)`
      ).bind(
        jobId,
        conversationId,
        context.owner.user_key,
        userMessageId,
        assistantMessageId,
        mode,
        idempotencyKey,
        toJson(context.state),
        toJson({ message, debug: body.debug === true } satisfies JobPayload),
        now,
        expiresAt
      ),
      db.prepare(
        `UPDATE conversations SET updated_at = ?1 WHERE conversation_id = ?2 AND user_key = ?3`
      ).bind(now, conversationId, context.owner.user_key)
    ]);
  } catch (error) {
    const racedActiveJob = await getActiveConversationJob(db, context.owner.user_key, conversationId);
    if (racedActiveJob) {
      return jsonResponse({
        success: false,
        error: "Đoạn chat đang có job chạy. Hãy chờ job hiện tại hoàn tất rồi gửi tiếp.",
        active_job: serializeJob(racedActiveJob)
      }, { status: 409 });
    }
    throw error;
  }

  const dispatch = await dispatchJob(env, ctx, jobId);
  await insertJobEvent(db, { job_id: jobId, user_key: context.owner.user_key }, "queued", { dispatch });

  return jsonResponse({
    success: true,
    status: "queued",
    conversation_id: conversationId,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    job_id: jobId,
    dispatch
  }, { status: 202 });
}

export async function handleGetJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const job = await getJob(dbOrResponse, context.owner.user_key, jobId);
  if (!job) {
    return jsonResponse({ success: false, error: "Không tìm thấy job." }, { status: 404 });
  }

  const events = await listJobEvents(dbOrResponse, context.owner.user_key, jobId);
  const assistantMessage = job.assistant_message_id
    ? await getMessage(dbOrResponse, context.owner.user_key, job.assistant_message_id)
    : null;

  return jsonResponse({
    success: true,
    job: serializeJob(job, events),
    message: assistantMessage ? serializeMessage(assistantMessage) : null
  });
}

export async function handleGetJobEvents(request: Request, env: Env, jobId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const job = await getJob(dbOrResponse, context.owner.user_key, jobId);
  if (!job) {
    return jsonResponse({ success: false, error: "Không tìm thấy job." }, { status: 404 });
  }

  return jsonResponse({
    success: true,
    job_id: jobId,
    events: (await listJobEvents(dbOrResponse, context.owner.user_key, jobId)).map(event => ({
      event_id: event.event_id,
      seq: event.seq,
      type: event.type,
      payload: safeJsonParse<Record<string, unknown> | null>(event.payload_json, null),
      created_at: event.created_at
    }))
  });
}

export async function handleConfirmPendingAction(
  request: Request,
  env: Env,
  actionId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  const action = await db.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, context.owner.user_key).first<PendingActionRow>();
  if (!action) {
    return jsonResponse({ success: false, error: "Không tìm thấy pending action." }, { status: 404 });
  }
  if (action.status !== "waiting_confirmation") {
    return jsonResponse({ success: false, error: `Pending action không thể xác nhận ở trạng thái ${action.status}.` }, { status: 409 });
  }

  const now = nowIso();
  const userMessageId = `msg_${crypto.randomUUID()}`;
  const assistantMessageId = `msg_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  if (action.expires_at && action.expires_at < nowIso()) {
    const expiredAt = nowIso();
    await db.prepare(
      `UPDATE pending_actions SET status = 'expired', updated_at = ?1 WHERE action_id = ?2 AND user_key = ?3`
    ).bind(expiredAt, actionId, context.owner.user_key).run();
    return jsonResponse({ success: false, error: "Pending action đã hết hạn, hãy tạo lại kế hoạch." }, { status: 409 });
  }

  const activeJob = await getActiveConversationJob(db, context.owner.user_key, action.conversation_id);
  if (activeJob) {
    return jsonResponse({
      success: false,
      error: "Đoạn chat đang có job chạy. Hãy chờ job hiện tại hoàn tất rồi xác nhận lại.",
      active_job: serializeJob(activeJob)
    }, { status: 409 });
  }

  const userContent = `Xác nhận thực hiện kế hoạch App Builder ${action.plan_id}.`;

  const claimed = await db.prepare(
    `UPDATE pending_actions
     SET status = 'confirmed', updated_at = ?1
     WHERE action_id = ?2 AND user_key = ?3 AND status = 'waiting_confirmation'`
  ).bind(now, actionId, context.owner.user_key).run();
  if (Number(claimed.meta?.changes ?? 0) < 1) {
    return jsonResponse({
      success: false,
      error: "Pending action đã được xử lý bởi request khác. Hãy tải lại đoạn chat để xem trạng thái mới nhất."
    }, { status: 409 });
  }

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO messages (
          message_id, conversation_id, user_key, role, content, status, mode,
          tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'user', ?4, 'completed', 'default', NULL, NULL, NULL, NULL, NULL, ?5, ?5)`
      ).bind(userMessageId, action.conversation_id, context.owner.user_key, userContent, now),
      db.prepare(
        `INSERT INTO messages (
          message_id, conversation_id, user_key, role, content, status, mode,
          tools_called_json, sources_json, debug_steps_json, action_state_json, error, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'assistant', '', 'generating', 'default', NULL, NULL, NULL, NULL, NULL, ?4, ?4)`
      ).bind(assistantMessageId, action.conversation_id, context.owner.user_key, now),
      db.prepare(
        `INSERT INTO jobs (
          job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind, mode, status,
          stage, progress_text, error, idempotency_key, auth_context_json, payload_json,
          created_at, updated_at, finished_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'apply_pending_action', 'default', 'queued',
          'queued', 'Job apply plan đã được đưa vào hàng chờ.', NULL, NULL, ?6, ?7,
          ?8, ?8, NULL, ?9)`
      ).bind(
        jobId,
        action.conversation_id,
        context.owner.user_key,
        userMessageId,
        assistantMessageId,
        toJson(context.state),
        toJson({ action_id: actionId, plan_id: action.plan_id } satisfies JobPayload),
        now,
        addSeconds(new Date(), JOB_AUTH_TTL_SECONDS)
      ),
      db.prepare(
        `UPDATE conversations SET updated_at = ?1 WHERE conversation_id = ?2 AND user_key = ?3`
      ).bind(now, action.conversation_id, context.owner.user_key)
    ]);
  } catch (error) {
    await db.prepare(
      `UPDATE pending_actions
       SET status = 'waiting_confirmation', updated_at = ?1
       WHERE action_id = ?2 AND user_key = ?3 AND status = 'confirmed'`
    ).bind(nowIso(), actionId, context.owner.user_key).run();
    const racedActiveJob = await getActiveConversationJob(db, context.owner.user_key, action.conversation_id);
    if (racedActiveJob) {
      return jsonResponse({
        success: false,
        error: "Đoạn chat đang có job chạy. Hãy chờ job hiện tại hoàn tất rồi xác nhận lại.",
        active_job: serializeJob(racedActiveJob)
      }, { status: 409 });
    }
    throw error;
  }

  const dispatch = await dispatchJob(env, ctx, jobId);
  await insertJobEvent(db, { job_id: jobId, user_key: context.owner.user_key }, "queued", { dispatch, action_id: actionId });

  return jsonResponse({
    success: true,
    status: "queued",
    action_id: actionId,
    plan_id: action.plan_id,
    conversation_id: action.conversation_id,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    job_id: jobId,
    dispatch
  }, { status: 202 });
}

export async function handleCancelPendingAction(request: Request, env: Env, actionId: string): Promise<Response> {
  const context = requireZilcodeContext(request, env);
  if (context instanceof Response) return context;
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;

  const action = await dbOrResponse.prepare(
    `SELECT * FROM pending_actions WHERE action_id = ?1 AND user_key = ?2`
  ).bind(actionId, context.owner.user_key).first<PendingActionRow>();
  if (!action) {
    return jsonResponse({ success: false, error: "Không tìm thấy pending action." }, { status: 404 });
  }
  if (action.status !== "waiting_confirmation") {
    return jsonResponse({ success: false, error: `Pending action không thể hủy ở trạng thái ${action.status}.` }, { status: 409 });
  }

  const cancelled = await dbOrResponse.prepare(
    `UPDATE pending_actions
     SET status = 'cancelled', updated_at = ?1
     WHERE action_id = ?2 AND user_key = ?3 AND status = 'waiting_confirmation'`
  ).bind(nowIso(), actionId, context.owner.user_key).run();
  if (Number(cancelled.meta?.changes ?? 0) < 1) {
    return jsonResponse({
      success: false,
      error: "Pending action đã được xử lý bởi request khác. Hãy tải lại đoạn chat để xem trạng thái mới nhất."
    }, { status: 409 });
  }

  return jsonResponse({
    success: true,
    action_id: actionId,
    status: "cancelled"
  });
}

export async function cleanupConversationJobs(env: Env): Promise<Record<string, number>> {
  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) {
    throw new Error("D1 database binding DB chưa được cấu hình.");
  }

  const db = dbOrResponse;
  const now = nowIso();
  const staleRunningBefore = addSeconds(new Date(), -RUNNING_JOB_STALE_SECONDS);
  const expiredJobs = await db.prepare(
    `SELECT * FROM jobs
     WHERE (
       status = 'queued' AND expires_at IS NOT NULL AND expires_at < ?1
     ) OR (
       status = 'running' AND (
         (lease_expires_at IS NOT NULL AND lease_expires_at < ?1)
         OR updated_at < ?2
       )
     )
     LIMIT 100`
  ).bind(now, staleRunningBefore).all<JobRow>();

  let jobsExpired = 0;
  let jobsRetried = 0;
  for (const job of expiredJobs.results ?? []) {
    if (job.status === "running" && await scheduleJobRetry(
      db,
      env,
      job,
      new Error("Worker lease hết hạn trước khi job hoàn tất.")
    )) {
      jobsRetried += 1;
      continue;
    }
    const message = "Job đã hết hạn trước khi agent kịp xử lý. Hãy gửi lại yêu cầu để tạo job mới.";
    await setAssistantMessageFailed(db, job, message);
    await updateJob(db, job, {
      status: "expired",
      stage: "expired",
      progress_text: message,
      error: message,
      finished_at: now,
      auth_context_json: null
    });
    await insertJobEvent(db, job, "expired", { cleanup: true, error: message });
    jobsExpired++;
  }

  const expiredActions = await db.prepare(
    `UPDATE pending_actions
     SET status = 'expired', updated_at = ?1
     WHERE status = 'waiting_confirmation' AND expires_at IS NOT NULL AND expires_at < ?1`
  ).bind(now).run();

  const eventsDeleted = await db.prepare(
    `DELETE FROM job_events WHERE created_at < ?1`
  ).bind(addDays(new Date(), -JOB_EVENT_RETENTION_DAYS)).run();

  return {
    jobs_retried: jobsRetried,
    jobs_expired: jobsExpired,
    pending_actions_expired: Number(expiredActions.meta?.changes ?? 0),
    job_events_deleted: Number(eventsDeleted.meta?.changes ?? 0)
  };
}
