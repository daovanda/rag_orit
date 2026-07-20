import type { ApprovedChangeEnvelope } from "./app-builder-envelope";
import { buildResidualPlan, validateResidualScope } from "./app-builder-residual";
import type {
  AppBuilderVerificationReport,
  OperationVerificationResult
} from "./app-builder-verification";

export interface RecoveryAttemptResult {
  write_result: Record<string, unknown>;
  verification: AppBuilderVerificationReport;
}

export interface RecoveryPreparedPlan {
  valid: boolean;
  plan_id?: string;
  operations?: unknown;
  approved_change_envelope?: unknown;
  blocking_errors?: unknown;
  [key: string]: unknown;
}

export interface RecoveryEvent {
  type:
    | "attempt_completed"
    | "resume_observed"
    | "prepare_repair_attempt"
    | "residual_prepared"
    | "scope_expansion_prepared"
    | "blocked";
  attempt?: number;
  plan_id?: string;
  payload?: Record<string, unknown>;
}

export interface ApplyRecoveryDependencies {
  execute_attempt: (
    planId: string,
    attempt: number,
    verifiedOperations: Record<string, Record<string, unknown>>
  ) => Promise<RecoveryAttemptResult>;
  prepare_plan: (
    operations: Array<Record<string, unknown>>,
    kind: "residual" | "scope_expansion",
    context: Record<string, unknown>
  ) => Promise<RecoveryPreparedPlan>;
  repair_invalid_prepare?: (
    operations: Array<Record<string, unknown>>,
    blockingErrors: unknown,
    attempt: number
  ) => Promise<Array<Record<string, unknown>> | undefined>;
  on_event?: (event: RecoveryEvent) => void | Promise<void>;
}

export interface ApplyRecoveryOptions {
  original_plan_id: string;
  approved_change_envelope: ApprovedChangeEnvelope;
  apply_repair_limit?: number;
  prepare_repair_limit?: number;
  initial_apply_repairs?: number;
  initial_prepare_repairs?: number;
  initial_current_plan_id?: string;
  initial_observation?: RecoveryAttemptResult;
}

export interface ApplyRecoveryResult {
  ok: boolean;
  status: "verified" | "verification_failed" | "waiting_confirmation";
  original_plan_id: string;
  current_plan_id: string;
  residual_plan_id?: string;
  repair_plan?: RecoveryPreparedPlan;
  final_write_result: Record<string, unknown>;
  verification: AppBuilderVerificationReport;
  attempts: Array<Record<string, unknown>>;
  blockers: Array<Record<string, unknown>>;
  apply_repairs_used: number;
  prepare_repairs_used: number;
  totals: {
    applied: number;
    failed: number;
    skipped: number;
  };
}

export async function runApplyRecovery(
  options: ApplyRecoveryOptions,
  dependencies: ApplyRecoveryDependencies
): Promise<ApplyRecoveryResult> {
  const operationVerification = new Map<string, OperationVerificationResult>();
  const cacheVerification = new Map<string, AppBuilderVerificationReport["cache_results"][number]>();
  const expectedOperationIds = options.approved_change_envelope.operations
    .map(operation => operation.operation_id);
  const applyRepairLimit = Math.max(0, options.apply_repair_limit ?? 2);
  const prepareRepairLimit = Math.max(0, options.prepare_repair_limit ?? 3);
  let applyRepairsUsed = Math.max(0, options.initial_apply_repairs ?? 0);
  let prepareRepairsUsed = Math.max(0, options.initial_prepare_repairs ?? 0);
  let currentPlanId = options.initial_current_plan_id ?? options.original_plan_id;
  let residualPlanId: string | undefined;
  let finalWriteResult: Record<string, unknown> = {};
  let verification = aggregateRecoveryVerification(operationVerification, cacheVerification, expectedOperationIds);
  let blockers: Array<Record<string, unknown>> = [];
  let repairPlan: RecoveryPreparedPlan | undefined;
  const attempts: Array<Record<string, unknown>> = [];
  const totals = { applied: 0, failed: 0, skipped: 0 };

  if (options.initial_observation) {
    finalWriteResult = options.initial_observation.write_result;
    options.initial_observation.verification.operation_results
      .forEach(item => operationVerification.set(item.operation_id, item));
    options.initial_observation.verification.cache_results
      .forEach(item => cacheVerification.set(item.windowid, item));
    verification = aggregateRecoveryVerification(operationVerification, cacheVerification, expectedOperationIds);
    const resumeSummary = {
      plan_id: currentPlanId,
      verification_status: verification.status,
      verification_summary: verification.summary
    };
    attempts.push({ resume_observation: true, ...resumeSummary });
    await dependencies.on_event?.({
      type: "resume_observed",
      plan_id: currentPlanId,
      payload: resumeSummary
    });
    if (verification.ok) return buildResult("verified");
    const resumeDecision = await advanceAfterFailedVerification(
      finalWriteResult,
      options.initial_observation.verification
    );
    if (resumeDecision === "waiting_confirmation") return buildResult("waiting_confirmation");
    if (resumeDecision === "blocked") return buildResult("verification_failed");
  }

  while (true) {
    const attempt = applyRepairsUsed + 1;
    const verifiedOperations = aggregateVerifiedReferences(operationVerification);
    const result = await dependencies.execute_attempt(currentPlanId, attempt, verifiedOperations);
    finalWriteResult = result.write_result;
    totals.applied += Number(finalWriteResult.applied_count ?? 0);
    totals.failed += Number(finalWriteResult.failed_count ?? 0);
    totals.skipped += Number(finalWriteResult.skipped_count ?? 0);

    result.verification.operation_results.forEach(item => operationVerification.set(item.operation_id, item));
    result.verification.cache_results.forEach(item => cacheVerification.set(item.windowid, item));
    verification = aggregateRecoveryVerification(operationVerification, cacheVerification, expectedOperationIds);
    const attemptSummary = {
      attempt,
      plan_id: currentPlanId,
      apply_status: finalWriteResult.status,
      verification_status: result.verification.status,
      verification_summary: result.verification.summary
    };
    attempts.push(attemptSummary);
    await dependencies.on_event?.({
      type: "attempt_completed",
      attempt,
      plan_id: currentPlanId,
      payload: attemptSummary
    });

    if (verification.ok) break;
    const decision = await advanceAfterFailedVerification(finalWriteResult, result.verification);
    if (decision === "waiting_confirmation") return buildResult("waiting_confirmation");
    if (decision === "blocked") break;
  }

  return buildResult(verification.ok ? "verified" : "verification_failed");

  async function advanceAfterFailedVerification(
    writeResult: Record<string, unknown>,
    attemptVerification: AppBuilderVerificationReport
  ): Promise<"continue" | "blocked" | "waiting_confirmation"> {
    if (applyRepairsUsed >= applyRepairLimit) {
      blockers = [{
        code: "apply_repair_budget_exhausted",
        used: applyRepairsUsed,
        limit: applyRepairLimit,
        repair_hint: "Dừng tự động và yêu cầu người dùng xem postcondition còn thiếu."
      }];
      await dependencies.on_event?.({ type: "blocked", payload: { blockers } });
      return "blocked";
    }

    const residual = buildResidualPlan(writeResult, attemptVerification, options.approved_change_envelope);
    if (residual.requires_new_confirmation) {
      blockers = residual.blockers;
      if (residual.confirmation_required_operations.length) {
        repairPlan = await prepareWithRepair(
          residual.confirmation_required_operations,
          "scope_expansion",
          {
            original_plan_id: options.original_plan_id,
            current_plan_id: currentPlanId,
            blockers
          },
          dependencies,
          options.approved_change_envelope,
          prepareRepairLimit,
          value => { prepareRepairsUsed = value; },
          prepareRepairsUsed
        );
        if (repairPlan.valid && repairPlan.plan_id) {
          await dependencies.on_event?.({
            type: "scope_expansion_prepared",
            plan_id: repairPlan.plan_id,
            payload: { blockers, operations: residual.confirmation_required_operations }
          });
          return "waiting_confirmation";
        }
        blockers.push({
          code: "scope_expansion_prepare_invalid",
          blocking_errors: repairPlan.blocking_errors,
          repair_hint: "Cần bổ sung dữ liệu bắt buộc trước khi có thể yêu cầu xác nhận plan mở rộng."
        });
      }
      await dependencies.on_event?.({ type: "blocked", payload: { blockers } });
      return "blocked";
    }

    if (!residual.valid || !residual.within_approved_envelope) {
      blockers = residual.blockers;
      await dependencies.on_event?.({ type: "blocked", payload: { blockers } });
      return "blocked";
    }

    const prepared = await prepareWithRepair(
      residual.operations,
      "residual",
      {
        original_plan_id: options.original_plan_id,
        previous_plan_id: currentPlanId,
        operation_ids: residual.residual_operation_ids
      },
      dependencies,
      options.approved_change_envelope,
      prepareRepairLimit,
      value => { prepareRepairsUsed = value; },
      prepareRepairsUsed
    );
    if (!prepared.valid || !prepared.plan_id) {
      blockers = [{
        code: "residual_prepare_invalid",
        blocking_errors: prepared.blocking_errors,
        repair_hint: "Không apply lại plan cũ; dừng với structured blocking_errors."
      }];
      await dependencies.on_event?.({ type: "blocked", payload: { blockers } });
      return "blocked";
    }
    if (prepared.plan_id === currentPlanId) {
      blockers = [{
        code: "residual_plan_reused",
        plan_id: currentPlanId,
        repair_hint: "Residual repair bắt buộc dùng plan_id mới."
      }];
      await dependencies.on_event?.({ type: "blocked", payload: { blockers } });
      return "blocked";
    }

    residualPlanId = prepared.plan_id;
    currentPlanId = prepared.plan_id;
    applyRepairsUsed += 1;
    await dependencies.on_event?.({
      type: "residual_prepared",
      attempt: applyRepairsUsed,
      plan_id: currentPlanId,
      payload: { operation_ids: residual.residual_operation_ids }
    });
    return "continue";
  }

  function buildResult(status: ApplyRecoveryResult["status"]): ApplyRecoveryResult {
    return {
      ok: status === "verified",
      status,
      original_plan_id: options.original_plan_id,
      current_plan_id: currentPlanId,
      residual_plan_id: residualPlanId,
      repair_plan: repairPlan,
      final_write_result: finalWriteResult,
      verification,
      attempts,
      blockers,
      apply_repairs_used: applyRepairsUsed,
      prepare_repairs_used: prepareRepairsUsed,
      totals
    };
  }
}

async function prepareWithRepair(
  initialOperations: Array<Record<string, unknown>>,
  kind: "residual" | "scope_expansion",
  context: Record<string, unknown>,
  dependencies: ApplyRecoveryDependencies,
  approvedEnvelope: ApprovedChangeEnvelope,
  repairLimit: number,
  setRepairsUsed: (value: number) => void,
  initialRepairsUsed: number
): Promise<RecoveryPreparedPlan> {
  let operations = initialOperations;
  let repairsUsed = initialRepairsUsed;
  while (true) {
    if (kind === "residual") {
      const scopeErrors = validateResidualScope(operations, approvedEnvelope);
      if (scopeErrors.length) {
        setRepairsUsed(repairsUsed);
        return {
          valid: false,
          blocking_errors: scopeErrors,
          error: "Residual repair vượt approved change envelope."
        };
      }
    }
    const prepared = await dependencies.prepare_plan(operations, kind, context);
    if (prepared.valid || !dependencies.repair_invalid_prepare || repairsUsed >= repairLimit) {
      setRepairsUsed(repairsUsed);
      return prepared;
    }
    repairsUsed += 1;
    await dependencies.on_event?.({
      type: "prepare_repair_attempt",
      attempt: repairsUsed,
      payload: { kind }
    });
    const repaired = await dependencies.repair_invalid_prepare(
      operations,
      prepared.blocking_errors,
      repairsUsed
    );
    if (!repaired?.length) {
      setRepairsUsed(repairsUsed);
      return prepared;
    }
    operations = repaired;
  }
}

export function aggregateRecoveryVerification(
  operationResults: Map<string, OperationVerificationResult>,
  cacheResults: Map<string, AppBuilderVerificationReport["cache_results"][number]>,
  expectedOperationIds: string[]
): AppBuilderVerificationReport {
  const results = expectedOperationIds.map(operationId =>
    operationResults.get(operationId) ?? {
      operation_id: operationId,
      target: "unknown",
      action: "create" as const,
      status: "inconclusive" as const,
      observed_state: "unknown" as const,
      mismatches: [],
      relations_checked: [],
      error: "Chưa có verification result cho operation trong confirmed plan."
    }
  );
  const caches = [...cacheResults.values()];
  const failed = results.filter(result => result.status === "failed");
  const inconclusive = results.filter(result => result.status === "inconclusive");
  const passed = results.filter(result => result.status === "passed");
  const cacheFailed = caches.some(result => result.status !== "passed");
  const ok = expectedOperationIds.length > 0
    && passed.length === expectedOperationIds.length
    && !cacheFailed;

  return {
    ok,
    status: ok ? "verified" : "verification_failed",
    operation_results: results,
    cache_results: caches,
    verified_operations: aggregateVerifiedReferences(operationResults),
    unverified_operation_ids: results.filter(result => result.status !== "passed").map(result => result.operation_id),
    failed_operation_ids: failed.map(result => result.operation_id),
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      inconclusive: inconclusive.length,
      caches_checked: caches.length
    }
  };
}

function aggregateVerifiedReferences(
  operationResults: Map<string, OperationVerificationResult>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    [...operationResults.values()]
      .filter(result => result.status === "passed")
      .map(result => [result.operation_id, result.reference ?? result.actual_record ?? {}])
  );
}
