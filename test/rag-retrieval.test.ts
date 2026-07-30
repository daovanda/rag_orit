import { describe, expect, it, vi } from "vitest";
import {
  dedupeRagQueries,
  fuseVectorMatchSets,
  getRagRerankDecision,
  mergeRagSources,
  searchRagQueries
} from "../src/ai";
import { coalesceRagSearchToolCalls } from "../src/agent";
import type { Env } from "../src/config";
import type { RagSource, StoredChunk, ToolCall, VectorMatch } from "../src/types";

function makeMatches(ids: string[], startScore = 0.9): VectorMatch[] {
  return ids.map((id, index) => ({
    id,
    score: startScore - index * 0.01
  }));
}

function makeChunk(id: string): StoredChunk {
  return {
    text: `Nội dung tài liệu ${id}`,
    module: "Tài liệu kiểm thử",
    title: "Hướng dẫn kiểm thử",
    heading: `Mục ${id}`,
    section_path: `Hướng dẫn > Mục ${id}`
  };
}

describe("RAG query planning", () => {
  it("deduplicates normalized queries without using domain-specific rules", () => {
    expect(dedupeRagQueries([
      "  Hướng dẫn sử dụng Đại Việt ",
      "Hướng   dẫn sử dụng Đại Việt",
      "Quy trình theo bộ phận"
    ])).toEqual([
      "Hướng dẫn sử dụng Đại Việt",
      "Quy trình theo bộ phận"
    ]);
  });

  it("coalesces multiple rag_search calls from one model decision", () => {
    const calls: ToolCall[] = [
      {
        id: "rag-1",
        name: "rag_search",
        arguments: { query: "Hướng dẫn sử dụng hệ thống" }
      },
      {
        id: "rag-2",
        name: "rag_search",
        arguments: { query: "Tổng quan quy trình nghiệp vụ" }
      }
    ];

    expect(coalesceRagSearchToolCalls(calls)).toEqual([
      {
        id: "rag-1",
        name: "rag_search",
        arguments: {
          query: "Hướng dẫn sử dụng hệ thống",
          queries: [
            "Tổng quan quy trình nghiệp vụ"
          ]
        }
      }
    ]);
  });

  it("fuses duplicate vector matches with reciprocal-rank fusion", () => {
    const fused = fuseVectorMatchSets([
      makeMatches(["a", "b", "c"]),
      makeMatches(["b", "d", "a"])
    ]);

    expect(fused.map(match => match.id)).toEqual(["b", "a", "d", "c"]);
    expect(fused.find(match => match.id === "a")?.matched_queries).toBe(2);
    expect(fused.find(match => match.id === "b")?.matched_queries).toBe(2);
  });

  it("uses deterministic ranking for a clear single query and model rerank for multi-query coverage", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...makeChunk(`chunk-${index + 1}`),
      id: `chunk-${index + 1}`,
      vector_score: 0.95 - index * 0.01,
      source_label: `Nguồn ${index + 1}`
    }));

    expect(getRagRerankDecision(candidates, {
      query_count: 1,
      query_was_rewritten: false
    }).use_model).toBe(false);
    expect(getRagRerankDecision(candidates, {
      query_count: 2,
      query_was_rewritten: false
    }).use_model).toBe(true);
  });
});

describe("RAG fused retrieval", () => {
  it("runs vector queries concurrently, reads each fused chunk once and reranks once", async () => {
    const firstIds = Array.from({ length: 14 }, (_, index) => `chunk-${index + 1}`);
    const secondIds = [
      ...Array.from({ length: 10 }, (_, index) => `chunk-${index + 1}`),
      ...Array.from({ length: 6 }, (_, index) => `chunk-${index + 15}`)
    ];
    const vectorMatchSets = [
      makeMatches(firstIds, 0.95),
      makeMatches(secondIds, 0.93),
      makeMatches(["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"], 0.91)
    ];
    let vectorCall = 0;
    let rerankCalls = 0;

    const aiRun = vi.fn(async (model: string) => {
      if (model.includes("bge-m3")) {
        return { data: Array.from({ length: 1024 }, () => 0.1) };
      }
      rerankCalls += 1;
      return {
        response: JSON.stringify({
          ranked_ids: Array.from({ length: 20 }, (_, index) => `chunk-${index + 1}`)
        })
      };
    });
    const vectorQuery = vi.fn(async () => {
      const matches = vectorMatchSets[vectorCall] ?? [];
      vectorCall += 1;
      return { matches };
    });
    const kvGet = vi.fn(async (key: string) => {
      const id = key.replace(/^chunk:/, "");
      return JSON.stringify(makeChunk(id));
    });
    const env = {
      AI: { run: aiRun },
      VECTORIZE: { query: vectorQuery },
      CHUNKS: { get: kvGet },
      ZILCODE_API_TOKEN: "",
      MODEL_PROVIDER: "cloudflare"
    } as unknown as Env;

    const result = await searchRagQueries([
      "Hướng dẫn sử dụng hệ thống",
      "Tổng quan quy trình nghiệp vụ",
      "Các thao tác thường dùng",
      "Query thứ tư phải bị giới hạn"
    ], env);

    expect(vectorQuery).toHaveBeenCalledTimes(3);
    expect(kvGet).toHaveBeenCalledTimes(16);
    expect(new Set(kvGet.mock.calls.map(call => call[0])).size).toBe(16);
    expect(rerankCalls).toBe(1);
    expect(result.sources).toHaveLength(6);
    expect(new Set(result.sources?.map(source => source.id)).size).toBe(6);
    expect(result.rag_query_debug?.batch_queries).toHaveLength(3);
    expect(result.rag_retrieval_summary?.candidate_source).toBe("kv_fallback");
    expect(result.rag_retrieval_summary?.used_model_rerank).toBe(true);
    expect(result.content).toContain("[RAG_RETRIEVAL_SUMMARY]");
    expect(result.content).toContain('"missing_queries":[]');
  });

  it("ranks from Vectorize excerpts and loads only final full-text chunks from KV", async () => {
    const matches = Array.from({ length: 12 }, (_, index): VectorMatch => ({
      id: `chunk-${index + 1}`,
      score: 0.95 - index * 0.01,
      metadata: {
        excerpt: `Tóm tắt liên quan cho chunk ${index + 1}`,
        module: "Đại Việt",
        title: "Hướng dẫn Đại Việt",
        heading: `Mục ${index + 1}`,
        section_path: `Hướng dẫn > Mục ${index + 1}`
      }
    }));
    let chatModelCalls = 0;
    const aiRun = vi.fn(async (model: string) => {
      if (model.includes("bge-m3")) {
        return { data: Array.from({ length: 1024 }, () => 0.1) };
      }
      chatModelCalls += 1;
      return { response: '{"ranked_ids":[]}' };
    });
    const kvGet = vi.fn(async (key: string) =>
      JSON.stringify(makeChunk(key.replace(/^chunk:/, "")))
    );
    const env = {
      AI: { run: aiRun },
      VECTORIZE: { query: vi.fn(async () => ({ matches })) },
      CHUNKS: { get: kvGet },
      ZILCODE_API_TOKEN: "",
      MODEL_PROVIDER: "cloudflare"
    } as unknown as Env;

    const result = await searchRagQueries(["Hướng dẫn sử dụng Đại Việt"], env);

    expect(chatModelCalls).toBe(0);
    expect(kvGet).toHaveBeenCalledTimes(8);
    expect(result.rag_retrieval_summary).toMatchObject({
      candidate_source: "vector_metadata_excerpt",
      used_model_rerank: false,
      selected_chunks: 8,
      missing_queries: []
    });
  });

  it("deduplicates sources and keeps the better-ranked record", () => {
    const source = (id: string, rank: number, score: number): RagSource => ({
      id,
      module: "Tài liệu",
      heading: id,
      rerank_rank: rank,
      vector_score: score
    });

    const merged = mergeRagSources(
      [source("a", 3, 0.7), source("b", 2, 0.8)],
      [source("a", 1, 0.75), source("c", 4, 0.9)],
      3
    );

    expect(merged.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].rerank_rank).toBe(1);
  });
});
