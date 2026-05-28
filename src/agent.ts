import {
  CHAT_MODEL,
  GENERAL_CHAT_MAX_TOKENS,
  GENERAL_CHAT_MODEL,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_MESSAGES,
  RAG_FINAL_MAX_TOKENS,
  TOOL_RESULT_CONTEXT_MAX_CHARS,
  TOOL_SELECTION_MAX_TOKENS,
  type Env
} from "./config";
import { runChatModel, searchRag } from "./ai";
import { addDebugStep, type DebugStep } from "./debug";
import { TOOLS } from "./tools";
import { asRecord, getStringArg } from "./utils";
import {
  isAppBuilderGraphTool,
  runAppBuilderGraphTool
} from "./app-builder-graph";
import {
  noZilcodeSessionResult,
  type ZilcodeSessionState
} from "./zilcode";
import type {
  AgenticLoopResult,
  AIMessage,
  ChatHistoryMessage,
  EmbeddingDebug,
  RagQueryDebug,
  RagSource,
  ToolCall,
  ToolExecutionResult,
  ToolResultRecord
} from "./types";

const MAX_ITERATIONS = 6;
const AVAILABLE_TOOL_NAMES = new Set<string>(TOOLS.map(tool => tool.name));
const GRAPH_CONTINUE_TOOLS = new Set([
  "app_builder_graph_overview",
  "app_builder_graph_search",
  "app_builder_graph_subgraph"
]);

async function executeTool(
  tool: ToolCall,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[],
  zilcodeSession?: ZilcodeSessionState | null
): Promise<ToolExecutionResult> {
  switch (tool.name) {
    case "general_chat": {
      const message = getStringArg(tool.arguments, "message");
      if (!message) return { content: "Loi: bat buoc phai co tin nhan de tra loi." };

      addDebugStep(debugSteps, "tool.general_chat", "start", "Goi model chat thong thuong.", {
        model: GENERAL_CHAT_MODEL,
        history_messages: chatHistory.length
      });

      const response = await runChatModel(GENERAL_CHAT_MODEL, {
        max_tokens: GENERAL_CHAT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Ban la tro ly hoi thoai.
Tra loi truc tiep bang cung ngon ngu voi nguoi hoi, tru khi nguoi hoi yeu cau ngon ngu khac.
Dung kien thuc san co cho cau hoi chung.
Khong nhac den tool/function noi bo.`
          },
          ...chatHistory,
          { role: "user", content: message }
        ]
      }, env);

      addDebugStep(debugSteps, "tool.general_chat", "ok", "general_chat tra ket qua.", {
        response_chars: (response.response ?? "").length
      });

      return { content: response.response ?? "Khong tao duoc cau tra loi." };
    }

    case "rag_search": {
      const query = getStringArg(tool.arguments, "query");
      if (!query) return { content: "Loi: bat buoc phai co cau truy van." };
      return searchRag(query, env, chatHistory, debugSteps);
    }

    case "app_builder_graph_overview":
    case "app_builder_graph_search":
    case "app_builder_graph_subgraph":
    case "app_builder_node_detail":
    case "app_builder_creation_schema": {
      if (tool.name !== "app_builder_creation_schema" && !zilcodeSession) {
        return noZilcodeSessionResult();
      }

      addDebugStep(debugSteps, `tool.${tool.name}`, "start", `Goi ${tool.name}.`, {
        arguments: tool.arguments
      });

      const result = await runAppBuilderGraphTool(
        env,
        zilcodeSession?.session ?? null,
        tool.name,
        tool.arguments
      );
      const graph = asRecord(result.graph);

      addDebugStep(debugSteps, `tool.${tool.name}`, "ok", `${tool.name} tra ket qua.`, {
        mode: result.mode,
        graph_nodes: Array.isArray(graph?.nodes) ? graph.nodes.length : undefined,
        graph_edges: Array.isArray(graph?.edges) ? graph.edges.length : undefined,
        matches_count: result.matches_count,
        has_error: Boolean(result.error)
      });

      return { content: JSON.stringify(result, null, 2) };
    }

    default:
      return { content: `Khong nhan dien duoc cong cu: ${tool.name}` };
  }
}

function formatToolResultsForFinalAnswer(toolResults: ToolResultRecord[]): string {
  return toolResults
    .map((result, index) => [
      `[TOOL_RESULT ${index + 1}: ${result.name}]`,
      compactToolContentForFinalAnswer(result),
      `[END_TOOL_RESULT ${index + 1}]`
    ].join("\n"))
    .join("\n\n");
}

function compactToolContentForFinalAnswer(result: ToolResultRecord): string {
  if (!isAppBuilderGraphTool(result.name)) return result.content;

  try {
    const data = JSON.parse(result.content) as Record<string, unknown>;
    const graph = asRecord(data.graph);
    const nodes = Array.isArray(graph?.nodes)
      ? graph.nodes
        .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object")
        .map(node => ({
          id: node.id,
          type: node.type,
          label: node.label,
          summary: node.summary,
          counts: node.counts,
          has_detail: node.has_detail
        }))
      : undefined;
    const edges = Array.isArray(graph?.edges)
      ? graph.edges
        .filter((edge): edge is Record<string, unknown> => Boolean(edge) && typeof edge === "object")
        .map(edge => ({
          from: edge.from,
          to: edge.to,
          type: edge.type,
          metadata: edge.metadata
        }))
      : undefined;

    return JSON.stringify({
      ...data,
      graph: graph ? {
        node_counts: graph.node_counts,
        edge_counts: graph.edge_counts,
        nodes_count: graph.nodes_count,
        edges_count: graph.edges_count,
        nodes,
        edges
      } : undefined
    }, null, 2);
  } catch {
    return result.content;
  }
}

function truncateToolContext(context: string): string {
  if (context.length <= TOOL_RESULT_CONTEXT_MAX_CHARS) return context;

  return [
    context.slice(0, TOOL_RESULT_CONTEXT_MAX_CHARS).trim(),
    "",
    `[SYSTEM_NOTE: Tool context was truncated. Original length: ${context.length} chars.]`
  ].join("\n");
}

function cleanMarkdownArtifacts(answer: string): string {
  return answer
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .trim();
}

export function sanitizeChatHistory(history: unknown): AIMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter((message): message is ChatHistoryMessage =>
      message
      && typeof message === "object"
      && (message as ChatHistoryMessage).role !== undefined
      && ((message as ChatHistoryMessage).role === "user" || (message as ChatHistoryMessage).role === "assistant")
      && typeof (message as ChatHistoryMessage).content === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_HISTORY_CONTENT_CHARS)
    }))
    .filter(message => message.content.length > 0);
}

async function createFinalAnswerFromRag(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<string> {
  addDebugStep(debugSteps, "rag.final_answer", "start", "Tao cau tra loi cuoi tu RAG/context.", {
    model: CHAT_MODEL,
    tool_results: toolResults.length,
    history_messages: chatHistory.length
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_FINAL_MAX_TOKENS,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Ban la tro ly Zilcode.
Tra loi bang cung ngon ngu voi nguoi hoi.
Du lieu co the gom RAG docs va App Builder graph tool results.
Neu tai lieu khong du, noi ro phan nao chua chac.
Khong nhac den tool/function noi bo.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${formatToolResultsForFinalAnswer(toolResults)}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Khong tao duoc cau tra loi.");
  addDebugStep(debugSteps, "rag.final_answer", "ok", "Da tao cau tra loi cuoi tu RAG/context.", {
    answer_chars: answer.length
  });

  return answer;
}

async function createFinalAnswerFromToolResults(
  userMessage: string,
  toolResults: ToolResultRecord[],
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[]
): Promise<string> {
  const toolContext = truncateToolContext(formatToolResultsForFinalAnswer(toolResults));

  addDebugStep(debugSteps, "tools.final_answer", "start", "Tao cau tra loi cuoi tu ket qua tool.", {
    model: CHAT_MODEL,
    tool_results: toolResults.map(result => result.name),
    context_chars: toolContext.length
  });

  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: RAG_FINAL_MAX_TOKENS,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Ban la tro ly Zilcode/App Builder.
Tra loi bang cung ngon ngu voi nguoi hoi.
Doc ket qua graph theo cach de hieu cho nguoi dung cuoi, khong viet nhu log ky thuat.
Neu nguoi dung hoi ve he thong, tom tat: session, apps, tables/windows/menus chinh, quan he can chu y, va phan chua doc duoc neu co.
Neu nguoi dung yeu cau tao/sua app/table/window/tab/field/menu, chi de xuat plan dua tren graph va creation_schema. Khong noi rang da ghi du lieu vi hien tai khong co write tool active.
Khong nhac den tool/function noi bo.`
      },
      ...chatHistory,
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: `Context:\n${toolContext}`
      }
    ]
  }, env);

  const answer = cleanMarkdownArtifacts(response.response ?? "Khong tao duoc cau tra loi.");
  addDebugStep(debugSteps, "tools.final_answer", "ok", "Da tao cau tra loi cuoi tu ket qua tool.", {
    answer_chars: answer.length
  });

  return answer;
}

export async function runAgenticLoop(
  userMessage: string,
  env: Env,
  chatHistory: AIMessage[] = [],
  debugSteps?: DebugStep[],
  zilcodeSession?: ZilcodeSessionState | null
): Promise<AgenticLoopResult> {
  addDebugStep(debugSteps, "agent.start", "start", "Bat dau agentic loop.", {
    message_chars: userMessage.length,
    history_messages: chatHistory.length,
    tools: TOOLS.map(tool => tool.name)
  });

  const messages: AIMessage[] = [
    {
      role: "system",
      content: `Ban la tro ly AI cho Zilcode va App Builder.
Tra loi bang cung ngon ngu voi nguoi dung.

Tools:
- general_chat: dung cho hoi thoai thong thuong, khong can RAG/Zilcode.
- rag_search: dung khi can docs/guide/API contract/playbook.
- app_builder_graph_overview: dung dau tien khi can doc App Builder hien tai. Tool nay tra skeleton graph.
- app_builder_graph_search: tim node app/table/window/tab/field/menu/domain theo ten/id.
- app_builder_graph_subgraph: mo vung graph lien quan quanh node.
- app_builder_node_detail: lay chi tiet node cu the.
- app_builder_creation_schema: lay quy tac tao/sua va proposed plan format.

Graph-first workflow:
1. Neu cau hoi lien quan App Builder/Zilcode hien tai, goi app_builder_graph_overview truoc.
2. Neu can tim mot doi tuong, goi app_builder_graph_search.
3. Neu can hieu quan he quanh doi tuong, goi app_builder_graph_subgraph.
4. Neu can lap plan chinh xac hoac tra loi chi tiet, goi app_builder_node_detail.
5. Neu user muon tao/sua, goi app_builder_creation_schema va tao Proposed plan. Hien tai khong co write tool active, nen khong noi la da ghi du lieu.

Dung rag_search khi can tai lieu huong dan/API contract, nhat la khi khong chac quy tac tao/sua.
Sau khi co du thong tin, tra loi ngay. Khong goi tool lap lai neu khong co cau hoi moi ro rang.`
    },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];

  const toolsCalled: string[] = [];
  const toolResults: ToolResultRecord[] = [];
  const ragSources: RagSource[] = [];
  let embeddingDebug: EmbeddingDebug | undefined;
  let ragQueryDebug: RagQueryDebug | undefined;
  let hasRagSearchResult = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    addDebugStep(debugSteps, "agent.tool_selection", "start", "Model chon tool hoac tra loi truc tiep.", {
      iteration: i + 1,
      model: CHAT_MODEL,
      messages: messages.length,
      max_tokens: TOOL_SELECTION_MAX_TOKENS
    });

    const response = await runChatModel(CHAT_MODEL, {
      max_tokens: TOOL_SELECTION_MAX_TOKENS,
      messages,
      tools: TOOLS
    }, env);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model khong goi tool, tra loi truc tiep.", {
        iteration: i + 1,
        response_chars: (response.response ?? "").length
      });

      const directAnswer = response.response?.trim();
      if (directAnswer) {
        return {
          answer: directAnswer,
          toolsCalled
        };
      }

      if (toolResults.length > 0) {
        const finalAnswer = await createFinalAnswerFromToolResults(
          userMessage,
          toolResults,
          env,
          chatHistory,
          debugSteps
        );

        return {
          answer: finalAnswer,
          toolsCalled,
          sources: ragSources,
          embedding_debug: embeddingDebug,
          rag_query_debug: ragQueryDebug
        };
      }

      return {
        answer: "Khong tao duoc cau tra loi.",
        toolsCalled
      };
    }

    const supportedToolCalls = response.tool_calls.filter(toolCall => AVAILABLE_TOOL_NAMES.has(toolCall.name));
    const skippedUnsupportedToolCalls = response.tool_calls
      .filter(toolCall => !AVAILABLE_TOOL_NAMES.has(toolCall.name))
      .map(toolCall => toolCall.name);

    if (!supportedToolCalls.length) {
      addDebugStep(debugSteps, "agent.tool_selection", "skip", "Model chon tool khong duoc ho tro.", {
        iteration: i + 1,
        tool_calls: response.tool_calls.map(toolCall => toolCall.name),
        skipped_tool_calls: skippedUnsupportedToolCalls
      });

      return {
        answer: response.response ?? "Model da chon tool khong con duoc ho tro. Hay thu hoi lai theo cach khac.",
        toolsCalled
      };
    }

    const hasRagSearchCall = supportedToolCalls.some(toolCall => toolCall.name === "rag_search");
    const toolCallsToExecute = hasRagSearchCall
      ? supportedToolCalls.filter(toolCall => toolCall.name !== "general_chat")
      : supportedToolCalls;

    addDebugStep(debugSteps, "agent.tool_selection", "ok", "Model da chon tool.", {
      iteration: i + 1,
      tool_calls: response.tool_calls.map(toolCall => toolCall.name),
      executed_tool_calls: toolCallsToExecute.map(toolCall => toolCall.name),
      skipped_tool_calls: skippedUnsupportedToolCalls,
      skipped_general_chat_because_rag: hasRagSearchCall && toolCallsToExecute.length !== supportedToolCalls.length
    });

    let generalChatResult: string | null = null;
    let shouldLetModelInspectToolResult = false;

    for (const toolCall of toolCallsToExecute) {
      toolsCalled.push(toolCall.name);
      addDebugStep(debugSteps, "tool.call", "start", `Goi tool ${toolCall.name}.`, {
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      const toolExecution = await executeTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        env,
        chatHistory,
        debugSteps,
        zilcodeSession
      );
      const toolResult = toolExecution.content;

      addDebugStep(debugSteps, "tool.call", "ok", `Tool ${toolCall.name} da tra ket qua.`, {
        name: toolCall.name,
        result_chars: toolResult.length
      });

      toolResults.push({ name: toolCall.name, content: toolResult });

      if (toolCall.name === "rag_search" && toolExecution.sources?.length) {
        ragSources.push(...toolExecution.sources);
      }
      if (toolCall.name === "rag_search" && toolExecution.embedding_debug) {
        embeddingDebug = toolExecution.embedding_debug;
      }
      if (toolCall.name === "rag_search" && toolExecution.rag_query_debug) {
        ragQueryDebug = toolExecution.rag_query_debug;
      }

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
        content: truncateToolContext(compactToolContentForFinalAnswer({
          name: toolCall.name,
          content: toolResult
        }))
      });

      if (toolCall.name === "general_chat") generalChatResult = toolResult;
      if (toolCall.name === "rag_search") hasRagSearchResult = true;
      if (GRAPH_CONTINUE_TOOLS.has(toolCall.name)) shouldLetModelInspectToolResult = true;
    }

    if (hasRagSearchResult) {
      const finalAnswer = await createFinalAnswerFromRag(
        userMessage,
        toolResults,
        env,
        chatHistory,
        debugSteps
      );

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      };
    }

    if (generalChatResult) {
      return {
        answer: generalChatResult,
        toolsCalled
      };
    }

    if (toolResults.length > 0) {
      if (shouldLetModelInspectToolResult && i < MAX_ITERATIONS - 1) {
        addDebugStep(debugSteps, "agent.graph_continue", "ok", "Dua graph/search/subgraph ve model de quyet dinh tra loi hoac goi detail.", {
          next_iteration: i + 2
        });
        continue;
      }

      const finalAnswer = await createFinalAnswerFromToolResults(
        userMessage,
        toolResults,
        env,
        chatHistory,
        debugSteps
      );

      return {
        answer: finalAnswer,
        toolsCalled,
        sources: ragSources,
        embedding_debug: embeddingDebug,
        rag_query_debug: ragQueryDebug
      };
    }
  }

  addDebugStep(debugSteps, "agent.stop", "error", "Dat so vong goi tool toi da.", {
    max_iterations: MAX_ITERATIONS
  });

  if (toolResults.length > 0) {
    const finalAnswer = await createFinalAnswerFromToolResults(
      userMessage,
      toolResults,
      env,
      chatHistory,
      debugSteps
    );

    return {
      answer: finalAnswer,
      toolsCalled,
      sources: ragSources,
      embedding_debug: embeddingDebug,
      rag_query_debug: ragQueryDebug
    };
  }

  return {
    answer: "Da dat so vong goi cong cu toi da nhung chua tao duoc cau tra loi cuoi cung.",
    toolsCalled
  };
}
