import { createDeterministicGraphAnswer } from "../src/agent";
import type { ToolResultRecord } from "../src/types";

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function toolResult(content: Record<string, unknown>, name = "app_builder_graph_subgraph"): ToolResultRecord {
  return {
    name,
    content: JSON.stringify(content)
  };
}

const graph = {
  nodes: [
    {
      id: "app:22",
      type: "app",
      label: "QUAN LY THIET BI",
      summary: { appid: 22, appname: "QUAN LY THIET BI" },
      counts: { tables: 1, windows: 2, menus: 1 }
    },
    {
      id: "app:29",
      type: "app",
      label: "Quan ly Khoa Toan Tin",
      summary: { appid: 29, appname: "Quan ly Khoa Toan Tin" },
      counts: { tables: 9, windows: 3, menus: 2 }
    },
    { id: "window:1100", type: "window", label: "DEVICE MANAGE", summary: { windowid: 1100, windowname: "DEVICE MANAGE" } },
    { id: "window:9999", type: "window", label: "WINDOW OTHER", summary: { windowid: 9999, windowname: "WINDOW OTHER" } },
    { id: "tab:1100:1", type: "tab", label: "Device", summary: { tabid: 1, tabname: "Device" } },
    { id: "table:22:1249", type: "table", label: "Thiet bi", summary: { tableid: 1249, tablename: "n_device", alias: "Thiet bi" } },
    { id: "table:22:5555", type: "table", label: "Bang nhieu", summary: { tableid: 5555, tablename: "noise_table", alias: "Bang nhieu" } },
    { id: "table:22:1260", type: "table", label: "Loai thiet bi", summary: { tableid: 1260, tablename: "n_device_type", alias: "Loai thiet bi" } },
    { id: "field:1100:1:10", type: "field", label: "Ten thiet bi", summary: { fieldid: 10, fieldname: "Ten thiet bi" } },
    { id: "field:1100:1:11", type: "field", label: "Loai", summary: { fieldid: 11, fieldname: "Loai" } },
    { id: "column:22:1249:20", type: "column", label: "name", summary: { columnid: 20, columnname: "name" } },
    { id: "column:22:1249:21", type: "column", label: "type_id", summary: { columnid: 21, columnname: "type_id" } },
    { id: "domain:7", type: "domain", label: "DeviceStatus", summary: { domainid: 7, domainname: "DeviceStatus" } }
  ],
  edges: [
    { from: "app:22", to: "window:1100", type: "app_has_window" },
    { from: "app:22", to: "window:9999", type: "app_has_window" },
    { from: "app:22", to: "table:22:1249", type: "app_has_table" },
    { from: "window:1100", to: "tab:1100:1", type: "window_has_tab" },
    { from: "tab:1100:1", to: "table:22:1249", type: "tab_uses_table" },
    { from: "tab:1100:1", to: "field:1100:1:10", type: "tab_has_field" },
    { from: "tab:1100:1", to: "field:1100:1:11", type: "tab_has_field" },
    { from: "field:1100:1:10", to: "column:22:1249:20", type: "field_maps_column" },
    { from: "field:1100:1:11", to: "column:22:1249:21", type: "field_maps_column" },
    { from: "field:1100:1:11", to: "table:22:1260", type: "field_links_table" },
    { from: "field:1100:1:11", to: "domain:7", type: "field_uses_domain" }
  ],
  node_counts: {},
  edge_counts: {},
  nodes_count: 12,
  edges_count: 11
};

const windowOnlyAnswer = createDeterministicGraphAnswer(
  "window đó đang kết nối đến bảng nào",
  [toolResult({ mode: "subgraph", start_node_ids: ["window:1100"], graph })]
) ?? "";
const windowOnly = normalize(windowOnlyAnswer);
ok(windowOnly.includes("device manage"), "window answer should mention selected window");
ok(windowOnly.includes("thiet bi"), "window answer should mention main table");
ok(!windowOnly.includes("window other"), "window answer must not include sibling windows when start node is a window");
ok(!windowOnly.includes("field ten thiet bi"), "simple window-table question should not include field examples");

const detailedAnswer = createDeterministicGraphAnswer(
  "giải thích chi tiết luồng window tab field column lookup domain",
  [toolResult({ mode: "subgraph", start_node_ids: ["window:1100"], graph })]
) ?? "";
const detailed = normalize(detailedAnswer);
ok(detailed.includes("field ten thiet bi"), "detailed answer should include field examples");
ok(detailed.includes("cot name"), "detailed answer should include mapped column");
ok(detailed.includes("lookup sang loai thiet bi"), "detailed answer should include lookup table");
ok(detailed.includes("domain devicestatus"), "detailed answer should include domain");

const listAnswer = createDeterministicGraphAnswer(
  "liệt kê các bảng trong app này",
  [toolResult({ mode: "subgraph", start_node_ids: ["app:22"], graph })]
) ?? "";
const list = normalize(listAnswer);
ok(list.includes("thiet bi"), "table list should include app table");
ok(!list.includes("bang nhieu"), "table list must not include unrelated table without app_has_table edge");

const overviewAnswer = createDeterministicGraphAnswer(
  "hÃ£y cho tÃ´i biáº¿t há»‡ thá»‘ng cá»§a tÃ´i hiá»‡n táº¡i",
  [toolResult({
    mode: "overview",
    apps_count: 2,
    graph: {
      nodes: graph.nodes.filter(node => node.type === "app"),
      edges: [],
      node_counts: { app: 2 },
      edge_counts: {},
      nodes_count: 2,
      edges_count: 0
    }
  }, "app_builder_graph_overview")]
) ?? "";
const overview = normalize(overviewAnswer);
ok(!overview.includes("ung dung so 4"), "overview answer must not include ordinal/name usage hint");
ok(!overview.includes("co the hoi tiep"), "overview answer must not include follow-up instruction");

const overviewCountAnswer = createDeterministicGraphAnswer(
  "váº­y app quáº£n lÃ½ khoa toÃ¡n tin Ä‘ang cÃ³ 3 hay lÃ  4 window",
  [toolResult({
    mode: "overview",
    apps_count: 2,
    graph: {
      nodes: graph.nodes.filter(node => node.type === "app"),
      edges: [],
      node_counts: { app: 2 },
      edge_counts: {},
      nodes_count: 2,
      edges_count: 0
    }
  }, "app_builder_graph_overview")]
) ?? "";
const overviewCount = normalize(overviewCountAnswer);
ok(overviewCount.includes("3 window"), "overview count answer should answer selected app window count directly");
ok(overviewCount.includes("khong phai 4"), "overview count answer should correct the wrong alternative");

const searchCountAnswer = createDeterministicGraphAnswer(
  "váº­y app quáº£n lÃ½ khoa toÃ¡n tin Ä‘ang cÃ³ 3 hay lÃ  4 window",
  [toolResult({
    mode: "search",
    query: "Quan ly Khoa Toan Tin",
    matches_count: 2,
    matches: [
      { ...graph.nodes.find(node => node.id === "app:29"), score: 100 },
      { ...graph.nodes.find(node => node.id === "app:22"), score: 20 }
    ]
  }, "app_builder_graph_search")]
) ?? "";
const searchCount = normalize(searchCountAnswer);
ok(searchCount.includes("3 window"), "search count answer should use strong top app match instead of asking user to choose");

const tableDetailAnswer = createDeterministicGraphAnswer(
  "cho tiết chi tiết ở bảng học phần",
  [toolResult({
    mode: "detail",
    node: { id: "table:29:1291", type: "table", label: "Hoc phan", summary: { tableid: 1291, tablename: "HOC_PHAN", alias: "Hoc phan" } },
    detail: {
      record: { tableid: 1291, tablename: "HOC_PHAN", alias: "Hoc phan", serviceid: 19 },
      columns_count: 3,
      columns: [
        { columnid: 1, columnname: "ma_hoc_phan", datatype: "text", length: 50 },
        { columnid: 2, columnname: "ten_hoc_phan", datatype: "text", length: 255 },
        { columnid: 3, columnname: "so_tin_chi", datatype: "number" }
      ]
    },
    neighbors: {
      inbound: [
        { type: "tab_uses_table", node: { id: "tab:1141:1313", type: "tab", label: "Hoc phan", summary: { tabid: 1313, tabname: "Hoc phan" } } }
      ],
      outbound: []
    }
  }, "app_builder_node_detail")]
) ?? "";
const tableDetail = normalize(tableDetailAnswer);
ok(tableDetail.includes("cac cot"), "table detail should include columns section");
ok(tableDetail.includes("ma_hoc_phan"), "table detail should list first column");
ok(tableDetail.includes("ten_hoc_phan"), "table detail should list second column");
ok(tableDetail.includes("dang duoc dung trong tab"), "table detail should explain tab/window usage");

console.log(JSON.stringify({
  ok: true,
  checks: {
    window_table_answer: windowOnlyAnswer,
    detailed_flow_answer: detailedAnswer,
    table_list_answer: listAnswer,
    overview_answer: overviewAnswer,
    overview_count_answer: overviewCountAnswer,
    search_count_answer: searchCountAnswer,
    table_detail_answer: tableDetailAnswer
  }
}, null, 2));
