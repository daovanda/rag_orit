import { runAppBuilderGraphTool } from "../src/app-builder-graph";
import { runAppBuilderWriteTool } from "../src/app-builder-write";
import { assertZilcodeSuccess, callZilcodeJson } from "../src/zilcode";

type SmokeEnv = {
  ZILCODE_BASE: string;
  CHUNKS: {
    put: (key: string, value: string) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    delete: (key: string) => Promise<void>;
  };
};

type SessionLike = {
  base_url: string;
  token: string;
  roleid: number;
  orgid: number;
  userid?: unknown;
  username?: string;
  sitecode?: string;
  user?: Record<string, unknown>;
};

const baseUrl = process.env.ZILCODE_BASE || "https://demo.zilcode.com";
const username = process.env.ZILCODE_USERNAME || "admin";
const sitecode = process.env.ZILCODE_SITECODE || "demo";
const password = process.env.ZILCODE_PASSWORD || "12345678";
const roleid = Number(process.env.ZILCODE_ROLEID || 1);
const orgid = Number(process.env.ZILCODE_ORGID || 0);

function makeEnv(): SmokeEnv {
  const kv = new Map<string, string>();
  return {
    ZILCODE_BASE: baseUrl,
    CHUNKS: {
      put: async (key, value) => { kv.set(key, value); },
      get: async key => kv.get(key) ?? null,
      delete: async key => { kv.delete(key); }
    }
  };
}

async function login(env: SmokeEnv): Promise<SessionLike> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(env as never, "rest/token/", {
    method: "POST",
    baseUrl,
    data: [username, sitecode, password]
  });
  const loginResult = assertZilcodeSuccess(envelope) as Record<string, unknown>;
  const token = String(loginResult.token || "");
  if (!token) throw new Error("Login did not return token.");

  await callZilcodeJson(env as never, "rest/token/roleorg", {
    method: "PUT",
    baseUrl,
    token,
    data: [roleid, orgid]
  });

  return {
    base_url: baseUrl,
    token,
    roleid,
    orgid,
    userid: loginResult.userid,
    username,
    sitecode,
    user: loginResult
  };
}

function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function resultReference(apply: Record<string, unknown>, operationId: string): Record<string, unknown> | null {
  const results = Array.isArray(apply.results) ? apply.results as Record<string, unknown>[] : [];
  const match = results.find(result => result.operation_id === operationId);
  const reference = match?.reference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  return reference as Record<string, unknown>;
}

async function prepareAndApply(
  env: SmokeEnv,
  session: SessionLike,
  intent: string,
  summary: string,
  operations: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const prepare = await runAppBuilderWriteTool(env as never, session as never, "app_builder_prepare_change", {
    intent,
    summary,
    operations,
    max_records_per_table: "5000"
  });
  ok(prepare.valid, `Prepare failed: ${JSON.stringify(prepare, null, 2)}`);

  return runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
    plan_id: prepare.plan_id
  });
}

async function cleanupApp(env: SmokeEnv, session: SessionLike, appid: unknown): Promise<Record<string, unknown> | null> {
  if (appid === undefined || appid === null || appid === "") return null;
  return prepareAndApply(env, session, "partial_failure_cleanup_app", `Cleanup partial failure app ${String(appid)}`, [
    { id: "delete_app_1", op: "delete_app", id_value: appid, cascade: true }
  ]);
}

async function cleanupTable(env: SmokeEnv, session: SessionLike, tableid: unknown): Promise<Record<string, unknown> | null> {
  if (tableid === undefined || tableid === null || tableid === "") return null;
  return prepareAndApply(env, session, "partial_failure_cleanup_table", `Cleanup partial failure table ${String(tableid)}`, [
    { id: "delete_table_1", op: "delete_table", id_value: tableid, cascade: true }
  ]);
}

function exactTableMatches(searchResult: Record<string, unknown>, tableName: string): Record<string, unknown>[] {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as Record<string, unknown>[] : [];
  return matches.filter(match => {
    const summary = match.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
    return String((summary as Record<string, unknown>).tablename ?? "") === tableName;
  });
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const suffix = Date.now();
  const appName = `Codex Partial Failure ${suffix}`;
  const tableName = `codex_partial_order_${suffix}`;
  let appid: unknown;
  let tableid: unknown;

  try {
    const apply = await prepareAndApply(env, session, "partial_failure_probe", "Force a mid-plan failure after successful writes", [
      { id: "create_app_1", op: "create_app", record: { appname: appName, description: "Partial failure smoke fixture" } },
      { id: "create_table_1", op: "create_table", record: { tablename: tableName, alias: "Partial Failure Orders", tabletype: "table" } },
      {
        id: "create_window_bad_ref",
        op: "create_window",
        record: {
          appid: "$create_table_1.no_such_field",
          windowname: "This operation must fail"
        }
      },
      {
        id: "create_menu_should_skip",
        op: "create_menu",
        record: {
          appid: "$create_app_1.appid",
          menuname: "This operation must be skipped"
        }
      }
    ]);

    ok(apply.ok === false, `Apply should fail partially: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.status === "partial_success", `Unexpected status: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.applied_count === 2, `Expected 2 applied operations: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.failed_count === 1, `Expected 1 failed operation: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.skipped_count === 1, `Expected 1 skipped operation: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.pending_plan_deleted === true, `Failed plan should be deleted: ${JSON.stringify(apply, null, 2)}`);
    ok(apply.can_reapply_same_plan === false, `Failed plan should not be reusable: ${JSON.stringify(apply, null, 2)}`);

    const failedOperation = apply.failed_operation as Record<string, unknown> | undefined;
    ok(failedOperation?.operation_id === "create_window_bad_ref", `Wrong failed operation: ${JSON.stringify(apply, null, 2)}`);
    ok(String(failedOperation.error ?? "").includes("no_such_field"), `Failure should mention missing reference field: ${JSON.stringify(apply, null, 2)}`);

    const skippedOperations = Array.isArray(apply.skipped_operations) ? apply.skipped_operations as Record<string, unknown>[] : [];
    ok(skippedOperations.some(operation => operation.operation_id === "create_menu_should_skip"), `Missing skipped operation: ${JSON.stringify(apply, null, 2)}`);

    const appRef = resultReference(apply, "create_app_1");
    const tableRef = resultReference(apply, "create_table_1");
    ok(appRef?.appid, `Missing app reference from partial success: ${JSON.stringify(apply, null, 2)}`);
    ok(tableRef?.tableid, `Missing table reference from partial success: ${JSON.stringify(apply, null, 2)}`);
    appid = appRef.appid;
    tableid = tableRef.tableid;

    const cleanupAppApply = await cleanupApp(env, session, appid);
    const cleanupTableApply = await cleanupTable(env, session, tableid);
    appid = undefined;
    tableid = undefined;

    const tableSearchAfterCleanup = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: tableName,
      types: "table",
      limit: 20,
      max_records_per_table: "5000"
    });
    const tableCleanupMatches = exactTableMatches(tableSearchAfterCleanup, tableName);
    ok(tableCleanupMatches.length === 0, `Cleanup verify failed, table still found: ${JSON.stringify(tableCleanupMatches, null, 2)}`);

    console.log(JSON.stringify({
      ok: true,
      partial_failure_verified: true,
      applied_count: apply.applied_count,
      failed_count: apply.failed_count,
      skipped_count: apply.skipped_count,
      failed_operation: failedOperation.operation_id,
      pending_plan_deleted: apply.pending_plan_deleted,
      cleanup_app_applied_count: cleanupAppApply?.applied_count,
      cleanup_table_applied_count: cleanupTableApply?.applied_count
    }, null, 2));
  } finally {
    if (appid !== undefined && appid !== null && appid !== "") {
      try {
        const cleanup = await cleanupApp(env, session, appid);
        console.error(`Cleanup app in finally ran for appid=${String(appid)}: ${JSON.stringify({
          ok: cleanup?.ok,
          status: cleanup?.status,
          applied_count: cleanup?.applied_count
        })}`);
      } catch (error) {
        console.error(`Cleanup app in finally failed for appid=${String(appid)}:`, error);
      }
    }
    if (tableid !== undefined && tableid !== null && tableid !== "") {
      try {
        const cleanup = await cleanupTable(env, session, tableid);
        console.error(`Cleanup table in finally ran for tableid=${String(tableid)}: ${JSON.stringify({
          ok: cleanup?.ok,
          status: cleanup?.status,
          applied_count: cleanup?.applied_count
        })}`);
      } catch (error) {
        console.error(`Cleanup table in finally failed for tableid=${String(tableid)}:`, error);
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
