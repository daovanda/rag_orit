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

type ZilcodeSessionLike = {
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

async function login(env: SmokeEnv): Promise<ZilcodeSessionLike> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(env as never, "rest/token/", {
    method: "POST",
    baseUrl,
    data: [username, sitecode, password]
  });
  const loginResult = assertZilcodeSuccess(envelope) as Record<string, unknown>;
  const token = String(loginResult.token || "");
  if (!token) throw new Error("Login không trả token.");

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

async function prepareAndApply(
  env: SmokeEnv,
  session: ZilcodeSessionLike,
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

  const apply = await runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
    plan_id: prepare.plan_id
  });
  ok(apply.ok, `Apply failed: ${JSON.stringify(apply, null, 2)}`);
  return apply;
}

function resultReference(apply: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const results = Array.isArray(apply.results) ? apply.results as Record<string, unknown>[] : [];
  const match = results.find(result => result.operation_id === operationId);
  const reference = match?.reference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw new Error(`Không tìm thấy reference cho operation ${operationId}: ${JSON.stringify(match)}`);
  }
  return reference as Record<string, unknown>;
}

function exactTableMatches(searchResult: Record<string, unknown>, tableName: string): Record<string, unknown>[] {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as Record<string, unknown>[] : [];
  return matches.filter(match => {
    const summary = match.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
    return String((summary as Record<string, unknown>).tablename ?? "") === tableName;
  });
}

function exactAppMatches(searchResult: Record<string, unknown>, appName: string): Record<string, unknown>[] {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as Record<string, unknown>[] : [];
  return matches.filter(match => {
    const summary = match.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
    return String((summary as Record<string, unknown>).appname ?? "") === appName;
  });
}

async function cleanupApp(env: SmokeEnv, session: ZilcodeSessionLike, appid: unknown): Promise<Record<string, unknown> | null> {
  if (appid === undefined || appid === null || appid === "") return null;
  return prepareAndApply(env, session, "smoke_cleanup_app", `Cleanup smoke app ${String(appid)}`, [
    {
      id: "delete_app_1",
      op: "delete_app",
      id_value: appid,
      cascade: true
    }
  ]);
}

async function cleanupTable(env: SmokeEnv, session: ZilcodeSessionLike, tableid: unknown): Promise<Record<string, unknown> | null> {
  if (tableid === undefined || tableid === null || tableid === "") return null;
  return prepareAndApply(env, session, "smoke_cleanup_table", `Cleanup smoke table ${String(tableid)}`, [
    {
      id: "delete_table_1",
      op: "delete_table",
      id_value: tableid,
      cascade: true
    }
  ]);
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const suffix = Date.now();
  const appName = `Codex L3 Smoke ${suffix}`;
  const tableName = `codex_l3_order_${suffix}`;
  let appid: unknown;
  let tableid: unknown;

  try {
    const createOperations = [
      {
        id: "create_app_1",
        op: "create_app",
        record: {
          appname: appName,
          description: "Level 3 smoke test app"
        }
      },
      {
        id: "create_table_1",
        op: "create_table",
        record: {
          appid: "$create_app_1.appid",
          tablename: tableName,
          alias: "Smoke Orders",
          tabletype: "table"
        }
      },
      {
        id: "create_column_1",
        op: "create_column",
        record: {
          tableid: "$create_table_1.tableid",
          columnname: "order_no",
          alias: "Order No",
          datatype: "text",
          length: 64
        }
      },
      {
        id: "create_window_1",
        op: "create_window",
        record: {
          appid: "$create_app_1.appid",
          windowname: "Smoke Orders"
        }
      },
      {
        id: "create_tab_1",
        op: "create_tab",
        record: {
          windowid: "$create_window_1.windowid",
          tableid: "$create_table_1.tableid",
          tabname: "Orders"
        }
      },
      {
        id: "create_field_1",
        op: "create_field",
        record: {
          tabid: "$create_tab_1.tabid",
          columnid: "$create_column_1.columnid",
          fieldname: "Order No"
        }
      },
      {
        id: "create_menu_1",
        op: "create_menu",
        record: {
          appid: "$create_app_1.appid",
          menuname: "Smoke Orders",
          linkwindowid: "$create_window_1.windowid"
        }
      }
    ];

    const createPrepare = await runAppBuilderWriteTool(env as never, session as never, "app_builder_prepare_change", {
      intent: "level3_create_chain",
      summary: "Create full App Builder metadata chain",
      operations: createOperations,
      max_records_per_table: "5000"
    });
    ok(createPrepare.valid, `Prepare failed: ${JSON.stringify(createPrepare, null, 2)}`);
    const createApply = await runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
      plan_id: createPrepare.plan_id
    });
    const partialAppReference = (() => {
      try {
        return resultReference(createApply, "create_app_1");
      } catch {
        return null;
      }
    })();
    appid = partialAppReference?.appid;
    ok(createApply.ok, `Apply failed: ${JSON.stringify(createApply, null, 2)}`);

    const appRef = resultReference(createApply, "create_app_1");
    const tableRef = resultReference(createApply, "create_table_1");
    const columnRef = resultReference(createApply, "create_column_1");
    const windowRef = resultReference(createApply, "create_window_1");
    const tabRef = resultReference(createApply, "create_tab_1");
    const fieldRef = resultReference(createApply, "create_field_1");
    const menuRef = resultReference(createApply, "create_menu_1");
    appid = appRef.appid;
    tableid = tableRef.tableid;

    const detailAfterCreate = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
      node_id: `app:${String(appid)}`,
      include_neighbors: true,
      include_fields: true,
      max_records_per_table: "5000"
    });
    ok(!detailAfterCreate.error, `Graph detail after create failed: ${JSON.stringify(detailAfterCreate, null, 2)}`);

    const updateApply = await prepareAndApply(env, session, "level3_update_chain", "Update every created metadata type", [
      {
        id: "update_app_1",
        op: "update_app",
        id_value: appRef.appid,
        record: { description: "Level 3 smoke test app updated" }
      },
      {
        id: "update_table_1",
        op: "update_table",
        id_value: tableRef.tableid,
        record: { alias: "Smoke Orders Updated" }
      },
      {
        id: "update_column_1",
        op: "update_column",
        id_value: columnRef.columnid,
        record: { alias: "Order Number" }
      },
      {
        id: "update_window_1",
        op: "update_window",
        id_value: windowRef.windowid,
        record: { windowname: "Smoke Orders Updated" }
      },
      {
        id: "update_tab_1",
        op: "update_tab",
        id_value: tabRef.tabid,
        record: { tabname: "Orders Updated" }
      },
      {
        id: "update_field_1",
        op: "update_field",
        id_value: fieldRef.fieldid,
        record: { fieldname: "Order Number" }
      },
      {
        id: "update_menu_1",
        op: "update_menu",
        id_value: menuRef.menuid,
        record: { menuname: "Smoke Orders Updated" }
      }
    ]);

    const detailAfterUpdate = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
      node_id: `app:${String(appid)}`,
      include_neighbors: true,
      include_fields: true,
      max_records_per_table: "5000"
    });
    ok(!detailAfterUpdate.error, `Graph detail after update failed: ${JSON.stringify(detailAfterUpdate, null, 2)}`);

    const cleanupApply = await cleanupApp(env, session, appid);
    const cleanupTableApply = await cleanupTable(env, session, tableid);
    const searchAfterCleanup = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: appName,
      types: "app",
      limit: 5,
      max_records_per_table: "5000"
    });
    const cleanupMatches = exactAppMatches(searchAfterCleanup, appName);
    ok(cleanupMatches.length === 0, `Cleanup verify failed, app still found: ${JSON.stringify(cleanupMatches, null, 2)}`);
    const tableSearchAfterCleanup = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: tableName,
      types: "table",
      limit: 20,
      max_records_per_table: "5000"
    });
    const tableCleanupMatches = exactTableMatches(tableSearchAfterCleanup, tableName);
    ok(tableCleanupMatches.length === 0, `Cleanup verify failed, table still found: ${JSON.stringify(tableCleanupMatches, null, 2)}`);
    appid = undefined;
    tableid = undefined;

    console.log(JSON.stringify({
      ok: true,
      created: {
        appid: appRef.appid,
        tableid: tableRef.tableid,
        columnid: columnRef.columnid,
        windowid: windowRef.windowid,
        tabid: tabRef.tabid,
        fieldid: fieldRef.fieldid,
        menuid: menuRef.menuid
      },
      create_applied_count: createApply.applied_count,
      update_applied_count: updateApply.applied_count,
      cleanup_applied_count: cleanupApply?.applied_count,
      cleanup_table_applied_count: cleanupTableApply?.applied_count,
      graph_verified_after_create: true,
      graph_verified_after_update: true,
      graph_verified_after_cleanup: true
    }, null, 2));
  } finally {
    if (appid !== undefined && appid !== null && appid !== "") {
      try {
        const cleanup = await cleanupApp(env, session, appid);
        console.error(`Cleanup trong finally đã chạy cho appid=${String(appid)}: ${JSON.stringify({
          ok: cleanup?.ok,
          status: cleanup?.status,
          applied_count: cleanup?.applied_count
        })}`);
      } catch (error) {
        console.error(`Cleanup trong finally thất bại cho appid=${String(appid)}:`, error);
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
