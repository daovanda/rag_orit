import {
  handleConversationMessage,
  handleCreateConversation,
  handleDeleteConversation,
  handleGetConversation,
  handleGetJob,
  handleListConversations,
  handleCancelPendingAction,
  handleConfirmPendingAction,
  runConversationJob
} from "../src/conversations";
import type { Env } from "../src/config";

type TableName = "conversations" | "messages" | "jobs" | "job_events" | "pending_actions";
type Row = Record<string, any>;

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createKv(): KVNamespace {
  const kv = new Map<string, string>();
  return {
    get: async (key: string) => kv.get(key) ?? null,
    put: async (key: string, value: string) => { kv.set(key, value); },
    delete: async (key: string) => { kv.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: "" })
  } as unknown as KVNamespace;
}

class MemoryD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    this.db.run(this.sql, this.values);
    return { success: true, meta: { duration: 0 } } as D1Result;
  }

  async first<T = Row>(): Promise<T | null> {
    return this.db.first(this.sql, this.values) as T | null;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    return { success: true, results: this.db.all(this.sql, this.values) as T[], meta: { duration: 0 } } as D1Result<T>;
  }
}

class MemoryD1 {
  readonly tables: Record<TableName, Row[]> = {
    conversations: [],
    messages: [],
    jobs: [],
    job_events: [],
    pending_actions: []
  };

  prepare(sql: string): D1PreparedStatement {
    return new MemoryD1Statement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  private normalized(sql: string): string {
    return sql.replace(/\s+/g, " ").trim().toLowerCase();
  }

  run(sql: string, values: unknown[]): void {
    const q = this.normalized(sql);

    if (q.startsWith("insert into conversations")) {
      const [conversation_id, user_key, userid, sitecode, roleid, orgid, title, created_at, updated_at] = values;
      this.tables.conversations.push({ conversation_id, user_key, userid, sitecode, roleid, orgid, title, created_at, updated_at, deleted_at: null });
      return;
    }

    if (q.startsWith("insert into messages")) {
      if (q.includes("'user'")) {
        const [message_id, conversation_id, user_key, content, mode, created_at] = values;
        this.tables.messages.push({ message_id, conversation_id, user_key, role: "user", content, status: "completed", mode, tools_called_json: null, sources_json: null, debug_steps_json: null, action_state_json: null, error: null, created_at, updated_at: created_at });
      } else {
        const [message_id, conversation_id, user_key, mode, created_at] = values;
        this.tables.messages.push({ message_id, conversation_id, user_key, role: "assistant", content: "", status: "generating", mode, tools_called_json: null, sources_json: null, debug_steps_json: null, action_state_json: null, error: null, created_at, updated_at: created_at });
      }
      return;
    }

    if (q.startsWith("insert into jobs")) {
      if (q.includes("'apply_pending_action'")) {
        const [job_id, conversation_id, user_key, user_message_id, assistant_message_id, auth_context_json, payload_json, created_at, expires_at] = values;
        this.tables.jobs.push({ job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind: "apply_pending_action", mode: "default", status: "queued", stage: "queued", progress_text: "Job apply plan đã được đưa vào hàng chờ.", error: null, idempotency_key: null, auth_context_json, payload_json, created_at, updated_at: created_at, finished_at: null, expires_at });
      } else {
        const [job_id, conversation_id, user_key, user_message_id, assistant_message_id, mode, idempotency_key, auth_context_json, payload_json, created_at, expires_at] = values;
        this.tables.jobs.push({ job_id, conversation_id, user_key, user_message_id, assistant_message_id, kind: "message", mode, status: "queued", stage: "queued", progress_text: "Job đã được đưa vào hàng chờ.", error: null, idempotency_key, auth_context_json, payload_json, created_at, updated_at: created_at, finished_at: null, expires_at });
      }
      return;
    }

    if (q.startsWith("insert into job_events")) {
      const [event_id, job_id, user_key, seq, type, payload_json, created_at] = values;
      this.tables.job_events.push({ event_id, job_id, user_key, seq, type, payload_json, created_at });
      return;
    }

    if (q.startsWith("insert into pending_actions")) {
      const [action_id, conversation_id, user_key, job_id, assistant_message_id, plan_id, status, payload_json, created_at, updated_at, expires_at] = values;
      this.tables.pending_actions.push({ action_id, conversation_id, user_key, job_id, assistant_message_id, plan_id, status, payload_json, created_at, updated_at, expires_at });
      return;
    }

    if (q.startsWith("update conversations set deleted_at")) {
      const [deleted_at, conversation_id, user_key] = values;
      this.tables.conversations.filter(row => row.conversation_id === conversation_id && row.user_key === user_key).forEach(row => { row.deleted_at = deleted_at; row.updated_at = deleted_at; });
      return;
    }

    if (q.startsWith("update conversations set title")) {
      const [title, updated_at, conversation_id, user_key] = values;
      this.tables.conversations.filter(row => row.conversation_id === conversation_id && row.user_key === user_key).forEach(row => { row.title = title; row.updated_at = updated_at; });
      return;
    }

    if (q.startsWith("update conversations set updated_at")) {
      const [updated_at, conversation_id, user_key] = values;
      this.tables.conversations.filter(row => row.conversation_id === conversation_id && row.user_key === user_key).forEach(row => { row.updated_at = updated_at; });
      return;
    }

    if (q.startsWith("update jobs")) {
      const [status, stage, progress_text, error, finished_at, auth_context_json, updated_at, job_id, user_key] = values;
      this.tables.jobs.filter(row => row.job_id === job_id && row.user_key === user_key).forEach(row => Object.assign(row, { status, stage, progress_text, error, finished_at, auth_context_json, updated_at }));
      return;
    }

    if (q.startsWith("update messages") && q.includes("status = 'completed'")) {
      const [content, tools_called_json, sourcesOrDebugJson, debugOrActionJson, actionMaybe, updatedMaybe, idMaybe, userKeyMaybe] = values;
      const hasSources = q.includes("sources_json");
      const message_id = hasSources ? idMaybe : updatedMaybe;
      const user_key = hasSources ? userKeyMaybe : idMaybe;
      this.tables.messages.filter(row => row.message_id === message_id && row.user_key === user_key).forEach(row => {
        row.content = content;
        row.status = "completed";
        row.tools_called_json = tools_called_json;
        if (hasSources) {
          row.sources_json = sourcesOrDebugJson;
          row.debug_steps_json = debugOrActionJson;
          row.action_state_json = actionMaybe;
          row.updated_at = updatedMaybe;
        } else {
          row.debug_steps_json = sourcesOrDebugJson;
          row.action_state_json = debugOrActionJson;
          row.updated_at = actionMaybe;
        }
      });
      return;
    }

    if (q.startsWith("update messages") && q.includes("status = 'failed'")) {
      const [content, error, debug_steps_json, updated_at, message_id, user_key] = values;
      this.tables.messages.filter(row => row.message_id === message_id && row.user_key === user_key).forEach(row => Object.assign(row, { content, status: "failed", error, debug_steps_json, updated_at }));
      return;
    }

    if (q.startsWith("update pending_actions set status = ?1")) {
      const [status, updated_at, user_key, plan_id] = values;
      this.tables.pending_actions.filter(row => row.user_key === user_key && row.plan_id === plan_id && ["waiting_confirmation", "confirmed"].includes(row.status)).forEach(row => { row.status = status; row.updated_at = updated_at; });
      return;
    }

    if (q.startsWith("update pending_actions set status = 'confirmed'")) {
      const [updated_at, action_id, user_key] = values;
      this.tables.pending_actions.filter(row => row.action_id === action_id && row.user_key === user_key).forEach(row => { row.status = "confirmed"; row.updated_at = updated_at; });
      return;
    }

    if (q.startsWith("update pending_actions set status = 'cancelled'")) {
      const [updated_at, action_id, user_key] = values;
      this.tables.pending_actions.filter(row => row.action_id === action_id && row.user_key === user_key).forEach(row => { row.status = "cancelled"; row.updated_at = updated_at; });
      return;
    }

    throw new Error(`Unhandled D1 run SQL: ${q}`);
  }

  first(sql: string, values: unknown[]): Row | null {
    return this.all(sql, values)[0] ?? null;
  }

  all(sql: string, values: unknown[]): Row[] {
    const q = this.normalized(sql);

    if (q.includes("from conversations") && q.includes("where conversation_id = ?1")) {
      const [conversation_id, user_key] = values;
      return this.tables.conversations.filter(row => row.conversation_id === conversation_id && row.user_key === user_key && row.deleted_at == null);
    }

    if (q.includes("from conversations c")) {
      const [user_key] = values;
      return this.tables.conversations
        .filter(row => row.user_key === user_key && row.deleted_at == null)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(row => ({ ...row, messages_count: this.tables.messages.filter(message => message.conversation_id === row.conversation_id && message.user_key === row.user_key).length }));
    }

    if (q.startsWith("select count(*) as count from messages")) {
      const [conversation_id, user_key] = values;
      return [{ count: this.tables.messages.filter(row => row.conversation_id === conversation_id && row.user_key === user_key).length }];
    }

    if (q.startsWith("select * from messages") && q.includes("order by created_at asc")) {
      const [conversation_id, user_key] = values;
      return this.tables.messages.filter(row => row.conversation_id === conversation_id && row.user_key === user_key).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }

    if (q.startsWith("select * from messages") && q.includes("message_id = ?1")) {
      const [message_id, user_key] = values;
      return this.tables.messages.filter(row => row.message_id === message_id && row.user_key === user_key);
    }

    if (q.startsWith("select * from messages") && q.includes("status = 'completed'")) {
      const [conversation_id, user_key, cutoff] = values;
      return this.tables.messages
        .filter(row => row.conversation_id === conversation_id && row.user_key === user_key && row.status === "completed" && row.content && String(row.created_at) < String(cutoff))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }

    if (q.startsWith("select * from jobs") && q.includes("job_id = ?1") && q.includes("user_key = ?2")) {
      const [job_id, user_key] = values;
      return this.tables.jobs.filter(row => row.job_id === job_id && row.user_key === user_key);
    }

    if (q.startsWith("select * from jobs") && q.includes("job_id = ?1")) {
      const [job_id] = values;
      return this.tables.jobs.filter(row => row.job_id === job_id);
    }

    if (q.startsWith("select * from jobs") && q.includes("idempotency_key")) {
      const [conversation_id, user_key, idempotency_key] = values;
      return this.tables.jobs.filter(row => row.conversation_id === conversation_id && row.user_key === user_key && row.idempotency_key === idempotency_key);
    }

    if (q.startsWith("select * from jobs") && q.includes("status in ('queued', 'running')")) {
      const [conversation_id, user_key] = values;
      return this.tables.jobs.filter(row => row.conversation_id === conversation_id && row.user_key === user_key && ["queued", "running"].includes(row.status));
    }

    if (q.startsWith("select coalesce(max(seq)")) {
      const [job_id] = values;
      const max = Math.max(0, ...this.tables.job_events.filter(row => row.job_id === job_id).map(row => Number(row.seq)));
      return [{ next_seq: max + 1 }];
    }

    if (q.startsWith("select * from job_events")) {
      const [job_id, user_key] = values;
      return this.tables.job_events.filter(row => row.job_id === job_id && row.user_key === user_key).sort((a, b) => Number(a.seq) - Number(b.seq));
    }

    if (q.startsWith("select * from pending_actions") && q.includes("action_id = ?1")) {
      const [action_id, user_key] = values;
      return this.tables.pending_actions.filter(row => row.action_id === action_id && row.user_key === user_key);
    }

    if (q.startsWith("select * from pending_actions")) {
      const [conversation_id, user_key] = values;
      return this.tables.pending_actions.filter(row => row.conversation_id === conversation_id && row.user_key === user_key && row.status === "waiting_confirmation");
    }

    throw new Error(`Unhandled D1 all SQL: ${q}`);
  }
}

function createEnv(): Env {
  const calls: unknown[] = [];
  return {
    AI: {
      run: async (_model: string, request: any) => {
        calls.push(request);
        const system = String(request.messages?.[0]?.content || "");
        if (system.includes("làm rõ") || system.includes("lÃ m rÃµ")) {
          return {
            response: JSON.stringify({
              rewritten_message: "Xin chào",
              needs_clarification: false,
              clarification_question: null,
              resolved_references: []
            })
          };
        }
        return { response: "Đây là câu trả lời thử nghiệm từ agent async." };
      }
    },
    VECTORIZE: {} as VectorizeIndex,
    CHUNKS: createKv(),
    DB: new MemoryD1() as unknown as D1Database,
    ZILCODE_API_TOKEN: "unused",
    ZILCODE_BASE: "https://demo.zilcode.com"
  } as unknown as Env;
}

function request(path: string, init: RequestInit = {}, userId = "1580"): Request {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer test-token");
  headers.set("X-Zilcode-Base", "https://demo.zilcode.com");
  headers.set("X-Zilcode-UserId", userId);
  headers.set("X-Zilcode-Username", "Demo Admin");
  headers.set("X-Zilcode-SiteCode", "demo");
  headers.set("X-Zilcode-RoleId", "1");
  headers.set("X-Zilcode-OrgId", "0");
  return new Request(`https://worker.test${path}`, { ...init, headers });
}

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

async function main(): Promise<void> {
  const env = createEnv();

  const created = await json(await handleCreateConversation(
    request("/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "Smoke conversation" })
    }),
    env
  ));
  ok(created.success, "create conversation should succeed");
  const conversationId = created.conversation?.conversation_id;
  ok(typeof conversationId === "string" && conversationId.startsWith("conv_"), "conversation id should be returned");

  const listed = await json(await handleListConversations(request("/conversations", { method: "GET" }), env));
  ok(listed.success, "list conversations should succeed");
  ok(listed.conversations?.length === 1, "list should include created conversation");

  const firstGet = await json(await handleGetConversation(request(`/conversations/${conversationId}`, { method: "GET" }), env, conversationId));
  ok(firstGet.conversation?.messages?.length === 0, "new conversation should have empty history");

  const messaged = await json(await handleConversationMessage(
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": "smoke-1" },
      body: JSON.stringify({ message: "Xin chào", debug: true })
    }),
    env,
    conversationId
  ));
  ok(messaged.success, "message endpoint should succeed");
  ok(messaged.status === "queued", "message endpoint should return queued status");
  ok(typeof messaged.job_id === "string" && messaged.job_id.startsWith("job_"), "job id should be returned");
  ok(!("answer" in messaged), "message endpoint should not return direct answer");

  await runConversationJob(env, messaged.job_id);

  const job = await json(await handleGetJob(request(`/jobs/${messaged.job_id}`, { method: "GET" }), env, messaged.job_id));
  ok(job.job?.status === "succeeded", "job should succeed after runner");
  ok(typeof job.message?.content === "string" && job.message.content.length > 0, "assistant message should be written by runner");

  const secondGet = await json(await handleGetConversation(request(`/conversations/${conversationId}`, { method: "GET" }), env, conversationId));
  ok(secondGet.conversation?.messages?.length === 2, "history should contain user and assistant messages");

  const failedQueued = await json(await handleConversationMessage(
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": "smoke-failed" },
      body: JSON.stringify({ message: "Force failed job path", debug: true })
    }),
    env,
    conversationId
  ));
  ok(failedQueued.success && failedQueued.status === "queued", "failed-path message should queue a job first");

  const db = env.DB as unknown as MemoryD1;
  const conversationRow = db.tables.conversations.find(row => row.conversation_id === conversationId);
  ok(conversationRow, "conversation row should exist in D1 mock");

  const failedJobRow = db.tables.jobs.find(row => row.job_id === failedQueued.job_id);
  ok(failedJobRow, "failed-path job row should exist");
  failedJobRow!.auth_context_json = null;
  await runConversationJob(env, failedQueued.job_id);

  const failedJob = await json(await handleGetJob(request(`/jobs/${failedQueued.job_id}`, { method: "GET" }), env, failedQueued.job_id));
  ok(failedJob.job?.status === "failed", "job runner should store failed status");
  ok(failedJob.message?.status === "failed", "assistant placeholder should become failed message");
  ok(typeof failedJob.job?.error === "string" && failedJob.job.error.length > 0, "failed job should store error");

  db.tables.pending_actions.push({
    action_id: "act_cancel_smoke",
    conversation_id: conversationId,
    user_key: conversationRow!.user_key,
    job_id: messaged.job_id,
    assistant_message_id: messaged.assistant_message_id,
    plan_id: "plan_cancel_smoke",
    status: "waiting_confirmation",
    payload_json: "{}",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null
  });
  const cancelled = await json(await handleCancelPendingAction(request("/pending-actions/act_cancel_smoke/cancel", { method: "POST" }), env, "act_cancel_smoke"));
  ok(cancelled.status === "cancelled", "cancel pending action should work");

  db.tables.pending_actions.push({
    action_id: "act_confirm_smoke",
    conversation_id: conversationId,
    user_key: conversationRow!.user_key,
    job_id: messaged.job_id,
    assistant_message_id: messaged.assistant_message_id,
    plan_id: "plan_confirm_smoke",
    status: "waiting_confirmation",
    payload_json: "{}",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null
  });
  const confirmed = await json(await handleConfirmPendingAction(request("/pending-actions/act_confirm_smoke/confirm", { method: "POST" }), env, "act_confirm_smoke"));
  ok(confirmed.status === "queued", "confirm pending action should queue apply job");
  ok(typeof confirmed.job_id === "string" && confirmed.job_id.startsWith("job_"), "confirm should return apply job id");

  const blockedOtherUser = await handleGetConversation(request(`/conversations/${conversationId}`, { method: "GET" }, "9999"), env, conversationId);
  ok(blockedOtherUser.status === 404, "other user should not read conversation");

  const deleted = await json(await handleDeleteConversation(request(`/conversations/${conversationId}`, { method: "DELETE" }), env, conversationId));
  ok(deleted.success, "delete conversation should succeed");

  console.log(JSON.stringify({
    ok: true,
    conversation_id: conversationId,
    job_id: messaged.job_id,
    checked: [
      "POST /conversations",
      "GET /conversations",
      "GET /conversations/{conversation_id}",
      "POST /conversations/{conversation_id}/messages returns 202-style queued job",
      "runConversationJob writes assistant message",
      "runConversationJob stores failed status and error",
      "GET /jobs/{job_id}",
      "POST /pending-actions/{action_id}/cancel",
      "POST /pending-actions/{action_id}/confirm creates apply job",
      "ownership isolation",
      "DELETE /conversations/{conversation_id}"
    ]
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
