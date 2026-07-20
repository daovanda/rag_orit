import { describe, expect, it } from "vitest";
import {
  createAgentRunState,
  createToolInputFingerprint,
  createToolResultFingerprint,
  guardToolExecution,
  inspectToolResult,
  recordToolOutcome,
  updateRunContext
} from "../src/agent-run-state";

describe("agent run state and loop guard", () => {
  it("creates stable fingerprints for normalized arguments and result status", () => {
    const first = createToolInputFingerprint("app_builder_graph_search", {
      query: "app 107",
      limit: 5
    });
    const reordered = createToolInputFingerprint("app_builder_graph_search", {
      limit: 5,
      query: "app 107"
    });

    expect(first).toBe(reordered);
    expect(createToolResultFingerprint("app_builder_graph_search", { query: "app 107", limit: 5 }, "success"))
      .not.toBe(createToolResultFingerprint("app_builder_graph_search", { query: "app 107", limit: 5 }, "error"));
  });

  it("blocks the same tool input after an identical result produced no new progress", () => {
    const state = createAgentRunState("Tìm app 107", { run_id: "run_guard" });
    const args = { query: "app 107" };
    const result = JSON.stringify({ mode: "search", matches_count: 1, matches: [{ id: "app:107" }] });

    expect(guardToolExecution(state, "app_builder_graph_search", args).allowed).toBe(true);
    recordToolOutcome(state, "app_builder_graph_search", args, inspectToolResult("app_builder_graph_search", result));

    expect(guardToolExecution(state, "app_builder_graph_search", args).allowed).toBe(true);
    recordToolOutcome(state, "app_builder_graph_search", args, inspectToolResult("app_builder_graph_search", result));

    expect(guardToolExecution(state, "app_builder_graph_search", args)).toMatchObject({
      allowed: false,
      reason: "repeated_without_progress"
    });
  });

  it("uses separate read and prepare-repair budgets", () => {
    const state = createAgentRunState("Đổi tên app", { run_id: "run_budget" });
    state.budgets.read.limit = 1;

    recordToolOutcome(
      state,
      "app_builder_graph_search",
      { query: "app 107" },
      inspectToolResult("app_builder_graph_search", JSON.stringify({ matches_count: 1 }))
    );
    expect(guardToolExecution(state, "app_builder_node_detail", { node_id: "app:107" })).toMatchObject({
      allowed: false,
      reason: "read_budget_exhausted"
    });

    const invalid = inspectToolResult("app_builder_prepare_change", JSON.stringify({
      mode: "prepare_change",
      status: "invalid",
      valid: false,
      blocking_errors: [{ code: "required", field: "appname" }]
    }));
    recordToolOutcome(state, "app_builder_prepare_change", { operations: [] }, invalid);

    expect(state.repair_attempts.prepare).toBe(1);
    expect(state.budgets.prepare_repair.used).toBe(1);
    expect(state.terminal_status).toBe("repairing");
  });

  it("persists clarified request and resolved targets as structured state", () => {
    const state = createAgentRunState("Đổi tên nó", { run_id: "run_context" });
    updateRunContext(state, "Đổi tên app 107 thành Quản lý phòng trọ", [
      { type: "app", id: "107", name: "Quản lý nhà trọ" }
    ]);

    expect(state.clarified_request).toContain("app 107");
    expect(state.resolved_targets).toEqual([
      { type: "app", id: "107", name: "Quản lý nhà trọ" }
    ]);
    expect(state.progress_revision).toBeGreaterThan(0);
  });
});
