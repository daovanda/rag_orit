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

async function cleanupApp(env: SmokeEnv, session: SessionLike, appid: unknown): Promise<Record<string, unknown> | null> {
  if (appid === undefined || appid === null || appid === "") return null;
  return prepareAndApply(env, session, "smoke_cleanup_delete_entities", `Cleanup smoke app ${String(appid)}`, [
    {
      id: "delete_app_1",
      op: "delete_app",
      id_value: appid,
      cascade: true
    }
  ]);
}

async function cleanupTable(env: SmokeEnv, session: SessionLike, tableid: unknown): Promise<Record<string, unknown> | null> {
  if (tableid === undefined || tableid === null || tableid === "") return null;
  return prepareAndApply(env, session, "smoke_cleanup_delete_table", `Cleanup smoke table ${String(tableid)}`, [
    {
      id: "delete_table_1",
      op: "delete_table",
      id_value: tableid,
      cascade: true
    }
  ]);
}

async function nodeMissing(
  env: SmokeEnv,
  session: SessionLike,
  nodeId: string
): Promise<boolean> {
  const detail = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
    node_id: nodeId,
    include_neighbors: true,
    include_fields: true,
    max_records_per_table: "5000"
  });
  const node = detail.node;
  if (!node || typeof node !== "object" || Array.isArray(node)) return true;
  return String((node as Record<string, unknown>).id ?? "") !== nodeId;
}

async function nodeExists(
  env: SmokeEnv,
  session: SessionLike,
  nodeId: string
): Promise<boolean> {
  return !(await nodeMissing(env, session, nodeId));
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const suffix = Date.now();
  const appName = `Codex Delete Smoke ${suffix}`;
  const tableName = `codex_delete_order_${suffix}`;
  let appid: unknown;
  let tableid: unknown;

  try {
    const createApply = await prepareAndApply(env, session, "delete_entity_create_fixture", "Create fixture for delete entity smoke", [
      { id: "create_app_1", op: "create_app", record: { appname: appName, description: "Delete entity smoke fixture" } },
      { id: "create_table_1", op: "create_table", record: { tablename: tableName, alias: "Delete Smoke Orders", tabletype: "table" } },
      { id: "create_column_1", op: "create_column", record: { tableid: "$create_table_1.tableid", columnname: "order_no", datatype: "text", length: 64 } },
      { id: "create_column_2", op: "create_column", record: { tableid: "$create_table_1.tableid", columnname: "status", datatype: "text", length: 64 } },
      { id: "create_window_1", op: "create_window", record: { appid: "$create_app_1.appid", windowname: "Delete Smoke Orders" } },
      { id: "create_tab_1", op: "create_tab", record: { windowid: "$create_window_1.windowid", tableid: "$create_table_1.tableid", tabname: "Orders" } },
      { id: "create_field_1", op: "create_field", record: { tabid: "$create_tab_1.tabid", columnid: "$create_column_1.columnid", fieldname: "Order No" } },
      { id: "create_field_2", op: "create_field", record: { tabid: "$create_tab_1.tabid", columnid: "$create_column_2.columnid", fieldname: "Status" } },
      { id: "create_menu_1", op: "create_menu", record: { appid: "$create_app_1.appid", menuname: "Delete Smoke Orders", linkwindowid: "$create_window_1.windowid" } },
      { id: "create_window_2", op: "create_window", record: { appid: "$create_app_1.appid", windowname: "Delete Smoke Window Cascade" } },
      { id: "create_tab_2", op: "create_tab", record: { windowid: "$create_window_2.windowid", tableid: "$create_table_1.tableid", tabname: "Window Cascade Orders" } },
      { id: "create_field_3", op: "create_field", record: { tabid: "$create_tab_2.tabid", columnid: "$create_column_1.columnid", fieldname: "Window Cascade Order No" } },
      { id: "create_menu_2", op: "create_menu", record: { appid: "$create_app_1.appid", menuname: "Delete Smoke Window Cascade", linkwindowid: "$create_window_2.windowid" } }
    ]);

    const appRef = resultReference(createApply, "create_app_1");
    const tableRef = resultReference(createApply, "create_table_1");
    const column1Ref = resultReference(createApply, "create_column_1");
    const column2Ref = resultReference(createApply, "create_column_2");
    const windowRef = resultReference(createApply, "create_window_1");
    const tabRef = resultReference(createApply, "create_tab_1");
    const field1Ref = resultReference(createApply, "create_field_1");
    const field2Ref = resultReference(createApply, "create_field_2");
    const menuRef = resultReference(createApply, "create_menu_1");
    const window2Ref = resultReference(createApply, "create_window_2");
    const tab2Ref = resultReference(createApply, "create_tab_2");
    const field3Ref = resultReference(createApply, "create_field_3");
    const menu2Ref = resultReference(createApply, "create_menu_2");
    appid = appRef.appid;
    tableid = tableRef.tableid;

    const tableId = String(tableRef.tableid);
    const windowId = String(windowRef.windowid);
    const tabId = String(tabRef.tabid);
    const window2Id = String(window2Ref.windowid);
    const tab2Id = String(tab2Ref.tabid);
    const column1Id = String(column1Ref.columnid);
    const column2Id = String(column2Ref.columnid);
    const field1Id = String(field1Ref.fieldid);
    const field2Id = String(field2Ref.fieldid);
    const field3Id = String(field3Ref.fieldid);
    const menuId = String(menuRef.menuid);
    const menu2Id = String(menu2Ref.menuid);

    ok(await nodeExists(env, session, `field:${windowId}:${tabId}:${field1Id}`), "Fixture field 1 chưa có trong graph.");
    ok(await nodeExists(env, session, `field:${windowId}:${tabId}:${field2Id}`), "Fixture field 2 chưa có trong graph.");
    ok(await nodeExists(env, session, `menu:${String(appid)}:${menuId}`), "Fixture menu chưa có trong graph.");
    ok(await nodeExists(env, session, `window:${window2Id}`), "Fixture window 2 chưa có trong graph.");
    ok(await nodeExists(env, session, `field:${window2Id}:${tab2Id}:${field3Id}`), "Fixture field 3 chưa có trong graph.");
    ok(await nodeExists(env, session, `menu:${String(appid)}:${menu2Id}`), "Fixture menu 2 chưa có trong graph.");

    const deleteFieldApply = await prepareAndApply(env, session, "delete_field_single", "Delete one field", [
      { id: "delete_field_1", op: "delete_field", id_value: field1Id }
    ]);
    ok(await nodeMissing(env, session, `field:${windowId}:${tabId}:${field1Id}`), "delete_field chưa xóa field 1 khỏi graph.");
    ok(await nodeExists(env, session, `field:${windowId}:${tabId}:${field2Id}`), "delete_field làm mất nhầm field 2.");

    const deleteMenuApply = await prepareAndApply(env, session, "delete_menu_single", "Delete one menu", [
      { id: "delete_menu_1", op: "delete_menu", id_value: menuId }
    ]);
    ok(await nodeMissing(env, session, `menu:${String(appid)}:${menuId}`), "delete_menu chưa xóa menu khỏi graph.");

    const deleteColumnApply = await prepareAndApply(env, session, "delete_column_cascade", "Delete one column cascade with field", [
      { id: "delete_column_1", op: "delete_column", id_value: column2Id, cascade: true }
    ]);
    ok(await nodeMissing(env, session, `field:${windowId}:${tabId}:${field2Id}`), "delete_column cascade chưa xóa field dùng column khỏi graph.");

    const deleteTabApply = await prepareAndApply(env, session, "delete_tab_cascade", "Delete tab cascade with remaining field", [
      { id: "delete_tab_1", op: "delete_tab", id_value: tabId, cascade: true }
    ]);
    ok(await nodeMissing(env, session, `tab:${windowId}:${tabId}`), "delete_tab cascade chưa xóa tab khỏi graph.");

    const deleteWindowApply = await prepareAndApply(env, session, "delete_window_cascade", "Delete window cascade with tab, field and menu", [
      { id: "delete_window_1", op: "delete_window", id_value: window2Id, cascade: true }
    ]);
    ok(await nodeMissing(env, session, `window:${window2Id}`), "delete_window cascade chưa xóa window khỏi graph.");
    ok(await nodeMissing(env, session, `tab:${window2Id}:${tab2Id}`), "delete_window cascade chưa xóa tab khỏi graph.");
    ok(await nodeMissing(env, session, `field:${window2Id}:${tab2Id}:${field3Id}`), "delete_window cascade chưa xóa field khỏi graph.");
    ok(await nodeMissing(env, session, `menu:${String(appid)}:${menu2Id}`), "delete_window cascade chưa xóa menu khỏi graph.");

    const deleteTableApply = await prepareAndApply(env, session, "delete_table_cascade", "Delete table cascade with remaining column", [
      { id: "delete_table_1", op: "delete_table", id_value: tableId, cascade: true }
    ]);
    const tableSearchAfterDelete = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: tableName,
      types: "table",
      limit: 20,
      max_records_per_table: "5000"
    });
    const tableDeleteMatches = exactTableMatches(tableSearchAfterDelete, tableName);
    ok(tableDeleteMatches.length === 0, `delete_table cascade chưa xóa table khỏi graph: ${JSON.stringify(tableDeleteMatches, null, 2)}`);
    tableid = undefined;

    const cleanupApply = await cleanupApp(env, session, appid);
    const searchAfterCleanup = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: appName,
      types: "app",
      limit: 5,
      max_records_per_table: "5000"
    });
    const cleanupMatches = exactAppMatches(searchAfterCleanup, appName);
    ok(cleanupMatches.length === 0, `Cleanup verify failed, app vẫn còn trong graph: ${JSON.stringify(cleanupMatches, null, 2)}`);
    appid = undefined;

    console.log(JSON.stringify({
      ok: true,
      fixture: {
        appid: appRef.appid,
        tableid: tableRef.tableid,
        column_deleted_by_cascade: column2Id,
        column_deleted_by_table_cascade: column1Id,
        windowid: windowId,
        window_deleted_by_cascade: window2Id,
        tabid: tabId,
        field_deleted_directly: field1Id,
        field_deleted_by_column_cascade: field2Id,
        field_deleted_by_window_cascade: field3Id,
        menu_deleted_directly: menuId
      },
      delete_field_applied_count: deleteFieldApply.applied_count,
      delete_menu_applied_count: deleteMenuApply.applied_count,
      delete_column_cascade_applied_count: deleteColumnApply.applied_count,
      delete_tab_cascade_applied_count: deleteTabApply.applied_count,
      delete_window_cascade_applied_count: deleteWindowApply.applied_count,
      delete_table_cascade_applied_count: deleteTableApply.applied_count,
      cleanup_applied_count: cleanupApply?.applied_count,
      graph_verified_after_each_delete: true
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
