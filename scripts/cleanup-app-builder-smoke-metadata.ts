import { runAppBuilderGraphTool } from "../src/app-builder-graph";
import { runAppBuilderWriteTool } from "../src/app-builder-write";
import { assertZilcodeSuccess, callZilcodeJson } from "../src/zilcode";

type CleanupEnv = {
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
const tablePrefix = process.env.CLEANUP_TABLE_PREFIX || "codex_";
const appPrefix = process.env.CLEANUP_APP_PREFIX || "";

function makeEnv(): CleanupEnv {
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

async function login(env: CleanupEnv): Promise<SessionLike> {
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

function smokeTableMatches(searchResult: Record<string, unknown>): Record<string, unknown>[] {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as Record<string, unknown>[] : [];
  return matches.filter(match => {
    const summary = match.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
    const tableName = String((summary as Record<string, unknown>).tablename ?? "");
    return tableName.startsWith(tablePrefix);
  });
}

async function findSmokeTables(env: CleanupEnv, session: SessionLike): Promise<Record<string, unknown>[]> {
  const search = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
    query: tablePrefix,
    types: "table",
    limit: 500,
    max_records_per_table: "5000"
  });
  const byTableId = new Map<string, Record<string, unknown>>();
  for (const match of smokeTableMatches(search)) {
    const summary = match.summary as Record<string, unknown>;
    const tableid = String(summary.tableid ?? "");
    if (!tableid) continue;
    byTableId.set(tableid, match);
  }
  return [...byTableId.values()];
}

function smokeAppMatches(searchResult: Record<string, unknown>): Record<string, unknown>[] {
  if (!appPrefix) return [];
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as Record<string, unknown>[] : [];
  return matches.filter(match => {
    const summary = match.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
    const appName = String((summary as Record<string, unknown>).appname ?? "");
    return appName.startsWith(appPrefix);
  });
}

async function findSmokeApps(env: CleanupEnv, session: SessionLike): Promise<Record<string, unknown>[]> {
  if (!appPrefix) return [];
  const search = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
    query: appPrefix,
    types: "app",
    limit: 500,
    max_records_per_table: "5000"
  });
  const byAppId = new Map<string, Record<string, unknown>>();
  for (const match of smokeAppMatches(search)) {
    const summary = match.summary as Record<string, unknown>;
    const appid = String(summary.appid ?? "");
    if (!appid) continue;
    byAppId.set(appid, match);
  }
  return [...byAppId.values()];
}

async function deleteApp(env: CleanupEnv, session: SessionLike, appid: unknown): Promise<Record<string, unknown>> {
  const prepare = await runAppBuilderWriteTool(env as never, session as never, "app_builder_prepare_change", {
    intent: "cleanup_smoke_app_metadata",
    summary: `Cleanup smoke app ${String(appid)}`,
    operations: [
      {
        id: `delete_app_${String(appid)}`,
        op: "delete_app",
        id_value: appid,
        cascade: true
      }
    ],
    max_records_per_table: "5000"
  });
  if (!prepare.valid) throw new Error(`Prepare failed for app ${String(appid)}: ${JSON.stringify(prepare, null, 2)}`);

  const apply = await runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
    plan_id: prepare.plan_id
  });
  if (!apply.ok) throw new Error(`Apply failed for app ${String(appid)}: ${JSON.stringify(apply, null, 2)}`);
  return apply;
}

async function deleteTable(env: CleanupEnv, session: SessionLike, tableid: unknown): Promise<Record<string, unknown>> {
  const prepare = await runAppBuilderWriteTool(env as never, session as never, "app_builder_prepare_change", {
    intent: "cleanup_smoke_table_metadata",
    summary: `Cleanup smoke table ${String(tableid)}`,
    operations: [
      {
        id: `delete_table_${String(tableid)}`,
        op: "delete_table",
        id_value: tableid,
        cascade: true
      }
    ],
    max_records_per_table: "5000"
  });
  if (!prepare.valid) throw new Error(`Prepare failed for table ${String(tableid)}: ${JSON.stringify(prepare, null, 2)}`);

  const apply = await runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
    plan_id: prepare.plan_id
  });
  if (!apply.ok) throw new Error(`Apply failed for table ${String(tableid)}: ${JSON.stringify(apply, null, 2)}`);
  return apply;
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const apps = await findSmokeApps(env, session);
  const deletedApps: Record<string, unknown>[] = [];
  for (const app of apps) {
    const summary = app.summary as Record<string, unknown>;
    const appid = summary.appid;
    const apply = await deleteApp(env, session, appid);
    deletedApps.push({
      appid,
      appname: summary.appname,
      applied_count: apply.applied_count
    });
  }

  const tables = await findSmokeTables(env, session);

  const deleted: Record<string, unknown>[] = [];
  for (const table of tables) {
    const summary = table.summary as Record<string, unknown>;
    const tableid = summary.tableid;
    const apply = await deleteTable(env, session, tableid);
    deleted.push({
      tableid,
      tablename: summary.tablename,
      applied_count: apply.applied_count
    });
  }

  const remainingApps = await findSmokeApps(env, session);
  const remaining = await findSmokeTables(env, session);
  console.log(JSON.stringify({
    ok: remaining.length === 0 && remainingApps.length === 0,
    table_prefix: tablePrefix,
    app_prefix: appPrefix || undefined,
    deleted_apps_count: deletedApps.length,
    deleted_apps: deletedApps,
    remaining_apps_count: remainingApps.length,
    remaining_apps: remainingApps.map(match => match.summary),
    deleted_count: deleted.length,
    deleted,
    remaining_count: remaining.length,
    remaining: remaining.map(match => match.summary)
  }, null, 2));

  if (remaining.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
