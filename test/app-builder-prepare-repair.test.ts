import { describe, expect, it } from "vitest";
import {
  parseRepairOperations,
  validateAndNormalizeRepair
} from "../src/app-builder-prepare-repair";

describe("app builder prepare repair boundary", () => {
  it("parses only a JSON object containing an operations array", () => {
    expect(parseRepairOperations('```json\n{"operations":[{"id":"op_1","op":"create_app","record":{}}]}\n```'))
      .toEqual([{ id: "op_1", op: "create_app", record: {} }]);
    expect(parseRepairOperations('{"operations":"not-an-array"}')).toBeUndefined();
  });

  it("allows only representation-equivalent repair on a field named by blocking errors", () => {
    const result = validateAndNormalizeRepair([
      {
        id: "create_app",
        op: "create_app",
        phase: "app_service",
        record: { appname: "Rental", seqno: "10", credential: "real-secret" }
      }
    ], [
      {
        id: "create_app",
        op: "create_app",
        phase: "changed-by-model",
        record: { appname: "Rental", seqno: 10, credential: "<redacted:preserve>" }
      }
    ], [{ operation_id: "create_app", code: "invalid_type", field: "seqno" }]);

    expect(result.error).toBeUndefined();
    expect(result.operations).toEqual([{
      id: "create_app",
      op: "create_app",
      phase: "app_service",
      record: { appname: "Rental", seqno: 10, credential: "real-secret" }
    }]);
  });

  it("rejects a business-value change even when the field appears in the error", () => {
    const result = validateAndNormalizeRepair([
      { id: "create_app", op: "create_app", record: { appname: "Rental" } }
    ], [
      { id: "create_app", op: "create_app", record: { appname: "Different business app" } }
    ], [{ operation_id: "create_app", code: "invalid_value", field: "appname" }]);

    expect(result.operations).toBeUndefined();
    expect(result.error).toContain("đổi ý nghĩa");
  });

  it("rejects missing fields, new fields, changed actions and duplicate operation ids", () => {
    const current = [{
      id: "update_window",
      op: "update_window",
      record: { windowname: "Orders", seqno: "10" }
    }];
    const errors = [{ operation_id: "update_window", field: "seqno" }];

    expect(validateAndNormalizeRepair(current, [
      { id: "update_window", op: "update_window", record: { seqno: 10 } }
    ], errors).error).toContain("bỏ field");
    expect(validateAndNormalizeRepair(current, [
      { id: "update_window", op: "update_window", record: { windowname: "Orders", seqno: 10, extra: true } }
    ], errors).error).toContain("thêm field");
    expect(validateAndNormalizeRepair(current, [
      { id: "update_window", op: "delete_window", record: { windowname: "Orders", seqno: 10 } }
    ], errors).error).toContain("đổi action");
    expect(validateAndNormalizeRepair(current, [
      { id: "update_window", op: "update_window", record: { windowname: "Orders", seqno: 10 } },
      { id: "update_window", op: "update_window", record: { windowname: "Orders", seqno: 10 } }
    ], errors).error).toContain("tập operation id");
  });

  it("stops when the model proposes no new safe delta", () => {
    const operation = { id: "create_app", op: "create_app", record: { appname: "Rental" } };
    const result = validateAndNormalizeRepair([operation], [operation], [
      { operation_id: "create_app", field: "appname" }
    ]);

    expect(result.operations).toBeUndefined();
    expect(result.error).toContain("không tạo ra thay đổi");
  });
});
