import fs from "node:fs";
import path from "node:path";
import { isWriteRequestAllowed, parseAgentMode, runAgenticLoop } from "../src/agent";
import { runChatModel } from "../src/ai";
import { CHAT_MODEL } from "../src/config";
import type { AIMessage, ToolDefinition } from "../src/types";

type MockEnv = {
  AI: {
    run: (model: string, payload: Record<string, unknown>) => Promise<unknown>;
  };
  MODEL_PROVIDER?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_BASE_URL?: string;
  NVIDIA_CHAT_MODEL?: string;
  NVIDIA_STREAM?: string;
};

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeEnv(handler: MockEnv["AI"]["run"], extra: Partial<MockEnv> = {}): MockEnv {
  return { AI: { run: handler }, ...extra };
}

async function checkChatCompletionsPayload(): Promise<Record<string, unknown>> {
  let capturedPayload: Record<string, unknown> | undefined;
  const env = makeEnv(async (_model, payload) => {
    capturedPayload = payload;
    return {
      choices: [
        {
          message: {
            content: "ok"
          }
        }
      ]
    };
  });

  const result = await runChatModel(CHAT_MODEL, {
    messages: [{ role: "user", content: "xin chao" }],
    max_tokens: 32,
    temperature: 0
  }, env as never);

  check(result.response === "ok", "runChatModel không parse được choices[0].message.content.");
  check(Array.isArray(capturedPayload?.messages), "Cloudflare payload phải dùng Chat Completions messages.");
  check(!Array.isArray(capturedPayload?.input), "Cloudflare payload không được dùng Responses input.");
  check(capturedPayload?.max_tokens === 32, "Cloudflare payload phải dùng max_tokens.");
  check(capturedPayload?.max_output_tokens === undefined, "Cloudflare payload không được dùng max_output_tokens.");

  return {
    response: result.response,
    has_messages: Array.isArray(capturedPayload?.messages),
    has_input: Array.isArray(capturedPayload?.input),
    max_tokens: capturedPayload?.max_tokens
  };
}

async function checkResponsesShapedParsingStillWorks(): Promise<Record<string, unknown>> {
  const env = makeEnv(async () => ({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "responses text"
          }
        ]
      }
    ]
  }));

  const result = await runChatModel(CHAT_MODEL, {
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 32
  }, env as never);

  check(result.response === "responses text", "Parser phải vẫn đọc được output_text nếu Cloudflare trả shape kiểu Responses.");
  return { response: result.response };
}

async function checkToolCallParsing(): Promise<Record<string, unknown>> {
  const tool: ToolDefinition = {
    name: "rag_search",
    description: "Tìm tài liệu.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  };

  let capturedPayload: Record<string, unknown> | undefined;
  const env = makeEnv(async (_model, payload) => {
    capturedPayload = payload;
    return {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "rag_search",
                  arguments: "{\"query\":\"window zilcode\"}"
                }
              }
            ]
          }
        }
      ]
    };
  });

  const result = await runChatModel(CHAT_MODEL, {
    messages: [{ role: "user", content: "huong dan tao window" }],
    tools: [tool],
    max_tokens: 128
  }, env as never);

  const firstCall = result.tool_calls?.[0];
  check(Array.isArray(capturedPayload?.tools), "Tool-selection payload phải gửi tools dạng Chat Completions.");
  check(firstCall?.name === "rag_search", "Parser không lấy đúng tool call name.");
  check(firstCall.arguments.query === "window zilcode", "Parser không parse đúng JSON arguments của tool call.");

  return {
    tool_name: firstCall?.name,
    query: firstCall?.arguments.query,
    tools_count: Array.isArray(capturedPayload?.tools) ? capturedPayload.tools.length : 0
  };
}

async function checkNvidiaChatCompletionsPayload(): Promise<Record<string, unknown>> {
  const tool: ToolDefinition = {
    name: "rag_search",
    description: "Tìm tài liệu.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedPayload: Record<string, unknown> | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization") || "";
    capturedPayload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "nvidia ok",
            tool_calls: [
              {
                id: "call_nv_1",
                function: {
                  name: "rag_search",
                  arguments: "{\"query\":\"zilcode api\"}"
                }
              }
            ]
          }
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const env = makeEnv(async () => {
      throw new Error("NVIDIA provider must not call env.AI.run");
    }, {
      MODEL_PROVIDER: "nvidia",
      NVIDIA_API_KEY: "test-nvidia-key",
      NVIDIA_BASE_URL: "https://example.invalid/v1/",
      NVIDIA_CHAT_MODEL: "z-ai/glm-5.2",
      NVIDIA_STREAM: "false"
    });

    const result = await runChatModel(CHAT_MODEL, {
      messages: [
        { role: "system", content: "System 1" },
        { role: "system", content: "System 2" },
        { role: "user", content: "xin chào" },
        { role: "assistant", content: "đã gọi tool" },
        { role: "tool", tool_call_id: "rag_search", content: "tool result content" }
      ],
      tools: [tool],
      max_tokens: 64,
      temperature: 0
    }, env as never);

    const messages = Array.isArray(capturedPayload?.messages)
      ? capturedPayload.messages as Array<Record<string, unknown>>
      : [];
    const firstCall = result.tool_calls?.[0];

    check(capturedUrl === "https://example.invalid/v1/chat/completions", "NVIDIA URL phải trỏ tới /chat/completions.");
    check(capturedAuth === "Bearer test-nvidia-key", "NVIDIA request phải dùng Authorization bearer token.");
    check(capturedPayload?.model === "z-ai/glm-5.2", "NVIDIA payload phải dùng NVIDIA_CHAT_MODEL.");
    check(capturedPayload?.stream === false, "NVIDIA payload phải tắt stream cho runtime hiện tại.");
    check(Array.isArray(capturedPayload?.tools), "NVIDIA payload phải gửi tools dạng Chat Completions.");
    check(messages.filter(message => message.role === "system").length === 1, "NVIDIA messages phải gom system prompt thành một message.");
    check(!messages.some(message => message.role === "tool"), "NVIDIA messages không được gửi role=tool trong runtime adapter.");
    check(result.response === "nvidia ok", "NVIDIA parser không đọc được choices[0].message.content.");
    check(firstCall?.name === "rag_search", "NVIDIA parser không đọc được tool_calls.");
    check(firstCall.arguments.query === "zilcode api", "NVIDIA parser không parse đúng tool_call arguments.");

    return {
      url: capturedUrl,
      model: capturedPayload?.model,
      stream: capturedPayload?.stream,
      message_roles: messages.map(message => message.role),
      tool_name: firstCall?.name
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function checkModeAndWritePolicy(): Record<string, unknown> {
  const history: AIMessage[] = [
    { role: "user", content: "đổi tên app 107 thành Quản lý nhà trọ" }
  ];
  const resolvedReferences = [
    { type: "app", id: "107", name: "Quản lý nhà trọ", source: "history" }
  ];

  const explicitGuide = isWriteRequestAllowed("hướng dẫn tôi xóa app", "Xóa app 107", [], []);
  const contextualRename = isWriteRequestAllowed(
    "đổi nó thành Quản lý phòng trọ",
    "Đổi tên app có appid 107 thành Quản lý phòng trọ",
    history,
    resolvedReferences
  );
  const negated = isWriteRequestAllowed("đừng xóa nó", "Xóa app 107", history, resolvedReferences);

  check(parseAgentMode("default") === "default", "parseAgentMode default lỗi.");
  check(parseAgentMode("search") === "search", "parseAgentMode search lỗi.");
  check(parseAgentMode("invalid") === null, "parseAgentMode phải từ chối mode không hợp lệ.");
  check(explicitGuide === false, "Câu hỏi hướng dẫn không được coi là write request.");
  check(contextualRename === true, "Write request theo ngữ cảnh đã resolve phải được cho phép.");
  check(negated === false, "Câu phủ định không được coi là write request.");

  return {
    explicit_guide_allowed: explicitGuide,
    contextual_rename_allowed: contextualRename,
    negated_allowed: negated
  };
}

async function checkMessageAgentDoesNotExposeApplyTool(): Promise<Record<string, unknown>> {
  let calls = 0;
  const exposedToolNames: string[] = [];
  const env = makeEnv(async (_model, payload) => {
    calls++;
    if (Array.isArray(payload.tools)) {
      payload.tools.forEach(tool => {
        const name = (tool as { function?: { name?: unknown }; name?: unknown }).function?.name
          ?? (tool as { name?: unknown }).name;
        if (typeof name === "string") exposedToolNames.push(name);
      });
    }

    if (calls === 1) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                rewritten_message: "Xác nhận kế hoạch đang chờ bằng nút xác nhận trong giao diện.",
                needs_clarification: false,
                clarification_question: null,
                resolved_references: []
              })
            }
          }
        ]
      };
    }

    return {
      choices: [
        {
          message: {
            content: "Kế hoạch đang chờ xác nhận trong giao diện. Hãy dùng nút xác nhận để thực hiện."
          }
        }
      ]
    };
  });

  const history: AIMessage[] = [
    { role: "assistant", content: "Plan ID: 01234567-89ab-cdef-0123-456789abcdef\nKế hoạch đang chờ xác nhận." }
  ];

  const result = await runAgenticLoop("OK", env as never, history, []);
  check(!result.toolsCalled.includes("app_builder_apply_change"), "Typed confirmation must not auto-call app_builder_apply_change.");
  check(!exposedToolNames.includes("app_builder_apply_change"), "Message agent must not expose app_builder_apply_change to tool selection.");

  return {
    answer_chars: result.answer.length,
    tools_called: result.toolsCalled,
    exposed_apply_tool: exposedToolNames.includes("app_builder_apply_change")
  };
}

function checkNoLegacyOpenRouterReferences(): Record<string, unknown> {
  const root = process.cwd();
  const files = [
    "src/ai.ts",
    "src/config.ts",
    "src/types.ts",
    "chat.html",
    "trans_pro/chat.html",
    "others/chat.html"
  ];
  const forbidden = ["openrouter", "OPENROUTER", "OpenRouter", "EMBEDDING_PROVIDER"];
  const hits = files.flatMap(file => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return forbidden
      .filter(snippet => text.includes(snippet))
      .map(snippet => `${file}: ${snippet}`);
  });

  check(!hits.length, `Không được còn tham chiếu provider OpenRouter trong runtime source/UI: ${hits.join(", ")}`);
  return {
    files_checked: files.length,
    forbidden_hits: hits
  };
}

function checkNoMojibakeInRuntimePrompts(): Record<string, unknown> {
  const root = process.cwd();
  const files = [
    "src/agent.ts",
    "src/ai.ts",
    "src/tools.ts",
    "src/app-builder-graph.ts",
    "doc/logic/app-builder-agent-create-guide.md",
    "doc/logic/zilcode-agent-operating-model.md",
    "doc/logic/zilcode-agent-read-coverage.md",
    "doc/logic/zilcode-tool-safety-rules.md"
  ];
  const forbidden = [
    "Báº",
    "áº",
    "á»",
    "Ä‘",
    "Ä",
    "Æ",
    "Ã",
    "â€"
  ];
  const hits = files.flatMap(file => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return forbidden
      .filter(snippet => text.includes(snippet))
      .map(snippet => `${file}: ${JSON.stringify(snippet)}`);
  });

  check(!hits.length, `Runtime prompts/docs contain mojibake-looking text: ${hits.join(", ")}`);
  return {
    files_checked: files.length,
    forbidden_hits: hits
  };
}

function checkNoFixedBusinessExamplesInRuntimePrompts(): Record<string, unknown> {
  const root = process.cwd();
  const files = [
    "src/agent.ts",
    "src/tools.ts",
    "src/app-builder-graph.ts",
    "doc/logic/app-builder-agent-create-guide.md",
    "doc/logic/zilcode-agent-operating-model.md",
    "doc/logic/zilcode-agent-read-coverage.md",
    "doc/logic/zilcode-tool-safety-rules.md"
  ];
  const forbidden = [
    "Order Management",
    "Manage customers, products, orders and order items",
    "Quản lý phòng trọ",
    "Quản lý nhà trọ",
    "Sales_User",
    "Sales_Manager",
    "app 107",
    "window 1150",
    "appid 123"
  ];
  const hits = files.flatMap(file => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return forbidden
      .filter(snippet => text.includes(snippet))
      .map(snippet => `${file}: ${snippet}`);
  });

  check(!hits.length, `Runtime prompts/docs still contain fixed business examples: ${hits.join(", ")}`);
  return {
    files_checked: files.length,
    forbidden_hits: hits
  };
}

function checkNoRagOnlyReasoningShortcut(): Record<string, unknown> {
  const root = process.cwd();
  const file = "src/agent.ts";
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const forbidden = [
    "isRagOnlyToolResults",
    "RAG-only:",
    "\"pipeline.reasoning\", \"skip\""
  ];
  const hits = forbidden.filter(snippet => text.includes(snippet));

  check(!hits.length, `Final answer pipeline must not bypass reasoning for RAG-only results: ${hits.join(", ")}`);
  return {
    files_checked: 1,
    forbidden_hits: hits
  };
}

async function main(): Promise<void> {
  const checks = [
    {
      name: "chat_completions_payload",
      evidence: await checkChatCompletionsPayload()
    },
    {
      name: "responses_shaped_parser",
      evidence: await checkResponsesShapedParsingStillWorks()
    },
    {
      name: "tool_call_parser",
      evidence: await checkToolCallParsing()
    },
    {
      name: "nvidia_chat_completions_payload",
      evidence: await checkNvidiaChatCompletionsPayload()
    },
    {
      name: "mode_and_write_policy",
      evidence: checkModeAndWritePolicy()
    },
    {
      name: "message_agent_no_apply_tool",
      evidence: await checkMessageAgentDoesNotExposeApplyTool()
    },
    {
      name: "no_legacy_openrouter_references",
      evidence: checkNoLegacyOpenRouterReferences()
    },
    {
      name: "no_mojibake_in_runtime_prompts",
      evidence: checkNoMojibakeInRuntimePrompts()
    },
    {
      name: "no_fixed_business_examples_in_runtime_prompts",
      evidence: checkNoFixedBusinessExamplesInRuntimePrompts()
    },
    {
      name: "no_rag_only_reasoning_shortcut",
      evidence: checkNoRagOnlyReasoningShortcut()
    }
  ];

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
