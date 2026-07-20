import { describe, expect, it } from "vitest";
import {
  buildComprehensionContext,
  buildToolSelectionHistoryContext,
  classifyComprehensionContextSource,
  hasReachedRequiredOutcome,
  isUnusableModelAnswer,
  parseContextualizedRequest,
  sanitizeHistoryContentForModel
} from "../src/agent";
import {
  createAgentRunState,
  inspectToolResult,
  recordToolOutcome,
  updateRunContext
} from "../src/agent-run-state";

describe("classifyComprehensionContextSource", () => {
  it("distinguishes graph facts, App Builder context and supporting RAG context", () => {
    expect(classifyComprehensionContextSource({
      hasAppBuilderContext: true,
      hasGraphFacts: true,
      hasOtherAppBuilderContext: true,
      hasSupportingContext: false
    })).toBe("graph_facts_with_app_builder_context");

    expect(classifyComprehensionContextSource({
      hasAppBuilderContext: false,
      hasGraphFacts: false,
      hasOtherAppBuilderContext: false,
      hasSupportingContext: true
    })).toBe("supporting_tool_or_rag_context");
  });
});

describe("parseContextualizedRequest", () => {
  it("parses a model-owned write goal contract and resolved references", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Đổi tên app có appid 107 thành Quản lý phòng trọ.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [
        { type: "app", id: 107, name: "Quản lý nhà trọ", source: "Lịch sử gần nhất" }
      ],
      request_kind: "prepare_change",
      required_outcome: "pending_confirmation"
    }));

    expect(result).toMatchObject({
      valid: true,
      request_kind: "prepare_change",
      required_outcome: "pending_confirmation",
      resolved_references: [{ type: "app", id: "107" }]
    });
  });

  it("keeps a how-to question as an answer goal", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Hướng dẫn quy trình tạo window trong Zilcode.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [],
      request_kind: "knowledge",
      required_outcome: "answer"
    }));

    expect(result?.request_kind).toBe("knowledge");
    expect(result?.required_outcome).toBe("answer");
  });

  it("defaults legacy contextualizer JSON to a non-writing answer goal", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Hệ thống hiện có những ứng dụng nào?",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: []
    }));

    expect(result?.request_kind).toBe("unknown");
    expect(result?.required_outcome).toBe("answer");
  });

  it("normalizes an inconsistent model contract by request kind", () => {
    const write = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Cập nhật app mục tiêu.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [],
      request_kind: "prepare_change",
      required_outcome: "answer"
    }));
    const read = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Đọc app mục tiêu.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [],
      request_kind: "read",
      required_outcome: "pending_confirmation"
    }));

    expect(write?.required_outcome).toBe("pending_confirmation");
    expect(read?.required_outcome).toBe("answer");
  });

  it("rejects an empty rewritten request and supplies a clarification question", () => {
    expect(parseContextualizedRequest(JSON.stringify({
      rewritten_message: "",
      needs_clarification: false,
      resolved_references: []
    }))).toBeNull();

    const clarification = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Người dùng muốn thay đổi đối tượng đã nhắc trước đó.",
      needs_clarification: true,
      clarification_question: null,
      resolved_references: [],
      request_kind: "unknown",
      required_outcome: "answer"
    }));
    expect(clarification?.clarification_question).toContain("nói rõ");
  });
});

describe("goal completion contract", () => {
  it("does not consider a write goal complete before a pending plan exists", () => {
    const state = createAgentRunState("Đổi tên app 107", { run_id: "run_goal_incomplete" });
    updateRunContext(state, "Đổi tên app 107 thành Quản lý phòng trọ", [], {
      request_kind: "prepare_change",
      required_outcome: "pending_confirmation"
    });

    expect(hasReachedRequiredOutcome("pending_confirmation", state)).toBe(false);
    expect(hasReachedRequiredOutcome("answer", state)).toBe(true);
  });

  it("marks a valid prepare result as waiting for UI confirmation", () => {
    const state = createAgentRunState("Đổi tên app 107", { run_id: "run_goal_pending" });
    const result = JSON.stringify({
      mode: "prepare_change",
      status: "ready_for_confirmation",
      valid: true,
      plan_id: "plan_107",
      operations: [{ op: "update_app", id: 107 }]
    });

    recordToolOutcome(
      state,
      "app_builder_prepare_change",
      { operations: [{ op: "update_app", id: 107 }] },
      inspectToolResult("app_builder_prepare_change", result)
    );

    expect(state.terminal_status).toBe("waiting_confirmation");
    expect(hasReachedRequiredOutcome("pending_confirmation", state)).toBe(true);
    expect(state.prepared_operations).toHaveLength(1);
  });

  it("keeps an invalid prepare result repairable instead of treating it as complete", () => {
    const state = createAgentRunState("Tạo window", { run_id: "run_goal_repair" });
    recordToolOutcome(
      state,
      "app_builder_prepare_change",
      { operations: [{ op: "create_window" }] },
      inspectToolResult("app_builder_prepare_change", JSON.stringify({
        mode: "prepare_change",
        status: "invalid",
        valid: false,
        blocking_errors: [{ field: "appid", message: "required" }]
      }))
    );

    expect(state.terminal_status).toBe("repairing");
    expect(hasReachedRequiredOutcome("pending_confirmation", state)).toBe(false);
    expect(state.repair_attempts.prepare).toBe(1);
  });
});

describe("model context hygiene", () => {
  it("removes frontend debug blocks from chat history", () => {
    const cleaned = sanitizeHistoryContentForModel(`Hệ thống hiện có 8 ứng dụng.

Debug flow (12 bước)
1. [ok] request.received
{"message_chars":10}`);

    expect(cleaned).toBe("Hệ thống hiện có 8 ứng dụng.");
  });

  it("rejects leaked internal reasoning but keeps a normal answer", () => {
    expect(isUnusableModelAnswer("We need to follow developer instructions: answer in Vietnamese.")).toBe(true);
    expect(isUnusableModelAnswer("Hệ thống hiện có 8 ứng dụng đã được xác minh.")).toBe(false);
  });

  it("marks prior chat turns as reference-only context for tool selection", () => {
    const context = buildToolSelectionHistoryContext([
      { role: "user", content: "Hướng dẫn nhập Excel trong phần mềm Đại Việt." },
      { role: "assistant", content: "Nội dung hướng dẫn trước đó." }
    ]);

    expect(context?.role).toBe("system");
    expect(context?.content).toContain("Không gọi tool để trả lời lại yêu cầu cũ");
    expect(context?.content).toContain("Hướng dẫn nhập Excel");
  });
});

describe("buildComprehensionContext", () => {
  it("keeps supporting RAG evidence", () => {
    const context = buildComprehensionContext([{
      name: "rag_search",
      content: JSON.stringify({ mode: "rag", answer_context: "Window cần tab; tab liên kết table." })
    }]);

    expect(context).toContain("Tool rag_search");
    expect(context).toContain("Window cần tab");
  });

  it("keeps all ten app names ahead of unrelated supporting RAG context", () => {
    const apps = Array.from({ length: 11 }, (_, index) => ({
      id: `app:${index + 1}`,
      type: "app",
      label: `Ứng dụng ${index + 1}`,
      summary: { appid: index + 1 }
    }));
    const context = buildComprehensionContext([
      {
        name: "app_builder_graph_overview",
        content: JSON.stringify({
          mode: "overview",
          apps_count: 11,
          truncated: { apps: true },
          graph: { nodes: [{ id: "root", type: "root", label: "App Builder" }, ...apps], edges: [] },
          answer_facts: {
            scope: { node_types: { root: 1, app: 11 } },
            flow_summary: ["Đã thấy 11 app."],
            tables_summary: Array.from({ length: 30 }, (_, index) => ({ label: `Bảng ${index}`, description: "x".repeat(300) })),
            windows_summary: [],
            menus_summary: [],
            permissions_summary: [],
            verified_relations: [],
            inferred_notes: []
          }
        })
      },
      {
        name: "rag_search",
        content: JSON.stringify({ answer_context: "Một kết quả RAG không liên quan từ lịch sử cũ." })
      }
    ]);

    expect(context).toContain("Ứng dụng 10");
    expect(context).not.toContain("Ứng dụng 11");
    expect(context.indexOf("Ứng dụng 10")).toBeLessThan(context.indexOf("Một kết quả RAG"));
  });
});
