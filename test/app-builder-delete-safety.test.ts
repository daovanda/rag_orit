import { describe, expect, it } from "vitest";
import {
  __expandRawAppBuilderOperationsForTest,
  __validatePreparedDeleteDependenciesForTest,
  type PreparedOperation
} from "../src/app-builder-write";
import { buildApprovedChangeEnvelope } from "../src/app-builder-envelope";

function deleteOperation(
  id: string,
  target: string,
  collection: string,
  idValue: unknown
): PreparedOperation {
  return {
    id,
    action: "delete",
    target,
    collection,
    label: `${target}:${String(idValue)}`,
    id_value: typeof idValue === "number" || typeof idValue === "string" ? idValue : undefined
  };
}

describe("app builder delete safety", () => {
  it("expands app cascade into exact metadata IDs without batch where", () => {
    const records = {
      applications: [{ appid: 107, appname: "Rental" }],
      windows: [{ windowid: 501, appid: 107 }],
      tabs: [{ tabid: 601, windowid: 501, tableid: 701 }],
      fields: [{ fieldid: 801, tabid: 601, columnid: 901 }],
      menus: [{ menuid: 1001, appid: 107, windowid: 501 }],
      rolemenus: [{ rolemenuid: 1101, menuid: 1001 }],
      roleapps: [{ roleappid: 1201, appid: 107 }],
      appservices: [{ appserviceid: 1301, appid: 107, serviceid: 1 }],
      domains: [{ domainid: 1401, appid: 107 }],
      caches: [{ cacheid: 1501, appid: 107, windowid: 501 }]
    };

    const result = __expandRawAppBuilderOperationsForTest(records, [{
      id: "delete_app_107",
      op: "delete_app",
      id_value: 107,
      cascade: true
    }]);

    expect(result.operations.length).toBe(10);
    expect(result.operations.every(operation => operation.where === undefined)).toBe(true);
    expect(result.operations.map(operation => operation.id_value)).toEqual([
      1501, 801, 601, 1101, 1001, 1201, 1301, 1401, 501, 107
    ]);
  });

  it("requires explicit confirmation before deleting a menu owned by another app", () => {
    const records = {
      windows: [{ windowid: 501, appid: 107 }],
      tabs: [],
      fields: [],
      menus: [{ menuid: 1001, appid: 88, windowid: 501 }],
      rolemenus: [],
      caches: []
    };

    expect(() => __expandRawAppBuilderOperationsForTest(records, [{
      id: "delete_window_501",
      op: "delete_window",
      id_value: 501,
      cascade: true
    }])).toThrow("shared_dependency_delete_requires_confirmation");
  });

  it("blocks domain deletion while a column still references it", () => {
    const records = {
      domains: [{ domainid: 41, domainname: "Status" }],
      columns: [{ columnid: 51, tableid: 61, domainid: 41, columnname: "status" }]
    };
    const errors = __validatePreparedDeleteDependenciesForTest(records, [
      deleteOperation("delete_domain_41", "domain", "domains", 41)
    ]);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "delete_dependency_unresolved",
        operation_id: "delete_domain_41",
        field: "domainid"
      })
    ]));
  });

  it("accepts domain deletion when the referencing column is explicitly detached", () => {
    const records = {
      domains: [{ domainid: 41, domainname: "Status" }],
      columns: [{ columnid: 51, tableid: 61, domainid: 41, columnname: "status" }]
    };
    const operations: PreparedOperation[] = [
      {
        id: "update_column_51",
        action: "update",
        target: "column",
        collection: "columns",
        label: "detach domain",
        id_value: 51,
        record: { domainid: null }
      },
      deleteOperation("delete_domain_41", "domain", "domains", 41)
    ];

    expect(__validatePreparedDeleteDependenciesForTest(records, operations)).toEqual([]);
  });

  it("captures the exact confirmed action and mutable fields in the envelope", () => {
    const envelope = buildApprovedChangeEnvelope("plan_1", [{
      operation_id: "update_app_107",
      action: "update",
      target: "app",
      collection: "applications",
      id_field: "appid",
      id_value: 107,
      record: { appname: "New name", description: "Updated" }
    }]);

    expect(envelope).toEqual({
      source: "confirmed_plan",
      plan_id: "plan_1",
      operations: [{
        operation_id: "update_app_107",
        original_action: "update",
        target: "app",
        collection: "applications",
        allowed_fields: ["appname", "description"],
        id_field: "appid",
        id_value: 107,
        where: undefined
      }]
    });
  });
});
