import { describe, expect, it, vi } from "vitest";
import { runAgenticLoop } from "../src/agent";
import type { Env } from "../src/config";
import type { DebugStep } from "../src/debug";

describe("RAG fast path", () => {
  it("stops after covered retrieval and synthesizes with one final model call", async () => {
    let chatCalls = 0;
    const aiRun = vi.fn(async (model: string) => {
      if (model.includes("bge-m3")) {
        return { data: Array.from({ length: 1024 }, () => 0.1) };
      }

      chatCalls += 1;
      if (chatCalls === 1) {
        return {
          response: JSON.stringify({
            rewritten_message: "Hướng dẫn tôi sử dụng Đại Việt.",
            needs_clarification: false,
            clarification_question: null,
            resolved_references: [],
            request_kind: "knowledge",
            required_outcome: "answer"
          })
        };
      }
      if (chatCalls === 2) {
        return {
          tool_calls: [{
            id: "rag-1",
            name: "rag_search",
            arguments: { query: "Hướng dẫn sử dụng Đại Việt" }
          }]
        };
      }
      if (chatCalls === 3) {
        return {
          response: "Đây là câu trả lời đã tổng hợp trực tiếp từ tài liệu Đại Việt."
        };
      }
      throw new Error(`Unexpected extra chat model call ${chatCalls}`);
    });
    const matches = Array.from({ length: 8 }, (_, index) => ({
      id: `chunk-${index + 1}`,
      score: 0.95 - index * 0.01,
      metadata: {
        excerpt: `Tóm tắt hướng dẫn ${index + 1}`,
        module: "Đại Việt",
        title: "Hướng dẫn Đại Việt",
        heading: `Mục ${index + 1}`,
        section_path: `Hướng dẫn > Mục ${index + 1}`
      }
    }));
    const env = {
      AI: { run: aiRun },
      VECTORIZE: { query: vi.fn(async () => ({ matches })) },
      CHUNKS: {
        get: vi.fn(async (key: string) => {
          const id = key.replace(/^chunk:/, "");
          return JSON.stringify({
            text: `Nội dung đầy đủ ${id}`,
            module: "Đại Việt",
            title: "Hướng dẫn Đại Việt",
            heading: id,
            section_path: `Hướng dẫn > ${id}`
          });
        })
      },
      ZILCODE_API_TOKEN: "",
      MODEL_PROVIDER: "cloudflare"
    } as unknown as Env;
    const debugSteps: DebugStep[] = [];

    const result = await runAgenticLoop(
      "Hướng dẫn tôi sử dụng Đại Việt",
      env,
      [],
      debugSteps
    );

    expect(result.answer).toContain("tổng hợp trực tiếp");
    expect(result.toolsCalled).toEqual(["rag_search"]);
    expect(chatCalls).toBe(3);
    expect(debugSteps.some(step => step.step === "agent.rag_goal_reached")).toBe(true);
    expect(debugSteps.some(step => step.step === "tools.rag_fast_final")).toBe(true);
    expect(debugSteps.some(step => step.step.startsWith("pipeline."))).toBe(false);
    expect(debugSteps.filter(step => step.step === "agent.tool_selection" && step.status === "start")).toHaveLength(1);
  });
});
