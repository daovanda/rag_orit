// src/index.ts

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  ZILCODE_API_TOKEN: string;
}

// ─── Models ───────────────────────────────────────────────────────────────────

const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "rag_search",
    description:
      "Search the Zilcode documentation. Use this when the user asks about features, concepts, how-to guides, or anything that requires knowledge of the Zilcode platform (z-Win, z-Flow, z-Data, z-Report, z-Admin).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query, rephrased as a documentation search"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_workflow",
    description:
      "Retrieve a Zilcode workflow by its ID. Use when the user refers to a specific workflow, asks to debug it, or wants to understand its structure.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The workflow ID"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "get_screen_context",
    description:
      "Get the current UI screen context: which screen the user is on, what node is selected, and what resource is active. Use when the user says 'this', 'here', 'current' without specifying an ID.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
];

// ─── Tool executor ────────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  arguments: Record<string, string>;
}

async function executeTool(
  tool: ToolCall,
  env: Env,
  screenContext?: ScreenContext
): Promise<string> {

  switch (tool.name) {

    case "rag_search": {
      const query = tool.arguments.query;
      if (!query) return "Error: query is required";

      const embeddingResult = await env.AI.run(
        EMBEDDING_MODEL,
        { text: [query] }
      ) as { data: number[][] };

      const queryVector = embeddingResult.data[0];

      const matches = await env.VECTORIZE.query(queryVector, {
        topK: 5,
        returnMetadata: "all"
      });

      if (!matches.matches.length) {
        return "No relevant documentation found.";
      }

      const results: string[] = [];
      for (const match of matches.matches) {
        const raw = await env.CHUNKS.get(`chunk:${match.id}`);
        if (raw) {
          const chunk = JSON.parse(raw) as {
            text: string;
            module: string;
            heading: string;
          };
          results.push(`[${chunk.module} — ${chunk.heading}]\n${chunk.text}`);
        }
      }

      return results.length
        ? results.join("\n\n---\n\n")
        : "No chunk text found.";
    }

    case "get_workflow": {
      const id = tool.arguments.id;
      if (!id) return "Error: id is required";

      // TODO: replace mock with real Zilcode API call when token is available
      // const res = await fetch(`https://api.zilcode.io/workflows/${id}`, {
      //   headers: { Authorization: `Bearer ${env.ZILCODE_API_TOKEN}` }
      // });
      // return await res.text();

      return JSON.stringify({
        _mock: true,
        id,
        name: `Workflow ${id}`,
        status: "active",
        nodes: [
          { id: "start", type: "trigger", label: "Start" },
          {
            id: "condition-1",
            type: "condition",
            label: "Check amount",
            config: { field: "amount", operator: ">", value: 1000 }
          },
          { id: "send-mail", type: "action", label: "Send email" },
          { id: "end", type: "end", label: "End" }
        ],
        edges: [
          { from: "start", to: "condition-1" },
          { from: "condition-1", to: "send-mail", branch: "true" },
          { from: "condition-1", to: "end", branch: "false" }
        ]
      }, null, 2);
    }

    case "get_screen_context": {
      if (screenContext) {
        return JSON.stringify(screenContext, null, 2);
      }
      return JSON.stringify({
        _mock: true,
        screen: "workflow-editor",
        selected_node: "condition-1",
        resource_id: "wf-001"
      }, null, 2);
    }

    default:
      return `Unknown tool: ${tool.name}`;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScreenContext {
  screen?: string;
  selected_node?: string;
  resource_id?: string;
}

interface ChatRequest {
  message: string;
  context?: ScreenContext;
}

interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6;

async function runAgenticLoop(
  userMessage: string,
  env: Env,
  screenContext?: ScreenContext
): Promise<{ answer: string; toolsCalled: string[] }> {

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `You are a helpful AI assistant for the Zilcode platform.
You have access to tools to search documentation and read workflow data.
Always use rag_search before answering questions about Zilcode features.
When the user mentions "this workflow" or "current screen", use get_screen_context first.
Be concise and specific.`
    },
    {
      role: "user",
      content: userMessage
    }
  ];

  const toolsCalled: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[LOOP] Iteration ${i + 1}`);

    const response = await env.AI.run(CHAT_MODEL, {
      messages,
      tools: TOOLS
    }) as {
      response?: string;
      tool_calls?: Array<{
        name: string;
        arguments: Record<string, string>;
        id?: string;
      }>;
    };

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`[LOOP] No tool calls → returning final answer`);
      return {
        answer: response.response ?? "No response generated.",
        toolsCalled
      };
    }

    for (const toolCall of response.tool_calls) {
      console.log(`[TOOL] Calling: ${toolCall.name}`, toolCall.arguments);
      toolsCalled.push(toolCall.name);

      const toolResult = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        screenContext
      );

      console.log(`[TOOL] Result length: ${toolResult.length} chars`);

      messages.push({
        role: "assistant",
        content: JSON.stringify({
          tool_call: toolCall.name,
          arguments: toolCall.arguments
        })
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id ?? toolCall.name,
        content: toolResult
      });
    }
  }

  return {
    answer: "Reached maximum tool call iterations without a final answer.",
    toolsCalled
  };
}

// ─── Worker handler ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    const url = new URL(request.url);

    // ── OPTIONS — CORS preflight ─────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── GET / — health check ─────────────────────────────────────────────────
    if (url.pathname === "/") {
      return Response.json({
        success: true,
        message: "Workers AI running",
        tools: TOOLS.map(t => t.name)
      }, { headers: CORS });
    }

    // ── POST /chat — agentic chat ────────────────────────────────────────────
    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json() as ChatRequest;

        if (!body.message) {
          return Response.json(
            { success: false, error: "message is required" },
            { status: 400, headers: CORS }
          );
        }

        const { answer, toolsCalled } = await runAgenticLoop(
          body.message,
          env,
          body.context
        );

        return Response.json({
          success: true,
          response: answer,
          tools_called: toolsCalled
        }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          },
          { status: 500, headers: CORS }
        );
      }
    }

    // ── POST /embed — raw embedding ──────────────────────────────────────────
    if (url.pathname === "/embed" && request.method === "POST") {
      try {
        const body = await request.json() as { text?: string };

        if (!body.text) {
          return Response.json(
            { success: false, error: "text is required" },
            { status: 400, headers: CORS }
          );
        }

        const embedding = await env.AI.run(EMBEDDING_MODEL, { text: body.text });
        return Response.json({ success: true, embedding }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          },
          { status: 500, headers: CORS }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  }
};