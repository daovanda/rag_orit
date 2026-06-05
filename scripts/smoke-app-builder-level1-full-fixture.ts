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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function countOf(counts: Record<string, unknown>, key: string): number {
  const value = counts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
    throw new Error(`Missing reference for operation ${operationId}: ${JSON.stringify(match)}`);
  }
  return reference as Record<string, unknown>;
}

async function cleanupApp(env: SmokeEnv, session: SessionLike, appid: unknown): Promise<Record<string, unknown> | null> {
  if (appid === undefined || appid === null || appid === "") return null;
  return prepareAndApply(env, session, "level1_full_cleanup_app", `Cleanup Level 1 fixture app ${String(appid)}`, [
    { id: "delete_app_1", op: "delete_app", id_value: appid, cascade: true }
  ]);
}

async function cleanupTable(env: SmokeEnv, session: SessionLike, tableid: unknown): Promise<Record<string, unknown> | null> {
  if (tableid === undefined || tableid === null || tableid === "") return null;
  return prepareAndApply(env, session, "level1_full_cleanup_table", `Cleanup Level 1 fixture table ${String(tableid)}`, [
    { id: `delete_table_${String(tableid)}`, op: "delete_table", id_value: tableid, cascade: true }
  ]);
}

function exactAppMatches(searchResult: Record<string, unknown>, appName: string): Record<string, unknown>[] {
  return asRecords(searchResult.matches).filter(match => {
    const summary = asRecord(match.summary);
    return String(summary.appname ?? "") === appName;
  });
}

function exactTableMatches(searchResult: Record<string, unknown>, tableName: string): Record<string, unknown>[] {
  return asRecords(searchResult.matches).filter(match => {
    const summary = asRecord(match.summary);
    return String(summary.tablename ?? "") === tableName;
  });
}

async function assertFixtureRemoved(
  env: SmokeEnv,
  session: SessionLike,
  appName: string,
  tableNames: string[]
): Promise<void> {
  const appSearch = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
    query: appName,
    types: "app",
    limit: 20,
    max_records_per_table: "5000"
  });
  ok(exactAppMatches(appSearch, appName).length === 0, `Fixture app still found: ${JSON.stringify(appSearch, null, 2)}`);

  for (const tableName of tableNames) {
    const tableSearch = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
      query: tableName,
      types: "table",
      limit: 50,
      max_records_per_table: "5000"
    });
    ok(exactTableMatches(tableSearch, tableName).length === 0, `Fixture table still found: ${JSON.stringify(tableSearch, null, 2)}`);
  }
}

function assertRequiredCounts(
  counts: Record<string, unknown>,
  required: string[],
  label: string
): Record<string, number> {
  const output = Object.fromEntries(required.map(key => [key, countOf(counts, key)]));
  const missing = required.filter(key => countOf(counts, key) <= 0);
  ok(missing.length === 0, `${label} missing required counts: ${missing.join(", ")} from ${JSON.stringify(output)}`);
  return output;
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const suffix = Date.now();
  const appName = `Codex Level1 Full ${suffix}`;
  const customerTableName = `codex_l1_customer_${suffix}`;
  const orderTableName = `codex_l1_order_${suffix}`;
  let appid: unknown;
  let customerTableId: unknown;
  let orderTableId: unknown;

  try {
    const createApply = await prepareAndApply(env, session, "level1_full_fixture_create", "Create Level 1 graph fixture", [
      { id: "create_app_1", op: "create_app", record: { appname: appName, description: "Level 1 complete graph fixture" } },
      { id: "create_domain_status", op: "create_domain", record: { appid: "$create_app_1.appid", domainname: `codex_l1_status_${suffix}`, domaintype: "list", description: "Status domain fixture" } },
      { id: "create_table_customer", op: "create_table", record: { tablename: customerTableName, alias: "Level1 Customers", tabletype: "table" } },
      { id: "create_column_customer_name", op: "create_column", record: { tableid: "$create_table_customer.tableid", columnname: "customer_name", datatype: "text", length: 120 } },
      { id: "create_table_order", op: "create_table", record: { tablename: orderTableName, alias: "Level1 Orders", tabletype: "table" } },
      {
        id: "create_column_order_customer",
        op: "create_column",
        record: {
          tableid: "$create_table_order.tableid",
          columnname: "customer_name",
          datatype: "text",
          length: 120,
          linktableid: "$create_table_customer.tableid",
          linkcolumn: "customer_name"
        }
      },
      {
        id: "create_column_order_status",
        op: "create_column",
        record: {
          tableid: "$create_table_order.tableid",
          columnname: "status",
          datatype: "text",
          length: 40,
          domainid: "$create_domain_status.domainid"
        }
      },
      { id: "create_appservice_1", op: "create_appservice", record: { appid: "$create_app_1.appid", serviceid: "$create_table_order.serviceid" } },
      { id: "create_window_1", op: "create_window", record: { appid: "$create_app_1.appid", windowname: "Level1 Orders" } },
      {
        id: "create_tab_order",
        op: "create_tab",
        record: {
          windowid: "$create_window_1.windowid",
          tableid: "$create_table_order.tableid",
          tabname: "Orders",
          relatetableid: "$create_table_customer.tableid",
          relatechildfield: "customer_name",
          relateparentfield: "customer_name"
        }
      },
      {
        id: "create_field_customer",
        op: "create_field",
        record: {
          tabid: "$create_tab_order.tabid",
          columnid: "$create_column_order_customer.columnid",
          fieldname: "Customer",
          linktableid: "$create_table_customer.tableid",
          linkcolumn: "customer_name"
        }
      },
      {
        id: "create_field_status",
        op: "create_field",
        record: {
          tabid: "$create_tab_order.tabid",
          columnid: "$create_column_order_status.columnid",
          fieldname: "Status",
          domainid: "$create_domain_status.domainid"
        }
      },
      { id: "create_menu_1", op: "create_menu", record: { appid: "$create_app_1.appid", menuname: "Level1 Orders", linkwindowid: "$create_window_1.windowid" } },
      { id: "create_roleapp_1", op: "create_roleapp", record: { roleid, appid: "$create_app_1.appid" } },
      { id: "create_rolemenu_1", op: "create_rolemenu", record: { roleid, menuid: "$create_menu_1.menuid" } },
      { id: "create_access_1", op: "create_access", record: { roleid, tableid: "$create_table_order.tableid", noinsert: false, noupdate: false, nodelete: false, noselect: false } }
    ]);

    const appRef = resultReference(createApply, "create_app_1");
    const customerTableRef = resultReference(createApply, "create_table_customer");
    const orderTableRef = resultReference(createApply, "create_table_order");
    appid = appRef.appid;
    customerTableId = customerTableRef.tableid;
    orderTableId = orderTableRef.tableid;

    const subgraph = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_subgraph", {
      node_id: `app:${String(appid)}`,
      depth: 5,
      max_nodes: 500,
      max_records_per_table: "5000",
      max_windows_per_app: "300"
    });
    ok(!subgraph.error, `subgraph failed: ${JSON.stringify(subgraph, null, 2)}`);

    const graph = asRecord(subgraph.graph);
    const nodeCounts = asRecord(graph.node_counts);
    const edgeCounts = asRecord(graph.edge_counts);
    const nodeEvidence = assertRequiredCounts(
      nodeCounts,
      ["app", "appservice", "service", "table", "column", "domain", "window", "tab", "field", "menu", "role", "roleapp", "rolemenu", "access"],
      "fixture node counts"
    );
    const edgeEvidence = assertRequiredCounts(
      edgeCounts,
      [
        "app_has_appservice",
        "appservice_links_service",
        "service_has_table",
        "app_has_table",
        "table_has_column",
        "app_has_domain",
        "column_uses_domain",
        "column_links_table",
        "column_links_column",
        "app_has_window",
        "window_has_tab",
        "tab_uses_table",
        "tab_uses_relation_table",
        "tab_has_field",
        "field_maps_column",
        "field_uses_domain",
        "field_links_table",
        "field_links_column",
        "app_has_menu",
        "menu_links_window",
        "app_has_roleapp",
        "role_grants_app",
        "role_has_rolemenu",
        "rolemenu_grants_menu",
        "role_has_table_access",
        "access_controls_table"
      ],
      "fixture edge counts"
    );

    const appDetail = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
      node_id: `app:${String(appid)}`,
      include_neighbors: true,
      include_fields: true,
      max_records_per_table: "5000",
      max_windows_per_app: "300"
    });
    ok(!appDetail.error, `node_detail failed: ${JSON.stringify(appDetail, null, 2)}`);
    const detail = asRecord(appDetail.detail);
    const detailCounts = asRecord(detail.counts);
    ok(countOf(detailCounts, "services") > 0, `node_detail missing services: ${JSON.stringify(appDetail, null, 2)}`);
    ok(countOf(detailCounts, "domains") > 0, `node_detail missing domains: ${JSON.stringify(appDetail, null, 2)}`);
    ok(countOf(detailCounts, "roleapps") > 0, `node_detail missing roleapps: ${JSON.stringify(appDetail, null, 2)}`);
    ok(countOf(detailCounts, "rolemenus") > 0, `node_detail missing rolemenus: ${JSON.stringify(appDetail, null, 2)}`);
    ok(countOf(detailCounts, "accesses") > 0, `node_detail missing accesses: ${JSON.stringify(appDetail, null, 2)}`);

    const schema = await runAppBuilderGraphTool(env as never, session as never, "app_builder_creation_schema", {
      intent: "level1_full_fixture"
    });
    const createBranch = asRecord(schema.create_app_branch);
    const roleAccess = asRecord(createBranch.role_access);
    const domainLookup = asRecord(createBranch.domain_lookup);
    const serviceBinding = asRecord(createBranch.service_binding);
    ok(Object.keys(roleAccess).length > 0, `creation_schema missing role_access: ${JSON.stringify(schema, null, 2)}`);
    ok(Object.keys(domainLookup).length > 0, `creation_schema missing domain_lookup: ${JSON.stringify(schema, null, 2)}`);
    ok(Object.keys(serviceBinding).length > 0, `creation_schema missing service_binding: ${JSON.stringify(schema, null, 2)}`);

    const cleanupAppApply = await cleanupApp(env, session, appid);
    const cleanupOrderTableApply = await cleanupTable(env, session, orderTableId);
    const cleanupCustomerTableApply = await cleanupTable(env, session, customerTableId);
    appid = undefined;
    orderTableId = undefined;
    customerTableId = undefined;
    await assertFixtureRemoved(env, session, appName, [customerTableName, orderTableName]);

    console.log(JSON.stringify({
      ok: true,
      level: "level1_full_fixture",
      verdict: "full_pass",
      created: {
        appid: appRef.appid,
        customer_tableid: customerTableRef.tableid,
        order_tableid: orderTableRef.tableid
      },
      node_evidence: nodeEvidence,
      edge_evidence: edgeEvidence,
      node_detail_counts: detailCounts,
      schema_verified: {
        role_access: Object.keys(roleAccess),
        domain_lookup: Object.keys(domainLookup),
        service_binding: Object.keys(serviceBinding)
      },
      cleanup: {
        app_applied_count: cleanupAppApply?.applied_count,
        order_table_applied_count: cleanupOrderTableApply?.applied_count,
        customer_table_applied_count: cleanupCustomerTableApply?.applied_count
      }
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
    for (const tableid of [orderTableId, customerTableId]) {
      if (tableid === undefined || tableid === null || tableid === "") continue;
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
