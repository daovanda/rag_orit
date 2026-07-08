import { describe, expect, it } from "vitest";
import {
  buildComprehensionContext,
  classifyComprehensionContextSource,
  isExplicitWriteRequest,
  isLikelyClarificationAnswer,
  isPlanConfirmation,
  isUnusableModelAnswer,
  isWriteRequestAllowed,
  parseContextualizedRequest,
  sanitizeHistoryContentForModel,
  selectEvidenceToolForDirectAnswer,
  selectToolCallsToExecute,
  shouldFetchEvidenceToolForDirectAnswer,
  shouldOverrideGeneralChatWithEvidenceTool,
  shouldRequirePrepareChangeAfterCreationSchema
} from "../src/agent";

describe("classifyComprehensionContextSource", () => {
  it("labels graph facts with additional App Builder schema/search context", () => {
    expect(classifyComprehensionContextSource({
      hasAppBuilderContext: true,
      hasGraphFacts: true,
      hasOtherAppBuilderContext: true,
      hasSupportingContext: false
    })).toBe("graph_facts_with_app_builder_context");
  });

  it("labels App Builder search/schema context without answer facts", () => {
    expect(classifyComprehensionContextSource({
      hasAppBuilderContext: true,
      hasGraphFacts: false,
      hasOtherAppBuilderContext: false,
      hasSupportingContext: false
    })).toBe("app_builder_tool_context");
  });

  it("labels RAG-only context as supporting context", () => {
    expect(classifyComprehensionContextSource({
      hasAppBuilderContext: false,
      hasGraphFacts: false,
      hasOtherAppBuilderContext: false,
      hasSupportingContext: true
    })).toBe("supporting_tool_or_rag_context");
  });
});

describe("parseContextualizedRequest", () => {
  it("parses a rewritten request and resolved references", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Đổi tên app có appid 107 từ Quản lý nhà trọ thành Quản lý phòng trọ.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [
        {
          type: "app",
          id: 107,
          name: "Quản lý nhà trọ",
          source: "Lịch sử hội thoại gần nhất"
        }
      ]
    }));

    expect(result).toEqual({
      valid: true,
      rewritten_message: "Đổi tên app có appid 107 từ Quản lý nhà trọ thành Quản lý phòng trọ.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [
        {
          type: "app",
          id: "107",
          name: "Quản lý nhà trọ",
          source: "Lịch sử hội thoại gần nhất"
        }
      ]
    });
  });

  it("requires a non-empty rewritten message", () => {
    expect(parseContextualizedRequest(JSON.stringify({
      rewritten_message: "",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: []
    }))).toBeNull();
  });

  it("supplies a safe clarification question when the model omits one", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Người dùng muốn xóa một đối tượng đã nhắc trước đó.",
      needs_clarification: true,
      clarification_question: null,
      resolved_references: []
    }));

    expect(result?.needs_clarification).toBe(true);
    expect(result?.clarification_question).toContain("nói rõ");
  });
});

describe("isExplicitWriteRequest", () => {
  it.each([
    "Hãy tạo app Quản lý kho",
    "Hãy giúp tôi tạo app Quản lý kho",
    "Bạn có thể tạo app Quản lý kho",
    "Đổi tên app 107 thành Quản lý phòng trọ",
    "Tôi muốn xóa window 1150",
    "Vui lòng cập nhật tên app này"
  ])("accepts an explicit write command: %s", message => {
    expect(isExplicitWriteRequest(message)).toBe(true);
  });

  it("handles real Vietnamese đ/Đ characters in write verbs", () => {
    expect(isExplicitWriteRequest("Đổi tên app 107 thành Quản lý phòng trọ")).toBe(true);
    expect(isWriteRequestAllowed(
      "Đổi nó thành Quản lý phòng trọ",
      "Đổi tên app có appid 107 thành Quản lý phòng trọ.",
      [{ role: "assistant" as const, content: "Đã thấy app 107: Quản lý nhà trọ." }],
      [{ type: "app", id: "107", source: "history" }]
    )).toBe(true);
    expect(isExplicitWriteRequest("đừng tạo app Quản lý kho")).toBe(false);
  });

  it.each([
    "Hướng dẫn tôi tạo app Quản lý kho",
    "Làm thế nào để xóa window?",
    "Đừng xóa app 38",
    "Chưa cần sửa window này",
    "Tôi test tạo app và bị lỗi"
  ])("rejects non-action or negated text: %s", message => {
    expect(isExplicitWriteRequest(message)).toBe(false);
  });

  it("allows a clarified write continuation only when history contains an explicit write request", () => {
    const clarified = "Đổi tên app có appid 107 thành Quản lý phòng trọ.";
    const history = [
      { role: "user" as const, content: "Đổi tên app 107" },
      { role: "assistant" as const, content: "Bạn muốn đổi app 107 thành tên mới nào?" }
    ];
    const references = [{ type: "app", id: "107", source: "Lịch sử hội thoại gần nhất" }];

    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, history, references)).toBe(true);
    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, history)).toBe(false);
    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, [], references)).toBe(false);
  });

  it("allows contextual write only with resolved references and keeps negation/instructions safe", () => {
    const history = [
      { role: "assistant" as const, content: "Đã thấy app 107: Quản lý nhà trọ." }
    ];
    const references = [{ type: "app", id: "107", name: "Quản lý nhà trọ", source: "history" }];
    const clarified = "Đổi tên app có appid 107 thành Quản lý phòng trọ.";

    expect(isWriteRequestAllowed("Đổi nó thành Quản lý phòng trọ", clarified, history, references)).toBe(true);
    expect(isWriteRequestAllowed("Đổi nó thành Quản lý phòng trọ", clarified, history, [])).toBe(false);
    expect(isWriteRequestAllowed("Đừng đổi nó", clarified, history, references)).toBe(false);
    expect(isWriteRequestAllowed("Hướng dẫn tôi đổi nó", clarified, history, references)).toBe(false);
  });
});

describe("isPlanConfirmation", () => {
  it.each([
    "đồng ý",
    "Đồng ý",
    "có, thực hiện kế hoạch",
    "hãy thực hiện kế hoạch"
  ])("accepts Vietnamese confirmation text: %s", message => {
    expect(isPlanConfirmation(message)).toBe(true);
  });

  it("does not treat ordinary text as plan confirmation", () => {
    expect(isPlanConfirmation("tôi muốn xem lại kế hoạch")).toBe(false);
  });
});

describe("isUnusableModelAnswer", () => {
  it.each([
    "We need to follow developer instructions: answer in Vietnamese. Đây là câu trả lời.",
    "Let's craft answer: Hệ thống hiện có 8 ứng dụng.",
    "Tôi cần đọc tool result rồi viết câu trả lời cho user.",
    "Kế hoạch trả lời: bắt đầu bằng dữ liệu đã thấy.",
    "{\"question_type\":\"overview\",\"answer_focus\":[\"liệt kê app\"]}",
    "ANSWER BRIEF NỘI BỘ: question_type overview"
  ])("rejects leaked internal reasoning: %s", answer => {
    expect(isUnusableModelAnswer(answer)).toBe(true);
  });

  it("keeps a normal Vietnamese answer usable", () => {
    expect(isUnusableModelAnswer("Hệ thống hiện có 8 ứng dụng. App Builder là nơi quản lý metadata app, window, tab và field.")).toBe(false);
  });
});

describe("sanitizeHistoryContentForModel", () => {
  it("removes UI debug flow from assistant history before model context", () => {
    const cleaned = sanitizeHistoryContentForModel(`Hệ thống hiện có 8 ứng dụng.

Debug flow (12 bước)
1. [ok] request.received
{
  "message_chars": 10
}`);

    expect(cleaned).toBe("Hệ thống hiện có 8 ứng dụng.");
  });

  it("removes frontend retrieval debug blocks from history", () => {
    const cleaned = sanitizeHistoryContentForModel(`Zilcode là nền tảng no-code.

RAG query: rewritten | app builder window
Original: window`);

    expect(cleaned).toBe("Zilcode là nền tảng no-code.");
  });
});

describe("buildComprehensionContext", () => {
  it("keeps a larger context budget for RAG-only results", () => {
    const longRagText = "Quy tắc tài liệu RAG. ".repeat(150);
    const context = buildComprehensionContext([
      {
        name: "rag_search",
        content: JSON.stringify({
          mode: "rag",
          answer_context: longRagText
        })
      }
    ]);

    expect(context).toContain("Tool rag_search");
    expect(context).toContain("Quy tắc tài liệu RAG");
    expect(context).not.toContain("GRAPH FACTS");
    expect(context.length).toBeGreaterThan(2000);
    expect(context.length).toBeLessThanOrEqual(4000);
  });

  it("keeps supporting RAG context when graph facts are present", () => {
    const context = buildComprehensionContext([
      {
        name: "rag_search",
        content: JSON.stringify({
          mode: "rag",
          answer_context: "Quy tắc tài liệu: window cần tab, tab cần table, field map column."
        })
      },
      {
        name: "app_builder_graph_subgraph",
        content: JSON.stringify({
          mode: "subgraph",
          graph: {
            nodes: [
              { id: "app:107", type: "app", label: "Quản lý phòng trọ", summary: { appid: 107 } }
            ],
            edges: [],
            nodes_count: 1,
            edges_count: 0
          },
          answer_facts: {
            scope: { node_types: { app: 1 } },
            flow_summary: ["Đã thấy app Quản lý phòng trọ."],
            tables_summary: [],
            windows_summary: [],
            menus_summary: [],
            permissions_summary: [],
            verified_relations: [],
            dependency_summary: {},
            write_contract_summary: {},
            creation_readiness: {},
            operation_plan_facts: {},
            inferred_notes: []
          }
        })
      }
    ]);

    expect(context).toContain("APP BUILDER TOOL CONTEXT");
    expect(context).toContain("SUPPORTING TOOL/RAG CONTEXT");
    expect(context).toContain("Quy tắc tài liệu");
    expect(context.length).toBeLessThanOrEqual(4000);
  });

  it("keeps graph search matches as App Builder context even without answer_facts", () => {
    const context = buildComprehensionContext([
      {
        name: "app_builder_graph_search",
        content: JSON.stringify({
          mode: "search",
          query: "window thanh toán",
          types: "window",
          matches_count: 1,
          matches: [
            {
              node_id: "window:<appid>:<windowid>",
              type: "window",
              label: "Window thanh toán",
              score: 0.98,
              summary: { windowid: "<windowid>", appid: "<appid>" }
            }
          ],
          hint: "Dùng node_id này để mở subgraph/detail nếu cần."
        })
      }
    ]);

    expect(context).toContain('"mode": "search"');
    expect(context).toContain("window thanh toán");
    expect(context).toContain("window:<appid>:<windowid>");
    expect(context).not.toContain("SUPPORTING TOOL/RAG CONTEXT");
    expect(context.length).toBeLessThanOrEqual(4000);
  });

  it("keeps prior graph facts when creation schema is the latest App Builder tool result", () => {
    const context = buildComprehensionContext([
      {
        name: "app_builder_graph_subgraph",
        content: JSON.stringify({
          mode: "subgraph",
          graph: {
            nodes: [
              { id: "app:<appid>", type: "app", label: "Ứng dụng đang xét", summary: { appid: "<appid>" } }
            ],
            edges: [],
            nodes_count: 1,
            edges_count: 0
          },
          answer_facts: {
            scope: { node_types: { app: 1 } },
            flow_summary: ["Đã thấy app mục tiêu và các liên kết chính quanh app."],
            tables_summary: [],
            windows_summary: [{ windowid: "<windowid>", windowname: "Window nghiệp vụ" }],
            menus_summary: [],
            permissions_summary: [],
            verified_relations: [],
            dependency_summary: {},
            write_contract_summary: {},
            creation_readiness: {},
            operation_plan_facts: {},
            inferred_notes: []
          }
        })
      },
      {
        name: "app_builder_creation_schema",
        content: JSON.stringify({
          mode: "creation_schema",
          intent: "add_window",
          status: "ok",
          proposed_plan_format: {
            operations: [{ op: "create_window", record: { appid: "<appid>", windowname: "<windowname>" } }]
          }
        })
      }
    ]);

    expect(context).toContain("PRIMARY APP BUILDER CONTEXT");
    expect(context).toContain("OTHER APP BUILDER TOOL CONTEXT");
    expect(context).toContain("Đã thấy app mục tiêu");
    expect(context).toContain("proposed_plan_format");
    expect(context).toContain("create_window");
    expect(context.length).toBeLessThanOrEqual(4000);
  });
});

describe("selectEvidenceToolForDirectAnswer", () => {
  it("forces RAG evidence for Zilcode how-to questions", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "hướng dẫn tôi tạo 1 window trong zilcode",
      "Hướng dẫn quy trình tạo một window trong Zilcode.",
      "default"
    )).toMatchObject({
      name: "rag_search"
    });
  });

  it("keeps how-to create app questions in RAG even if rewritten text looks like a write command", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "hướng dẫn tôi tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      "default"
    )).toMatchObject({
      name: "rag_search"
    });
  });

  it("keeps app-builder how-to app questions in RAG even without explicit Zilcode word", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "huong dan toi tao app",
      "Huong dan quy trinh tao app trong App Builder.",
      "default"
    )).toMatchObject({
      name: "rag_search"
    });
  });

  it("does not use creation schema when the original message negates a write action", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "đừng tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      "default"
    )).toBeNull();
  });

  it("forces graph overview evidence for current system app-list questions", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "Hệ thống của tôi đang có những ứng dụng nào",
      "Hệ thống hiện tại đang có những ứng dụng nào?",
      "default"
    )).toMatchObject({
      name: "app_builder_graph_overview"
    });
  });

  it("does not force graph/RAG for a general consumer app question", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "app nao tot de ghi chu",
      "App nao tot de ghi chu?",
      "default"
    )).toBeNull();
  });

  it("still forces graph overview for app-list questions scoped to the current system", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "app nao dang co trong he thong",
      "App nao dang co trong he thong hien tai?",
      "default"
    )).toMatchObject({
      name: "app_builder_graph_overview"
    });
  });

  it("forces graph overview for broad current project overview questions", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "du an cua toi hien tai dang co nhung gi",
      "Du an cua toi hien tai dang co nhung gi?",
      "default"
    )).toMatchObject({
      name: "app_builder_graph_overview"
    });
  });

  it("forces subgraph/detail evidence for a specific app analysis question", () => {
    const selected = selectEvidenceToolForDirectAnswer(
      "app quản lý đơn hàng đang có những gì",
      "App Quản lý đơn hàng đang có những thành phần nào?",
      "default"
    );

    expect(["app_builder_graph_subgraph", "app_builder_node_detail"]).toContain(selected?.name);
  });

  it("does not force a tool for ordinary conversation", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "xin chào",
      "Xin chào",
      "default"
    )).toBeNull();
  });

  it("forces creation schema evidence for direct write requests in default mode", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "hãy tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      "default"
    )).toMatchObject({
      name: "app_builder_creation_schema",
      arguments: {
        intent: "create_app"
      }
    });
  });

  it("uses only RAG evidence in search mode", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "hướng dẫn tôi tạo window trong Zilcode",
      "Hướng dẫn tạo window trong Zilcode",
      "search"
    )).toMatchObject({
      name: "rag_search"
    });
  });

  it("keeps explicit write requests inside RAG in search mode", () => {
    expect(selectEvidenceToolForDirectAnswer(
      "hãy tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      "search"
    )).toMatchObject({
      name: "rag_search"
    });
  });
});

describe("shouldFetchEvidenceToolForDirectAnswer", () => {
  it("fetches evidence only once for the same tool name", () => {
    const evidenceTool = {
      name: "app_builder_creation_schema",
      arguments: {
        intent: "create_app"
      }
    };

    expect(shouldFetchEvidenceToolForDirectAnswer([], evidenceTool)).toBe(true);
    expect(shouldFetchEvidenceToolForDirectAnswer([
      {
        name: "app_builder_creation_schema",
        content: "{}"
      }
    ], evidenceTool)).toBe(false);
  });

  it("does not fetch when no evidence tool is selected", () => {
    expect(shouldFetchEvidenceToolForDirectAnswer([], null)).toBe(false);
  });
});

describe("shouldOverrideGeneralChatWithEvidenceTool", () => {
  it("overrides a pure general_chat selection when evidence is required", () => {
    expect(shouldOverrideGeneralChatWithEvidenceTool(
      [{ name: "general_chat", arguments: { message: "Zilcode là gì?" } }],
      [],
      { name: "rag_search", arguments: { query: "Zilcode là gì?" } }
    )).toBe(true);
  });

  it("does not override when no evidence tool is selected", () => {
    expect(shouldOverrideGeneralChatWithEvidenceTool(
      [{ name: "general_chat", arguments: { message: "xin chào" } }],
      [],
      null
    )).toBe(false);
  });

  it("does not override when the evidence tool was already fetched", () => {
    expect(shouldOverrideGeneralChatWithEvidenceTool(
      [{ name: "general_chat", arguments: { message: "Zilcode là gì?" } }],
      [{ name: "rag_search", content: "{}" }],
      { name: "rag_search", arguments: { query: "Zilcode là gì?" } }
    )).toBe(false);
  });

  it("does not override when the model already selected an evidence tool", () => {
    expect(shouldOverrideGeneralChatWithEvidenceTool(
      [
        { name: "general_chat", arguments: { message: "Zilcode là gì?" } },
        { name: "rag_search", arguments: { query: "Zilcode là gì?" } }
      ],
      [],
      { name: "rag_search", arguments: { query: "Zilcode là gì?" } }
    )).toBe(false);
  });
});

describe("selectToolCallsToExecute", () => {
  it("keeps general_chat when it is the only selected tool", () => {
    expect(selectToolCallsToExecute([
      { name: "general_chat", arguments: { message: "xin chào" } }
    ])).toEqual([
      { name: "general_chat", arguments: { message: "xin chào" } }
    ]);
  });

  it("drops general_chat when a specific evidence/action tool is also selected", () => {
    expect(selectToolCallsToExecute([
      { name: "general_chat", arguments: { message: "app hiện có gì" } },
      { name: "app_builder_graph_subgraph", arguments: { query: "app quản lý đơn hàng" } }
    ])).toEqual([
      { name: "app_builder_graph_subgraph", arguments: { query: "app quản lý đơn hàng" } }
    ]);
  });

  it("drops general_chat for write planning tools too", () => {
    expect(selectToolCallsToExecute([
      { name: "general_chat", arguments: { message: "tạo app" } },
      { name: "app_builder_prepare_change", arguments: { intent: "create_app" } }
    ])).toEqual([
      { name: "app_builder_prepare_change", arguments: { intent: "create_app" } }
    ]);
  });
});

describe("shouldRequirePrepareChangeAfterCreationSchema", () => {
  it("requires prepare_change after schema for a real write request", () => {
    expect(shouldRequirePrepareChangeAfterCreationSchema(
      [{ name: "app_builder_creation_schema", content: "{}" }],
      "hãy tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      [],
      []
    )).toBe(true);
  });

  it("does not require prepare_change for how-to requests", () => {
    expect(shouldRequirePrepareChangeAfterCreationSchema(
      [{ name: "app_builder_creation_schema", content: "{}" }],
      "hướng dẫn tôi tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      [],
      []
    )).toBe(false);
  });

  it("does not require prepare_change once a write result exists", () => {
    expect(shouldRequirePrepareChangeAfterCreationSchema(
      [
        { name: "app_builder_creation_schema", content: "{}" },
        { name: "app_builder_prepare_change", content: "{\"valid\":true}" }
      ],
      "hãy tạo app Quản lý kho",
      "Tạo app Quản lý kho.",
      [],
      []
    )).toBe(false);
  });
});

describe("isLikelyClarificationAnswer", () => {
  it("detects clarification questions", () => {
    expect(isLikelyClarificationAnswer("Bạn muốn đặt tên app là gì?")).toBe(true);
    expect(isLikelyClarificationAnswer("Hãy nói rõ field nào cần cập nhật.")).toBe(true);
  });

  it("does not classify prose plans as clarification", () => {
    expect(isLikelyClarificationAnswer("Tôi sẽ tạo app, sau đó tạo bảng và window tương ứng.")).toBe(false);
  });
});
