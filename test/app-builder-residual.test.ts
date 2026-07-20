import { describe, expect, it } from "vitest";
import {
  buildApprovedChangeEnvelope,
  buildResidualPlan,
  validateResidualScope
} from "../src/app-builder-residual";
import { parseExpectedWriteOperations, type AppBuilderVerificationReport } from "../src/app-builder-verification";

function report(overrides: Partial<AppBuilderVerificationReport>): AppBuilderVerificationReport {
  return {
    ok: false,
    status: "partial_failure_verified",
    operation_results: [],
    cache_results: [],
    verified_operations: {},
    unverified_operation_ids: [],
    failed_operation_ids: [],
    summary: { total: 0, passed: 0, failed: 0, inconclusive: 0, caches_checked: 0 },
    ...overrides
  };
}

describe("app builder residual planner", () => {
  it("keeps only absent create operations and resolves completed references", () => {
    const writeResult = {
      plan_id: "plan_1",
      expected_operations: [
        {
          operation_id: "create_app",
          action: "create",
          target: "app",
          collection: "applications",
          id_field: "appid",
          record: { appname: "Sales" },
          reference: { appid: 91 }
        },
        {
          operation_id: "create_window",
          action: "create",
          target: "window",
          collection: "windows",
          id_field: "windowid",
          depends_on: ["create_app"],
          record: { appid: "$create_app.appid", windowname: "Orders" }
        }
      ]
    };
    const verification = report({
      operation_results: [
        {
          operation_id: "create_app", target: "app", action: "create", status: "passed",
          observed_state: "present", reference: { appid: 91 }, mismatches: [], relations_checked: []
        },
        {
          operation_id: "create_window", target: "window", action: "create", status: "failed",
          observed_state: "absent", mismatches: [], relations_checked: []
        }
      ],
      verified_operations: { create_app: { appid: 91 } }
    });

    const residual = buildResidualPlan(writeResult, verification);
    expect(residual.valid).toBe(true);
    expect(residual.operations).toEqual([expect.objectContaining({
      id: "create_window",
      op: "create_window",
      depends_on: [],
      record: { appid: 91, windowname: "Orders" }
    })]);
  });

  it("turns a partially materialized create into a field-limited update", () => {
    const writeResult = {
      plan_id: "plan_2",
      expected_operations: [{
        operation_id: "create_menu",
        action: "create",
        target: "menu",
        collection: "menus",
        id_field: "menuid",
        record: { menuname: "Orders", seqno: 20 },
        reference: { menuid: 8 }
      }]
    };
    const verification = report({
      operation_results: [{
        operation_id: "create_menu", target: "menu", action: "create", status: "failed",
        observed_state: "present", actual_record: { menuid: 8, menuname: "Old", seqno: 20 },
        mismatches: [{ field: "menuname", expected: "Orders", actual: "Old" }], relations_checked: []
      }]
    });

    const residual = buildResidualPlan(writeResult, verification);
    expect(residual.valid).toBe(true);
    expect(residual.operations[0]).toMatchObject({
      id: "create_menu",
      op: "update_menu",
      id_value: 8,
      record: { menuname: "Orders" }
    });
  });

  it("blocks recreating a missing update target because that expands approved action", () => {
    const writeResult = {
      expected_operations: [{
        operation_id: "update_window",
        action: "update",
        target: "window",
        collection: "windows",
        id_field: "windowid",
        id_value: 1150,
        record: { windowname: "New" }
      }]
    };
    const verification = report({
      operation_results: [{
        operation_id: "update_window", target: "window", action: "update", status: "failed",
        observed_state: "absent", mismatches: [], relations_checked: []
      }]
    });

    const residual = buildResidualPlan(writeResult, verification);
    expect(residual.valid).toBe(false);
    expect(residual.within_approved_envelope).toBe(false);
    expect(residual.requires_new_confirmation).toBe(true);
    expect(residual.blockers[0]).toMatchObject({ code: "repair_requires_scope_expansion" });
    expect(residual.confirmation_required_operations).toEqual([
      expect.objectContaining({ id: "update_window", op: "create_window", record: { windowname: "New" } })
    ]);
  });

  it("rejects fields that were not present in the confirmed plan", () => {
    const expected = parseExpectedWriteOperations([{
      operation_id: "create_app",
      action: "create",
      target: "app",
      collection: "applications",
      record: { appname: "Sales" }
    }]);
    const envelope = buildApprovedChangeEnvelope("plan_3", expected);
    const blockers = validateResidualScope([{
      id: "create_app",
      op: "update_app",
      id_value: 1,
      record: { description: "unapproved" }
    }], envelope);
    expect(blockers[0]).toMatchObject({ code: "residual_fields_outside_envelope" });
  });
});
