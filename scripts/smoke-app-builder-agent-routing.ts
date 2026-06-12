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

console.log(JSON.stringify({
  ok: true,
  checks: {
    overview: inferGraphQuestionIntent("Hệ thống của tôi đang có những gì"),
    deep_dive: inferGraphQuestionIntent("hãy đi sâu vào ứng dụng Quản lý thiết bị"),
    relationship: inferGraphQuestionIntent("phân tích luồng window tab field column"),
    count: inferGraphQuestionIntent("app này có bao nhiêu window")
  }
}, null, 2));
