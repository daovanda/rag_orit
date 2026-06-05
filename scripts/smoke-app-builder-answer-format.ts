import { createDeterministicGraphAnswer } from "../src/agent";
import type { ToolResultRecord } from "../src/types";

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toolResult(content: Record<string, unknown>): ToolResultRecord {
  return {
    name: "app_builder_graph_subgraph",
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

console.log(JSON.stringify({
  ok: true,
  checks: {
    window_table_answer: windowOnlyAnswer,
    detailed_flow_answer: detailedAnswer,
    table_list_answer: listAnswer
  }
}, null, 2));
