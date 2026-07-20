import { hasReachedRequiredOutcome, parseContextualizedRequest } from "../src/agent";
import { createAgentRunState, inspectToolResult, recordToolOutcome, updateRunContext } from "../src/agent-run-state";

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const readContract = parseContextualizedRequest(JSON.stringify({
  rewritten_message: "Phân tích cấu trúc ứng dụng hiện tại.",
  needs_clarification: false,
  clarification_question: null,
  resolved_references: [],
  request_kind: "read",
  required_outcome: "answer"
}));
ok(readContract?.request_kind === "read", "Contextualizer contract must preserve a read goal.");
ok(readContract?.required_outcome === "answer", "A read goal must finish with an answer.");

const writeContract = parseContextualizedRequest(JSON.stringify({
  rewritten_message: "Cập nhật metadata của app mục tiêu.",
  needs_clarification: false,
  clarification_question: null,
  resolved_references: [{ type: "app", id: "target-app", source: "current request" }],
  request_kind: "prepare_change",
  required_outcome: "pending_confirmation"
}));
ok(writeContract?.request_kind === "prepare_change", "Contextualizer contract must preserve a write goal.");

const state = createAgentRunState("Cập nhật metadata", { run_id: "smoke_goal_contract" });
updateRunContext(state, writeContract?.rewritten_message ?? "", [], {
  request_kind: writeContract?.request_kind ?? "unknown",
  required_outcome: writeContract?.required_outcome ?? "answer"
});
ok(!hasReachedRequiredOutcome("pending_confirmation", state), "A write goal must not finish before prepare succeeds.");

const invalidPrepare = JSON.stringify({ status: "invalid", valid: false, blocking_errors: [{ field: "target" }] });
recordToolOutcome(
  state,
  "app_builder_prepare_change",
  { operations: [] },
  inspectToolResult("app_builder_prepare_change", invalidPrepare)
);
ok(state.terminal_status === "repairing", "Invalid prepare must remain repairable.");
ok(!hasReachedRequiredOutcome("pending_confirmation", state), "Invalid prepare must not satisfy the goal.");

const validPrepare = JSON.stringify({
  status: "ready_for_confirmation",
  valid: true,
  plan_id: "smoke-plan",
  operations: [{ op: "update_app" }]
});
recordToolOutcome(
  state,
  "app_builder_prepare_change",
  { operations: [{ op: "update_app" }] },
  inspectToolResult("app_builder_prepare_change", validPrepare)
);
ok(state.terminal_status === "waiting_confirmation", "Valid prepare must wait for the UI button.");
ok(hasReachedRequiredOutcome("pending_confirmation", state), "Pending confirmation must satisfy the message-agent goal.");

console.log(JSON.stringify({
  ok: true,
  checks: {
    read_contract: readContract?.request_kind,
    write_contract: writeContract?.request_kind,
    final_status: state.terminal_status
  }
}, null, 2));
