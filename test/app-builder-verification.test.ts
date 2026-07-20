import { describe, expect, it, vi } from "vitest";
import {
  compareExpectedRecord,
  verifyAppBuilderWriteResult
} from "../src/app-builder-verification";

const env = {} as never;
const session = {
  base_url: "https://example.zilcode.vn",
  token: "test-token",
  user: { userid: 1, siteid: 1 }
};

describe("app builder postcondition verifier", () => {
  it("verifies an entity by graph search then node detail", async () => {
    const graphTool = vi.fn(async (_env, _session, tool: string) => {
      if (tool === "app_builder_graph_search") {
        return {
          mode: "search",
          matches_count: 1,
          matches: [{
            id: "app:107",
            type: "app",
            label: "Quản lý phòng trọ",
            summary: { appid: 107, appname: "Quản lý phòng trọ" }
          }]
        };
      }
      return {
        mode: "detail",
        node: { id: "app:107", type: "app" },
        detail: { record: { appid: 107, appname: "Quản lý phòng trọ", seqno: 10 } },
        answer_facts: { verified_relations: [] }
      };
    });

    const report = await verifyAppBuilderWriteResult(env, session, {
      ok: true,
      expected_operations: [{
        operation_id: "create_app_room",
        action: "create",
        target: "app",
        collection: "applications",
        id_field: "appid",
        record: { appname: "Quản lý phòng trọ", seqno: 10 },
        reference: { appid: 107 }
      }]
    }, { graph_tool: graphTool as never });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("verified");
    expect(report.verified_operations.create_app_room).toMatchObject({ appid: 107 });
    expect(graphTool).toHaveBeenCalledTimes(2);
  });

  it("marks API success as verification_failed when graph has no entity", async () => {
    const graphTool = vi.fn(async () => ({
      mode: "search",
      matches_count: 0,
      matches: [],
      read_completeness: { authoritative: true }
    }));
    const report = await verifyAppBuilderWriteResult(env, session, {
      ok: true,
      expected_operations: [{
        operation_id: "create_table_orders",
        action: "create",
        target: "table",
        collection: "tables",
        id_field: "tableid",
        record: { tablename: "orders" },
        reference: { tableid: 55 }
      }]
    }, { graph_tool: graphTool as never });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("verification_failed");
    expect(report.operation_results[0]).toMatchObject({ status: "failed", observed_state: "absent" });
  });

  it("does not accept API success without expected postconditions", async () => {
    const graphTool = vi.fn();
    const report = await verifyAppBuilderWriteResult(env, session, {
      ok: true,
      status: "success"
    }, { graph_tool: graphTool as never });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("verification_failed");
    expect(report.error).toContain("expected_operations");
    expect(graphTool).not.toHaveBeenCalled();
  });

  it("verifies delete only when exact target is absent", async () => {
    const graphTool = vi.fn(async () => ({
      mode: "search",
      matches_count: 0,
      matches: [],
      read_completeness: { authoritative: true }
    }));
    const report = await verifyAppBuilderWriteResult(env, session, {
      ok: true,
      expected_operations: [{
        operation_id: "delete_window_1150",
        action: "delete",
        target: "window",
        collection: "windows",
        id_field: "windowid",
        id_value: 1150
      }]
    }, { graph_tool: graphTool as never });

    expect(report.ok).toBe(true);
    expect(report.operation_results[0]).toMatchObject({ status: "passed", observed_state: "absent" });
  });

  it("does not treat an empty incomplete graph as a successful delete", async () => {
    const graphTool = vi.fn(async () => ({
      mode: "search",
      matches_count: 0,
      matches: [],
      graph_quality: { status: "degraded", errors_count: 1 },
      read_completeness: {
        authoritative: false,
        collection: "applications",
        collection_loaded: false,
        reason: "Search is not reliable enough to prove that an entity is absent."
      },
      errors: {
        record_errors: [{ key: "applications", error: "Too many subrequests" }]
      }
    }));
    const report = await verifyAppBuilderWriteResult(env, session, {
      ok: false,
      status: "partial_success",
      expected_operations: [{
        operation_id: "delete_app_109",
        action: "delete",
        target: "app",
        collection: "applications",
        id_field: "appid",
        id_value: 109
      }]
    }, { graph_tool: graphTool as never });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("partial_failure_verified");
    expect(report.operation_results[0]).toMatchObject({
      status: "inconclusive",
      observed_state: "unknown"
    });
  });

  it("normalizes numeric and boolean metadata values without hiding real mismatches", () => {
    expect(compareExpectedRecord(
      { seqno: 10, isreadonly: false, appname: "A" },
      { SEQNO: "10", isreadonly: 0, appname: "B" }
    )).toEqual([{ field: "appname", expected: "A", actual: "B" }]);
  });
});
