import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools";

function findTool(name: string) {
  return TOOLS.find(tool => tool.name === name);
}

describe("tool schema descriptions", () => {
  it("describes graph overview as app-level skeleton, not full detail graph", () => {
    const overview = findTool("app_builder_graph_overview");

    expect(overview?.description).toContain("root/app");
    expect(overview?.description).toContain("KHÔNG trả detail đầy đủ");
    expect(overview?.parameters.properties).toHaveProperty("max_apps");
    expect(overview?.parameters.properties).not.toHaveProperty("max_nodes");
    expect(overview?.parameters.properties).not.toHaveProperty("max_edges");
  });

  it("keeps graph detail/subgraph tools available for app internals", () => {
    expect(findTool("app_builder_graph_search")?.description).toContain("resolve");
    expect(findTool("app_builder_graph_subgraph")?.description).toContain("Mở vùng graph");
    expect(findTool("app_builder_node_detail")?.description).toContain("record chi tiết");
  });

  it("exposes prepare to the model but keeps apply backend-only", () => {
    expect(findTool("app_builder_prepare_change")).toBeDefined();
    expect(findTool("app_builder_apply_change")).toBeUndefined();
  });

  it("routes Dai Viet usage and business-process questions to the RAG corpus", () => {
    const ragSearch = findTool("rag_search");

    expect(ragSearch?.description).toContain("Phần mềm Quản lý Sản xuất Nhựa Đại Việt");
    expect(ragSearch?.description).toContain("phải dùng rag_search");
    expect(ragSearch?.parameters.properties.query.description).toContain("Đại Việt");
  });

  it("does not bias model with business-specific sample app names", () => {
    const schemaText = JSON.stringify(TOOLS).toLowerCase();

    [
      "order management",
      "customer lookup",
      "sales_user",
      "sales_manager"
    ].forEach(snippet => {
      expect(schemaText).not.toContain(snippet);
    });
  });
});
