import { describe, expect, it, vi } from "vitest";
import { buildApprovedChangeEnvelope } from "../src/app-builder-envelope";
import { runApplyRecovery } from "../src/app-builder-recovery";
import type {
  AppBuilderVerificationReport,
  ExpectedWriteOperation,
  OperationVerificationResult
} from "../src/app-builder-verification";

function operation(overrides: Partial<ExpectedWriteOperation> & Pick<ExpectedWriteOperation, "operation_id" | "target">): ExpectedWriteOperation {
  return {
    action: "create",
    collection: `${overrides.target}s`,
    record: {},
    ...overrides
  };
}

function verification(results: OperationVerificationResult[]): AppBuilderVerificationReport {
  const passed = results.filter(result => result.status === "passed");
  const failed = results.filter(result => result.status === "failed");
  const inconclusive = results.filter(result => result.status === "inconclusive");
  return {
    ok: failed.length === 0 && inconclusive.length === 0,
    status: failed.length || inconclusive.length ? "verification_failed" : "verified",
    operation_results: results,
    cache_results: [],
    verified_operations: Object.fromEntries(
      passed.map(result => [result.operation_id, result.reference ?? result.actual_record ?? {}])
    ),
    unverified_operation_ids: results.filter(result => result.status !== "passed").map(result => result.operation_id),
    failed_operation_ids: failed.map(result => result.operation_id),
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      inconclusive: inconclusive.length,
      caches_checked: 0
    }
  };
}

function result(
  expected: ExpectedWriteOperation[],
  operationResults: OperationVerificationResult[],
  status = "success"
) {
  return {
    write_result: {
      ok: status === "success",
      status,
      expected_operations: expected,
      applied_count: status === "success" ? expected.length : 0,
      failed_count: status === "success" ? 0 : 1,
      skipped_count: 0
    },
    verification: verification(operationResults)
  };
}

function passed(expected: ExpectedWriteOperation, reference: Record<string, unknown>): OperationVerificationResult {
  return {
    operation_id: expected.operation_id,
    target: expected.target,
    action: expected.action,
    phase: expected.phase,
    status: "passed",
    observed_state: expected.action === "delete" ? "absent" : "present",
    reference,
    actual_record: reference,
    mismatches: [],
    relations_checked: []
  };
}

function absent(expected: ExpectedWriteOperation): OperationVerificationResult {
  return {
    operation_id: expected.operation_id,
    target: expected.target,
    action: expected.action,
    phase: expected.phase,
    status: "failed",
    observed_state: "absent",
    mismatches: [],
    relations_checked: [],
    error: "not found"
  };
}

describe("app builder apply recovery", () => {
  it("keeps verified operations and applies a new residual plan only for the missing part", async () => {
    const app = operation({
      operation_id: "create_app",
      target: "app",
      collection: "applications",
      record: { appname: "Sales" },
      reference: { appid: 10 }
    });
    const window = operation({
      operation_id: "create_window",
      target: "window",
      collection: "windows",
      record: { appid: "$create_app.appid", windowname: "Orders" }
    });
    const envelope = buildApprovedChangeEnvelope("plan_1", [app, window]);
    const execute = vi.fn()
      .mockResolvedValueOnce(result([app, window], [passed(app, { appid: 10 }), absent(window)], "partial_success"))
      .mockResolvedValueOnce(result([
        { ...window, record: { appid: 10, windowname: "Orders" } }
      ], [passed(window, { windowid: 20, appid: 10, windowname: "Orders" })]));
    const prepare = vi.fn().mockResolvedValue({ valid: true, plan_id: "plan_2" });

    const recovery = await runApplyRecovery({
      original_plan_id: "plan_1",
      approved_change_envelope: envelope
    }, {
      execute_attempt: execute,
      prepare_plan: prepare
    });

    expect(recovery.status).toBe("verified");
    expect(recovery.residual_plan_id).toBe("plan_2");
    expect(prepare).toHaveBeenCalledWith([
      expect.objectContaining({ id: "create_window", op: "create_window", record: { appid: 10, windowname: "Orders" } })
    ], "residual", expect.any(Object));
    expect(execute.mock.calls[1][2]).toMatchObject({ create_app: { appid: 10 } });
  });

  it("observes an interrupted partial apply and prepares a new residual before executing again", async () => {
    const app = operation({
      operation_id: "create_app",
      target: "app",
      collection: "applications",
      record: { appname: "Resume" }
    });
    const window = operation({
      operation_id: "create_window",
      target: "window",
      collection: "windows",
      record: { appid: "$create_app.appid", windowname: "Resume window" }
    });
    const execute = vi.fn().mockResolvedValue(result(
      [{ ...window, record: { appid: 44, windowname: "Resume window" } }],
      [passed(window, { windowid: 55, appid: 44 })]
    ));
    const prepare = vi.fn().mockResolvedValue({ valid: true, plan_id: "plan_resume_residual" });

    const recovery = await runApplyRecovery({
      original_plan_id: "plan_resume",
      initial_current_plan_id: "plan_resume",
      initial_observation: result(
        [app, window],
        [passed(app, { appid: 44, appname: "Resume" }), absent(window)],
        "partial_success"
      ),
      approved_change_envelope: buildApprovedChangeEnvelope("plan_resume", [app, window])
    }, {
      execute_attempt: execute,
      prepare_plan: prepare
    });

    expect(recovery.ok).toBe(true);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
    expect(prepare).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "create_window",
        op: "create_window",
        record: { appid: 44, windowname: "Resume window" }
      })
    ], "residual", expect.any(Object));
    expect(execute).toHaveBeenCalledWith(
      "plan_resume_residual",
      2,
      expect.objectContaining({ create_app: { appid: 44, appname: "Resume" } })
    );
  });

  it("retries a transient failed write through a new residual plan", async () => {
    const app = operation({
      operation_id: "create_app",
      target: "app",
      collection: "applications",
      record: { appname: "Retry fixture" }
    });
    const execute = vi.fn()
      .mockResolvedValueOnce(result([app], [absent(app)], "partial_success"))
      .mockResolvedValueOnce(result([app], [passed(app, { appid: 11, appname: "Retry fixture" })]));

    const recovery = await runApplyRecovery({
      original_plan_id: "plan_transient",
      approved_change_envelope: buildApprovedChangeEnvelope("plan_transient", [app])
    }, {
      execute_attempt: execute,
      prepare_plan: vi.fn().mockResolvedValue({ valid: true, plan_id: "plan_transient_residual" })
    });

    expect(recovery.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(recovery.attempts.map(item => item.plan_id)).toEqual(["plan_transient", "plan_transient_residual"]);
  });

  it("repairs an invalid residual prepare up to the dedicated prepare budget", async () => {
    const app = operation({ operation_id: "create_app", target: "app", collection: "applications", record: { appname: "A" } });
    const execute = vi.fn()
      .mockResolvedValueOnce(result([app], [absent(app)], "partial_success"))
      .mockResolvedValueOnce(result([app], [passed(app, { appid: 12, appname: "A" })]));
    const prepare = vi.fn()
      .mockResolvedValueOnce({ valid: false, blocking_errors: [{ code: "invalid_value", field: "appname" }] })
      .mockResolvedValueOnce({ valid: true, plan_id: "plan_fixed" });
    const repair = vi.fn().mockResolvedValue([{
      id: "create_app",
      op: "create_app",
      record: { appname: "Repaired" }
    }]);

    const recovery = await runApplyRecovery({
      original_plan_id: "plan_invalid",
      approved_change_envelope: buildApprovedChangeEnvelope("plan_invalid", [app])
    }, {
      execute_attempt: execute,
      prepare_plan: prepare,
      repair_invalid_prepare: repair
    });

    expect(recovery.ok).toBe(true);
    expect(recovery.prepare_repairs_used).toBe(1);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("blocks an invalid-prepare repair that adds fields outside the confirmed envelope", async () => {
    const app = operation({
      operation_id: "create_app",
      target: "app",
      collection: "applications",
      record: { appname: "A" }
    });
    const prepare = vi.fn().mockResolvedValue({
      valid: false,
      blocking_errors: [{ code: "required_field_missing", field: "seqno" }]
    });
    const repair = vi.fn().mockResolvedValue([{
      id: "create_app",
      op: "create_app",
      record: { appname: "A", seqno: 10 }
    }]);

    const recovery = await runApplyRecovery({
      original_plan_id: "plan_scope_locked",
      approved_change_envelope: buildApprovedChangeEnvelope("plan_scope_locked", [app])
    }, {
      execute_attempt: vi.fn().mockResolvedValue(result([app], [absent(app)], "partial_success")),
      prepare_plan: prepare,
      repair_invalid_prepare: repair
    });

    expect(recovery.ok).toBe(false);
    expect(recovery.status).toBe("verification_failed");
    expect(recovery.blockers[0]).toMatchObject({ code: "residual_prepare_invalid" });
    expect(recovery.blockers[0]?.blocking_errors).toEqual([
      expect.objectContaining({
        code: "residual_fields_outside_envelope",
        operation_id: "create_app",
        actual: ["seqno"]
      })
    ]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("keeps API success as verification_failed when postconditions do not pass", async () => {
    const app = operation({ operation_id: "create_app", target: "app", collection: "applications", record: { appname: "Missing" } });
    const recovery = await runApplyRecovery({
      original_plan_id: "plan_verify_fail",
      approved_change_envelope: buildApprovedChangeEnvelope("plan_verify_fail", [app]),
      apply_repair_limit: 0
    }, {
      execute_attempt: vi.fn().mockResolvedValue(result([app], [absent(app)], "success")),
      prepare_plan: vi.fn()
    });

    expect(recovery.ok).toBe(false);
    expect(recovery.status).toBe("verification_failed");
    expect(recovery.blockers[0]).toMatchObject({ code: "apply_repair_budget_exhausted" });
  });

  it("prepares a separate pending plan when repair changes update into create", async () => {
    const updateWindow = operation({
      operation_id: "update_window",
      action: "update",
      target: "window",
      collection: "windows",
      id_field: "windowid",
      id_value: 1150,
      record: { windowname: "New" }
    });
    const prepare = vi.fn().mockResolvedValue({
      valid: true,
      plan_id: "plan_requires_confirm",
      approved_change_envelope: { source: "confirmed_plan", operations: [] }
    });
    const recovery = await runApplyRecovery({
      original_plan_id: "plan_update",
      approved_change_envelope: buildApprovedChangeEnvelope("plan_update", [updateWindow])
    }, {
      execute_attempt: vi.fn().mockResolvedValue(result([updateWindow], [absent(updateWindow)], "partial_success")),
      prepare_plan: prepare
    });

    expect(recovery.status).toBe("waiting_confirmation");
    expect(recovery.ok).toBe(false);
    expect(recovery.repair_plan?.plan_id).toBe("plan_requires_confirm");
    expect(prepare).toHaveBeenCalledWith([
      expect.objectContaining({ id: "update_window", op: "create_window", record: { windowname: "New" } })
    ], "scope_expansion", expect.any(Object));
  });
});
