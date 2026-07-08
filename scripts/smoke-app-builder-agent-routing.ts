import { inferGraphQuestionIntent, shouldContinueAfterToolResult } from "../src/agent";

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function searchResult(score = 100): string {
  return JSON.stringify({
    mode: "search",
    query: "QUAN LY THIET BI",
    matches_count: 5,
    matches: [
      {
        id: "app:22",
        type: "app",
        label: "QUAN LY THIET BI",
        score,
        summary: { appid: 22, appname: "QUAN LY THIET BI" },
        counts: { tables: 13, windows: 1, menus: 1 }
      },
      {
        id: "app:14",
        type: "app",
        label: "Time Sheet",
        score: 25,
        summary: { appid: 14, appname: "Time Sheet" }
      }
    ]
  });
}

function emptySearchResult(): string {
  return JSON.stringify({
    mode: "search",
    query: "Time Sheet",
    matches_count: 0,
    matches: []
  });
}

ok(inferGraphQuestionIntent("Hệ thống của tôi đang có những gì") === "overview", "overview intent should be detected");
ok(inferGraphQuestionIntent("hãy đi sâu vào ứng dụng Quản lý thiết bị") === "deep_dive", "deep dive intent should be detected");
ok(inferGraphQuestionIntent("phân tích luồng window tab field column") === "relationship", "relationship intent should be detected");
ok(inferGraphQuestionIntent("app này có bao nhiêu window") === "count", "count intent should be detected");

ok(
  shouldContinueAfterToolResult(
    "app_builder_graph_search",
    searchResult(100),
    "hãy đi sâu vào ứng dụng Quản lý thiết bị"
  ),
  "deep-dive search with strong top match should continue to model for subgraph/detail"
);

ok(
  shouldContinueAfterToolResult(
    "app_builder_graph_search",
    searchResult(100),
    "phân tích liên kết của ứng dụng Quản lý thiết bị"
  ),
  "relationship search with strong top match should continue"
);

ok(
  shouldContinueAfterToolResult(
    "app_builder_graph_search",
    searchResult(100),
    "app Quản lý thiết bị có bao nhiêu window"
  ),
  "count search with strong top match should continue so final answer can use tool result"
);

ok(
  !shouldContinueAfterToolResult(
    "app_builder_graph_search",
    searchResult(20),
    "tìm app quản lý"
  ),
  "plain ambiguous search should not continue automatically"
);

ok(
  shouldContinueAfterToolResult(
    "app_builder_graph_search",
    emptySearchResult(),
    "hay di sau vao ung dung Time Sheet"
  ),
  "deep-dive search with no match should get one extra model pass for fallback search/detail strategy"
);

ok(
  !shouldContinueAfterToolResult(
    "app_builder_graph_search",
    emptySearchResult(),
    "tim app Time Sheet"
  ),
  "plain search with no match should not continue automatically"
);

ok(
  shouldContinueAfterToolResult(
    "app_builder_creation_schema",
    JSON.stringify({ mode: "creation_schema" }),
    "hãy tạo app Quản lý kho",
    "Tạo app Quản lý kho."
  ),
  "direct write requests should continue after creation_schema so the model can prepare_change"
);

ok(
  !shouldContinueAfterToolResult(
    "app_builder_creation_schema",
    JSON.stringify({ mode: "creation_schema" }),
    "hướng dẫn tôi tạo app Quản lý kho",
    "Hướng dẫn quy trình tạo app Quản lý kho."
  ),
  "how-to requests should not continue from creation_schema into prepare_change"
);

ok(
  !shouldContinueAfterToolResult(
    "app_builder_creation_schema",
    JSON.stringify({ mode: "creation_schema" }),
    "đừng tạo app Quản lý kho",
    "Không tạo app Quản lý kho."
  ),
  "negated write requests should not continue from creation_schema into prepare_change"
);

ok(
  shouldContinueAfterToolResult(
    "app_builder_creation_schema",
    JSON.stringify({ mode: "creation_schema" }),
    "Đổi nó thành Quản lý phòng trọ",
    {
      clarifiedMessage: "Đổi tên app có appid 107 thành Quản lý phòng trọ.",
      chatHistory: [
        { role: "assistant", content: "Đã thấy app 107: Quản lý nhà trọ." }
      ],
      resolvedReferences: [
        { type: "app", id: "107", name: "Quản lý nhà trọ", source: "history" }
      ]
    }
  ),
  "contextual write with resolved reference should continue after creation_schema"
);

ok(
  !shouldContinueAfterToolResult(
    "app_builder_creation_schema",
    JSON.stringify({ mode: "creation_schema" }),
    "Quản lý phòng trọ",
    {
      clarifiedMessage: "Đổi tên app có appid 107 thành Quản lý phòng trọ.",
      chatHistory: [
        { role: "assistant", content: "Bạn muốn đổi app 107 thành tên nào?" }
      ],
      resolvedReferences: []
    }
  ),
  "rewritten write without resolved reference should not continue after creation_schema"
);

console.log(JSON.stringify({
  ok: true,
  checks: {
    overview: inferGraphQuestionIntent("Hệ thống của tôi đang có những gì"),
    deep_dive: inferGraphQuestionIntent("hãy đi sâu vào ứng dụng Quản lý thiết bị"),
    relationship: inferGraphQuestionIntent("phân tích luồng window tab field column"),
    count: inferGraphQuestionIntent("app này có bao nhiêu window")
  }
}, null, 2));
