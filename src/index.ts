// src/index.ts

import { CORS, EMBEDDING_MODEL, MAX_HISTORY_MESSAGES, type Env } from "./config";
import { addDebugStep, type DebugStep } from "./debug";
import { runAgenticLoop, sanitizeChatHistory } from "./agent";
import { TOOLS } from "./tools";
import {
  handleConversationMessage,
  handleCreateConversation,
  handleDeleteConversation,
  handleGetConversation,
  handleListConversations
} from "./conversations";
import { handleZilcodeLogin, handleZilcodeLogout, handleZilcodeMe, handleZilcodeSelectRoleOrg, loadZilcodeSession } from "./zilcode";
import type { ChatRequest } from "./types";

function routeErrorResponse(error: unknown, fallbackMessage: string): Response {
  return Response.json(
    {
      success: false,
      error: error instanceof Error ? error.message : fallbackMessage
    },
    { status: 500, headers: CORS }
  );
}

async function handleRoute(handler: () => Promise<Response>, fallbackMessage: string): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return routeErrorResponse(error, fallbackMessage);
  }
}

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

    // ── Legacy auth endpoints for standalone/dev chat ────────────────────────
    if (url.pathname === "/auth/login" && request.method === "POST") {
      try {
        return await handleZilcodeLogin(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lỗi đăng nhập Zilcode." },
          { status: 500, headers: CORS }
        );
      }
    }

    if (url.pathname === "/auth/select-role-org" && request.method === "POST") {
      try {
        return await handleZilcodeSelectRoleOrg(request, env);
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Lỗi chọn role/org Zilcode." },
          { status: 500, headers: CORS }
        );
      }
    }

    if (url.pathname === "/auth/me" && request.method === "GET") {
      return handleZilcodeMe(request, env);
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return handleZilcodeLogout(request, env);
    }

    // ── Server-side conversations for embedded Zilcode integration ───────────
    if (url.pathname === "/conversations" && request.method === "POST") {
      return handleRoute(
        () => handleCreateConversation(request, env),
        "Lỗi tạo đoạn chat."
      );
    }

    if (url.pathname === "/conversations" && request.method === "GET") {
      return handleRoute(
        () => handleListConversations(request, env),
        "Lỗi tải danh sách đoạn chat."
      );
    }

    const conversationMessageMatch = url.pathname.match(/^\/conversations\/([^/]+)\/messages$/);
    if (conversationMessageMatch && request.method === "POST") {
      return handleRoute(
        () => handleConversationMessage(request, env, decodeURIComponent(conversationMessageMatch[1])),
        "Lỗi gửi tin nhắn."
      );
    }

    const conversationMatch = url.pathname.match(/^\/conversations\/([^/]+)$/);
    if (conversationMatch && request.method === "GET") {
      return handleRoute(
        () => handleGetConversation(request, env, decodeURIComponent(conversationMatch[1])),
        "Lỗi tải đoạn chat."
      );
    }

    if (conversationMatch && request.method === "DELETE") {
      return handleRoute(
        () => handleDeleteConversation(request, env, decodeURIComponent(conversationMatch[1])),
        "Lỗi xóa đoạn chat."
      );
    }

    // ── Legacy POST /chat — kept for old standalone clients ──────────────────
    if (url.pathname === "/chat" && request.method === "POST") {
      let debugSteps: DebugStep[] | undefined;

      try {
        const body = await request.json() as ChatRequest;

        if (!body.message) {
          return Response.json(
            { success: false, error: "Bắt buộc phải có trường message." },
            { status: 400, headers: CORS }
          );
        }

        const debugEnabled = body.debug === true;
        debugSteps = debugEnabled ? [] as DebugStep[] : undefined;
        const zilcodeSession = await loadZilcodeSession(request, env);

        addDebugStep(debugSteps, "request.received", "ok", "Worker nhận request /chat.", {
          message_chars: body.message.length,
          raw_history_messages: Array.isArray(body.history) ? body.history.length : 0,
          has_zilcode_session: Boolean(zilcodeSession)
        });

        const chatHistory = sanitizeChatHistory(body.history);
        addDebugStep(debugSteps, "history.sanitized", "ok", "Làm sạch history trước khi đưa vào model.", {
          history_messages: chatHistory.length,
          max_history_messages: MAX_HISTORY_MESSAGES
        });

        const { answer, toolsCalled, sources, embedding_debug, rag_query_debug } = await runAgenticLoop(
          body.message,
          env,
          chatHistory,
          debugSteps,
          zilcodeSession
        );

        addDebugStep(debugSteps, "response.ready", "ok", "Chuẩn bị trả response về client.", {
          tools_called: toolsCalled,
          answer_chars: answer.length,
          sources: sources?.length ?? 0
        });

        return Response.json({
          success: true,
          response: answer,
          tools_called: toolsCalled,
          sources,
          embedding_debug,
          rag_query_debug,
          debug_steps: debugSteps
        }, { headers: CORS });

      } catch (error) {
        addDebugStep(debugSteps, "response.error", "error", "Worker gặp lỗi khi xử lý /chat.", {
          error: error instanceof Error ? error.message : "Lỗi không xác định"
        });

        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Lỗi không xác định",
            debug_steps: debugSteps
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


