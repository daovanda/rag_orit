// src/index.ts

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS: KVNamespace;
  ZILCODE_API_TOKEN: string;
}

// ─── Models ───────────────────────────────────────────────────────────────────

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ROUTER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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
      "Nguồn bổ sung để tra cứu kho tài liệu Zilcode đã ingest, gồm Hướng dẫn người dùng và Hướng dẫn quản trị. Công cụ này không phải phạm vi duy nhất của trợ lý. Dùng khi câu hỏi cần kiểm tra thông tin cụ thể trong tài liệu Zilcode, ví dụ: đăng nhập, vai trò, Desktop, Header, Window, toolbar, tìm kiếm/thêm/sửa/xóa/import/export dữ liệu, SQL Cloud, App Builder, Site, Service, User, Role, Organization, Application, Window/Tab/Field/MenuTool, Application Wizard. Không dùng cho chào hỏi, cảm ơn, trò chuyện thông thường, hoặc câu hỏi kiến thức chung ngoài Zilcode. Thường chỉ cần gọi một lần với query tốt; chỉ gọi lại nếu kết quả chưa đủ và query mới thật sự bổ sung khía cạnh khác.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tìm kiếm tài liệu. Giữ thuật ngữ Zilcode gốc, thêm ngữ cảnh người dùng/quản trị nếu có, và tránh lặp lại query tương đương đã dùng trong cùng lượt trả lời."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_workflow",
    description:
      "Nguồn bổ sung để lấy thông tin một workflow Zilcode theo ID. Dùng khi người dùng nêu rõ workflow ID, hoặc khi đã có ngữ cảnh màn hình cho thấy tài nguyên hiện tại là workflow và người dùng đang hỏi về cấu trúc/debug workflow đó. Không dùng cho chào hỏi, câu hỏi tài liệu chung, hoặc câu hỏi không liên quan đến một workflow cụ thể.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID của workflow"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "get_screen_context",
    description:
      "Nguồn bổ sung để lấy ngữ cảnh màn hình hiện tại của giao diện: người dùng đang ở màn hình nào, node nào đang được chọn, và tài nguyên nào đang hoạt động. Dùng khi đồng thời đúng cả hai điều kiện: người dùng đang hỏi về đối tượng đang hiển thị/được chọn trong UI, và câu trả lời phụ thuộc vào việc biết màn hình/node/tài nguyên hiện tại. Ví dụ nên dùng: 'workflow này lỗi ở đâu?', 'node này dùng để làm gì?', 'ở màn hình hiện tại tôi nên bấm gì?'. Không dùng cho 'xin chào', cảm ơn, trò chuyện thông thường, câu hỏi tài liệu chung, hoặc khi người dùng đã nêu rõ ID/tên đối tượng.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
];

type ToolDefinition = typeof TOOLS[number];
type ToolName = "rag_search" | "get_workflow" | "get_screen_context";
type RouteIntent = "direct_chat" | "rag_search" | "screen_context" | "workflow" | "mixed";

const VALID_TOOL_NAMES: ToolName[] = ["rag_search", "get_workflow", "get_screen_context"];

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
      if (!query) return "Lỗi: bắt buộc phải có câu truy vấn.";

      const embeddingResult = await env.AI.run(
        EMBEDDING_MODEL,
        { text: [query] }
      ) as { data: number[][] };

      const queryVector = embeddingResult.data[0];

      const matches = await env.VECTORIZE.query(queryVector, {
        topK: 6,
        returnMetadata: "all"
      });

      if (!matches.matches.length) {
        return "Không tìm thấy tài liệu liên quan.";
      }

      const results: string[] = [];
      for (const match of matches.matches) {
        const raw = await env.CHUNKS.get(`chunk:${match.id}`);
        if (raw) {
          const chunk = JSON.parse(raw) as {
            text: string;
            module: string;
            title?: string;
            doc_type?: string;
            audience?: string;
            heading: string;
            section_path?: string;
          };
          const source = [
            chunk.title ?? chunk.module,
            chunk.audience,
            chunk.section_path ?? chunk.heading
          ].filter(Boolean).join(" | ");
          results.push(`[Nguồn: ${source}]\n${chunk.text}`);
        }
      }

      return results.length
        ? results.join("\n\n---\n\n")
        : "Không tìm thấy nội dung chunk tương ứng.";
    }

    case "get_workflow": {
      const id = tool.arguments.id;
      if (!id) return "Lỗi: bắt buộc phải có ID workflow.";

      // TODO: thay mock bằng API Zilcode thật khi đã có token
      // const res = await fetch(`https://api.zilcode.io/workflows/${id}`, {
      //   headers: { Authorization: `Bearer ${env.ZILCODE_API_TOKEN}` }
      // });
      // return await res.text();

      return JSON.stringify({
        _mock: true,
        id,
        name: `Workflow ${id}`,
        status: "đang hoạt động",
        nodes: [
          { id: "start", type: "trigger", label: "Bắt đầu" },
          {
            id: "condition-1",
            type: "condition",
            label: "Kiểm tra số tiền",
            config: { field: "amount", operator: ">", value: 1000 }
          },
          { id: "send-mail", type: "action", label: "Gửi email" },
          { id: "end", type: "end", label: "Kết thúc" }
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
      return `Không nhận diện được công cụ: ${tool.name}`;
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

interface RouteDecision {
  intent: RouteIntent;
  needs_tools: boolean;
  tools: ToolName[];
  search_query: string | null;
  reason: string;
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6;

const ROUTER_PROMPT = `Bạn là router intent cho chatbot Zilcode.
Nhiệm vụ của bạn chỉ là phân loại tin nhắn người dùng để backend biết có cần bật công cụ hay không.
Không trả lời người dùng. Không gọi công cụ. Chỉ trả về JSON hợp lệ, không markdown, không giải thích ngoài JSON.

Intent:
- "direct_chat": chào hỏi, cảm ơn, trò chuyện thông thường, câu hỏi về khả năng của trợ lý, câu hỏi kiến thức chung, hoặc câu hỏi không cần dữ liệu Zilcode.
- "rag_search": cần tra cứu tài liệu Zilcode như hướng dẫn sử dụng, tính năng, thao tác, quản trị, SQL Cloud, App Builder, import/export, thêm/sửa/xóa dữ liệu.
- "screen_context": hỏi về đối tượng/màn hình/node hiện tại như "cái này", "ở đây", "màn hình hiện tại", "node này", "workflow này" mà không có ID rõ ràng.
- "workflow": hỏi về workflow có ID rõ ràng.
- "mixed": cần nhiều hơn một loại dữ liệu.

Tool mapping:
- direct_chat -> []
- rag_search -> ["rag_search"]
- screen_context -> ["get_screen_context", "get_workflow"] nếu có thể cần đọc workflow sau khi biết ngữ cảnh; nếu không thì ["get_screen_context"]
- workflow -> ["get_workflow"]
- mixed -> danh sách các tool thật sự cần

Trả về đúng schema:
{
  "intent": "direct_chat" | "rag_search" | "screen_context" | "workflow" | "mixed",
  "needs_tools": boolean,
  "tools": string[],
  "search_query": string | null,
  "reason": string
}

Ví dụ:
User: "hello" -> {"intent":"direct_chat","needs_tools":false,"tools":[],"search_query":null,"reason":"Chào hỏi thông thường"}
User: "xin chào, bạn là gì" -> {"intent":"direct_chat","needs_tools":false,"tools":[],"search_query":null,"reason":"Hỏi về trợ lý, không cần tài liệu"}
User: "cách import dữ liệu trong Zilcode" -> {"intent":"rag_search","needs_tools":true,"tools":["rag_search"],"search_query":"import dữ liệu trong Zilcode hướng dẫn người dùng","reason":"Cần tra cứu tài liệu Zilcode"}
User: "workflow này lỗi ở đâu" -> {"intent":"screen_context","needs_tools":true,"tools":["get_screen_context","get_workflow"],"search_query":null,"reason":"Cần biết workflow hiện tại trước khi phân tích"}
User: "workflow wf-001 có những node gì" -> {"intent":"workflow","needs_tools":true,"tools":["get_workflow"],"search_query":null,"reason":"Có workflow ID rõ ràng"}`;

function defaultRouteDecision(reason: string): RouteDecision {
  return {
    intent: "direct_chat",
    needs_tools: false,
    tools: [],
    search_query: null,
    reason
  };
}

function extractJsonObject(raw: string): string {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Router response does not contain a JSON object");
  }

  return cleaned.slice(start, end + 1);
}

function parseRouteDecision(raw: string): RouteDecision {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<RouteDecision>;
  const validIntents: RouteIntent[] = [
    "direct_chat",
    "rag_search",
    "screen_context",
    "workflow",
    "mixed"
  ];

  const intent = validIntents.includes(parsed.intent as RouteIntent)
    ? parsed.intent as RouteIntent
    : "direct_chat";

  const tools = Array.isArray(parsed.tools)
    ? parsed.tools.filter((tool): tool is ToolName =>
        VALID_TOOL_NAMES.includes(tool as ToolName)
      )
    : [];

  if (intent === "direct_chat") {
    return defaultRouteDecision(parsed.reason || "Router chọn trả lời trực tiếp");
  }

  return {
    intent,
    needs_tools: Boolean(parsed.needs_tools) && tools.length > 0,
    tools,
    search_query: typeof parsed.search_query === "string" && parsed.search_query.trim()
      ? parsed.search_query.trim()
      : null,
    reason: parsed.reason || "Router không nêu lý do"
  };
}

async function routeMessage(userMessage: string, env: Env): Promise<RouteDecision> {
  try {
    const response = await env.AI.run(ROUTER_MODEL, {
      messages: [
        { role: "system", content: ROUTER_PROMPT },
        { role: "user", content: userMessage }
      ]
    }) as { response?: string };

    const route = parseRouteDecision(response.response ?? "");
    console.log(`[ROUTER] intent=${route.intent}; tools=${route.tools.join(",") || "none"}; reason=${route.reason}`);
    return route;
  } catch (error) {
    console.log(
      `[ROUTER] Fallback direct_chat: ${error instanceof Error ? error.message : "unknown error"}`
    );
    return defaultRouteDecision("Router lỗi hoặc trả JSON không hợp lệ");
  }
}

function toolsForRoute(route: RouteDecision): ToolDefinition[] {
  if (!route.needs_tools || route.tools.length === 0) return [];
  return TOOLS.filter(tool => route.tools.includes(tool.name as ToolName));
}

function buildRouterContext(route: RouteDecision, selectedTools: ToolDefinition[]): string {
  const selectedToolNames = selectedTools.map(tool => tool.name);

  return [
    "Quyết định router cho lượt này:",
    `- intent: ${route.intent}`,
    `- needs_tools: ${route.needs_tools}`,
    `- tools được bật: ${selectedToolNames.length ? selectedToolNames.join(", ") : "không có"}`,
    `- search_query gợi ý: ${route.search_query ?? "không có"}`,
    `- lý do: ${route.reason}`,
    "Chỉ dùng các công cụ đã được bật trong lượt này. Nếu không có công cụ nào được bật, hãy trả lời trực tiếp."
  ].join("\n");
}

async function runAgenticLoop(
  userMessage: string,
  env: Env,
  screenContext?: ScreenContext
): Promise<{ answer: string; toolsCalled: string[]; route: RouteDecision }> {

  const route = await routeMessage(userMessage, env);
  const selectedTools = toolsForRoute(route);
  const routerContext = buildRouterContext(route, selectedTools);

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Bạn là trợ lý AI hội thoại và trợ lý hỗ trợ nền tảng Zilcode.
Bạn có thể trả lời trực tiếp bằng kiến thức chung và khả năng hội thoại của mình. Bạn không bị giới hạn trong các công cụ được cung cấp.
Hãy trả lời bằng cùng ngôn ngữ với người hỏi. Nếu người hỏi yêu cầu một ngôn ngữ hoặc phong cách cụ thể, hãy làm theo yêu cầu đó.
Nếu người dùng chào hỏi, cảm ơn, trò chuyện thông thường, hoặc hỏi câu không cần dữ liệu Zilcode, hãy trả lời tự nhiên và không nói rằng nhiệm vụ nằm ngoài phạm vi công cụ.
Công cụ chỉ là nguồn bổ sung khi cần dữ liệu cụ thể. Trước khi gọi công cụ, hãy tự hỏi: mình có thể trả lời tốt mà không cần công cụ không? Nếu có, hãy trả lời trực tiếp.
Chỉ dùng rag_search khi câu hỏi cần thông tin cụ thể từ tài liệu Zilcode, ví dụ tính năng, khái niệm, hướng dẫn thao tác, hoặc cách sử dụng Zilcode.
Khi dùng rag_search, thường chỉ gọi một lần với query tổng hợp tốt. Chỉ gọi lại nếu kết quả chưa đủ và query mới khác rõ ràng về ý định hoặc phạm vi; không gọi lại cùng query hoặc query tương đương.
Chỉ dùng get_screen_context khi người dùng hỏi về đối tượng đang hiển thị/được chọn trong UI và câu trả lời phụ thuộc vào màn hình/node/tài nguyên hiện tại. Không dùng get_screen_context chỉ vì người dùng đang chat.
Chỉ dùng get_workflow khi có workflow ID rõ ràng hoặc sau khi có screen context cho thấy tài nguyên hiện tại là workflow cần phân tích.
Với câu hỏi ngoài phạm vi Zilcode, hãy trả lời như một trợ lý thông thường.
Sau khi đã có đủ thông tin từ công cụ, hãy trả lời ngay thay vì tiếp tục gọi thêm công cụ.
Khi đã dùng rag_search nhưng không tìm thấy thông tin phù hợp, hãy nói rõ là chưa tìm thấy trong tài liệu hiện có thay vì bịa nội dung.
Trả lời ngắn gọn, cụ thể, ưu tiên các bước thao tác rõ ràng.

${routerContext}`
    },
    {
      role: "user",
      content: userMessage
    }
  ];

  const toolsCalled: string[] = [];

  if (selectedTools.length === 0) {
    const response = await env.AI.run(CHAT_MODEL, { messages }) as { response?: string };
    return {
      answer: response.response ?? "Không tạo được câu trả lời.",
      toolsCalled,
      route
    };
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[VÒNG LẶP] Lần ${i + 1}`);

    const response = await env.AI.run(CHAT_MODEL, {
      messages,
      tools: selectedTools
    }) as {
      response?: string;
      tool_calls?: Array<{
        name: string;
        arguments: Record<string, string>;
        id?: string;
      }>;
    };

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`[VÒNG LẶP] Không có tool call, trả về câu trả lời cuối cùng`);
      return {
        answer: response.response ?? "Không tạo được câu trả lời.",
        toolsCalled,
        route
      };
    }

    for (const toolCall of response.tool_calls) {
      console.log(`[CÔNG CỤ] Gọi: ${toolCall.name}`, toolCall.arguments);
      toolsCalled.push(toolCall.name);

      const toolResult = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        screenContext
      );

      console.log(`[CÔNG CỤ] Độ dài kết quả: ${toolResult.length} ký tự`);

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
    answer: "Đã đạt số vòng gọi công cụ tối đa nhưng chưa tạo được câu trả lời cuối cùng.",
    toolsCalled,
    route
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
        message: "Workers AI đang chạy",
        tools: TOOLS.map(t => t.name)
      }, { headers: CORS });
    }

    // ── POST /chat — agentic chat ────────────────────────────────────────────
    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json() as ChatRequest;

        if (!body.message) {
          return Response.json(
            { success: false, error: "Bắt buộc phải có trường message." },
            { status: 400, headers: CORS }
          );
        }

        const { answer, toolsCalled, route } = await runAgenticLoop(
          body.message,
          env,
          body.context
        );

        return Response.json({
          success: true,
          response: answer,
          tools_called: toolsCalled,
          route: {
            intent: route.intent,
            needs_tools: route.needs_tools,
            tools: route.tools,
            search_query: route.search_query,
            reason: route.reason
          }
        }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lỗi không xác định"
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
            { success: false, error: "Bắt buộc phải có trường text." },
            { status: 400, headers: CORS }
          );
        }

        const embedding = await env.AI.run(EMBEDDING_MODEL, { text: body.text });
        return Response.json({ success: true, embedding }, { headers: CORS });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lỗi không xác định"
          },
          { status: 500, headers: CORS }
        );
      }
    }

    return new Response("Không tìm thấy", { status: 404, headers: CORS });
  }
};
