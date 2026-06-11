import {
  handleConversationMessage,
  handleCreateConversation,
  handleDeleteConversation,
  handleGetConversation,
  handleListConversations
} from "../src/conversations";
import type { Env } from "../src/config";

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createKv(): KVNamespace {
  const kv = new Map<string, string>();
  return {
    get: async (key: string) => kv.get(key) ?? null,
    put: async (key: string, value: string) => { kv.set(key, value); },
    delete: async (key: string) => { kv.delete(key); },
    list: async (options?: { prefix?: string }) => ({
      keys: [...kv.keys()]
        .filter(name => !options?.prefix || name.startsWith(options.prefix))
        .map(name => ({ name })),
      list_complete: true,
      cursor: ""
    })
  } as unknown as KVNamespace;
}

function createEnv(): Env {
  return {
    AI: {
      run: async () => ({ response: "Đây là câu trả lời thử nghiệm từ agent." })
    },
    VECTORIZE: {} as VectorizeIndex,
    CHUNKS: createKv(),
    ZILCODE_API_TOKEN: "unused",
    ZILCODE_BASE: "https://demo.zilcode.com"
  } as unknown as Env;
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer test-token");
  headers.set("X-Zilcode-Base", "https://demo.zilcode.com");
  headers.set("X-Zilcode-UserId", "1580");
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
  ok(firstGet.success, "get conversation should succeed");
  ok(firstGet.conversation?.messages?.length === 0, "new conversation should have empty server-side history");

  const messaged = await json(await handleConversationMessage(
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Xin chào", debug: true })
    }),
    env,
    conversationId
  ));

  ok(messaged.success, "message endpoint should succeed");
  ok(messaged.answer === "Đây là câu trả lời thử nghiệm từ agent.", "message endpoint should return agent answer");
  ok(messaged.status === "ok", "plain message should return ok status");

  const secondGet = await json(await handleGetConversation(request(`/conversations/${conversationId}`, { method: "GET" }), env, conversationId));
  ok(secondGet.conversation?.messages?.length === 2, "server-side history should contain user and assistant messages");
  ok(secondGet.conversation.messages[0].role === "user", "first stored message should be user");
  ok(secondGet.conversation.messages[1].role === "assistant", "second stored message should be assistant");

  const deleted = await json(await handleDeleteConversation(request(`/conversations/${conversationId}`, { method: "DELETE" }), env, conversationId));
  ok(deleted.success, "delete conversation should succeed");

  const listedAfterDelete = await json(await handleListConversations(request("/conversations", { method: "GET" }), env));
  ok(listedAfterDelete.conversations?.length === 0, "deleted conversation should not appear in list");

  console.log(JSON.stringify({
    ok: true,
    conversation_id: conversationId,
    checked: [
      "POST /conversations",
      "GET /conversations",
      "GET /conversations/{conversation_id}",
      "POST /conversations/{conversation_id}/messages",
      "DELETE /conversations/{conversation_id}",
      "server_side_history"
    ]
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
