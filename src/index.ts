// src/index.ts

import { CORS, EMBEDDING_MODEL, type Env } from "./config";
import { TOOLS } from "./tools";
import {
  cleanupConversationJobs,
  handleConversationMessage,
  handleCreateConversation,
  handleDeleteConversation,
  handleGetConversation,
  handleGetJob,
  handleGetJobEvents,
  handleListConversations,
  handleCancelPendingAction,
  handleConfirmPendingAction,
  runConversationJob
} from "./conversations";
import { handleZilcodeLogin, handleZilcodeLogout, handleZilcodeMe, handleZilcodeSelectRoleOrg } from "./zilcode";

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

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
        () => handleConversationMessage(request, env, decodeURIComponent(conversationMessageMatch[1]), ctx),
        "Lỗi gửi tin nhắn."
      );
    }

    const jobEventsMatch = url.pathname.match(/^\/jobs\/([^/]+)\/events$/);
    if (jobEventsMatch && request.method === "GET") {
      return handleRoute(
        () => handleGetJobEvents(request, env, decodeURIComponent(jobEventsMatch[1])),
        "Lỗi tải sự kiện job."
      );
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch && request.method === "GET") {
      return handleRoute(
        () => handleGetJob(request, env, decodeURIComponent(jobMatch[1])),
        "Lỗi tải trạng thái job."
      );
    }

    const pendingActionMatch = url.pathname.match(/^\/pending-actions\/([^/]+)\/(confirm|cancel)$/);
    if (pendingActionMatch && request.method === "POST") {
      const actionId = decodeURIComponent(pendingActionMatch[1]);
      const action = pendingActionMatch[2];
      return handleRoute(
        () => action === "confirm"
          ? handleConfirmPendingAction(request, env, actionId, ctx)
          : handleCancelPendingAction(request, env, actionId),
        "Lỗi xử lý pending action."
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

    // ── Legacy POST /chat — retired to avoid synchronous agent timeouts ───────
    if (url.pathname === "/chat" && request.method === "POST") {
      return Response.json({
        success: false,
        error: "Endpoint /chat đã ngừng dùng để tránh timeout. Hãy dùng POST /conversations/{conversation_id}/messages và poll /jobs/{job_id}."
      }, { status: 410, headers: CORS });
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
  },

  async queue(batch: MessageBatch<{ job_id: string }>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await runConversationJob(env, String(message.body?.job_id || ""));
        message.ack();
      } catch (error) {
        console.error("Agent job failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const result = await cleanupConversationJobs(env);
      console.log("Agent job cleanup completed", result);
    } catch (error) {
      console.error("Agent job cleanup failed", error);
    }
  }
};


