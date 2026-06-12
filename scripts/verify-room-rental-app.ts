import { runAppBuilderGraphTool } from "../src/app-builder-graph";
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

type ExpectedTable = {
  key: string;
  label: string;
  minColumns: number;
  requiredColumns: string[];
  linkedColumns?: string[];
  domainColumns?: string[];
};

const baseUrl = process.env.ZILCODE_BASE || "https://demo.zilcode.com";
const username = process.env.ZILCODE_USERNAME || "admin";
const sitecode = process.env.ZILCODE_SITECODE || "demo";
const password = process.env.ZILCODE_PASSWORD || "12345678";
const roleid = Number(process.env.ZILCODE_ROLEID || 1);
const orgid = Number(process.env.ZILCODE_ORGID || 0);
const requestedAppid = process.env.ROOM_RENTAL_APPID || "107";
const appNamePrefix = process.env.ROOM_RENTAL_APP_PREFIX || "Quan ly phong tro Codex";

const expectedTables: ExpectedTable[] = [
  {
    key: "rooms",
    label: "Phong tro",
    minColumns: 8,
    requiredColumns: ["room_code", "room_name", "floor_no", "area_sqm", "monthly_rent", "deposit_amount", "room_status", "note"],
    domainColumns: ["room_status"]
  },
  {
    key: "tenants",
    label: "Khach thue",
    minColumns: 7,
    requiredColumns: ["tenant_code", "full_name", "phone", "email", "identity_no", "address", "tenant_status"],
    domainColumns: ["tenant_status"]
  },
  {
    key: "contracts",
    label: "Hop dong",
    minColumns: 8,
    requiredColumns: ["contract_code", "room_code", "tenant_code", "start_date", "end_date", "rent_amount", "deposit_amount", "contract_status"],
    linkedColumns: ["room_code", "tenant_code"],
    domainColumns: ["contract_status"]
  },
  {
    key: "invoices",
    label: "Hoa don",
    minColumns: 10,
    requiredColumns: ["invoice_no", "contract_code", "billing_month", "room_amount", "electricity_amount", "water_amount", "service_amount", "total_amount", "payment_status", "due_date"],
    linkedColumns: ["contract_code"],
    domainColumns: ["payment_status"]
  },
  {
    key: "payments",
    label: "Thanh toan",
    minColumns: 6,
    requiredColumns: ["payment_no", "invoice_no", "payment_date", "amount", "method", "note"],
    linkedColumns: ["invoice_no"]
  }
];

const expectedDomainKeys = [
  "room_status",
  "contract_status",
  "tenant_status",
  "payment_status"
];

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tableKeyFromName(tablename: string): string {
  const match = tablename.match(/codex_room_(rooms|tenants|contracts|invoices|payments)_/);
  return match?.[1] || "";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function resolveRoomRentalAppid(env: SmokeEnv, session: SessionLike): Promise<string> {
  if (requestedAppid) {
    const detail = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
      node_id: `app:${requestedAppid}`,
      include_neighbors: false,
      include_fields: false,
      max_records_per_table: "5000"
    });
    if (!detail.error) return requestedAppid;
  }

  const search = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
    query: appNamePrefix,
    types: "app",
    limit: "20",
    max_records_per_table: "5000"
  });
  const matches = asRecords(search.matches);
  const appids = matches
    .map(match => {
      const summary = asRecord(match.summary);
      const id = stringValue(summary.appid || stringValue(match.id).replace(/^app:/, ""));
      return { id, appname: stringValue(summary.appname || match.label) };
    })
    .filter(item => item.id && item.appname.includes(appNamePrefix))
    .sort((a, b) => numberValue(b.id) - numberValue(a.id));

  assertCondition(appids[0]?.id, `Could not find room rental app with prefix ${appNamePrefix}.`);
  return appids[0].id;
}

async function getDetail(
  env: SmokeEnv,
  session: SessionLike,
  nodeId: string,
  includeFields = true
): Promise<Record<string, unknown>> {
  const detail = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
    node_id: nodeId,
    include_neighbors: true,
    include_fields: includeFields ? "true" : "false",
    max_records_per_table: "5000"
  });
  assertCondition(!detail.error, `Detail failed for ${nodeId}: ${JSON.stringify(detail, null, 2)}`);
  return detail;
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const appid = await resolveRoomRentalAppid(env, session);
  const appDetail = await getDetail(env, session, `app:${appid}`, false);
  const detail = asRecord(appDetail.detail);
  const appRecord = asRecord(detail.record);
  const appname = stringValue(appRecord.appname);

  const appTables = asRecords(detail.tables).filter(table => stringValue(table.tablename).startsWith("codex_room_"));
  const appDomains = asRecords(detail.domains);
  const appWindows = asRecords(detail.windows);
  const appMenus = asRecords(detail.menus);
  const appAccesses = asRecords(detail.accesses);
  const appRoleapps = asRecords(detail.roleapps);
  const appRolemenus = asRecords(detail.rolemenus);

  const tablesByKey = new Map<string, Record<string, unknown>>();
  for (const table of appTables) {
    const key = tableKeyFromName(stringValue(table.tablename));
    if (key) tablesByKey.set(key, table);
  }

  const tableChecks = [];
  for (const expected of expectedTables) {
    const table = tablesByKey.get(expected.key);
    assertCondition(table, `Missing expected table for ${expected.key}.`);

    const tableid = stringValue(table.tableid);
    const tableDetail = await getDetail(env, session, `table:${tableid}`, true);
    const tableDetailBody = asRecord(tableDetail.detail);
    const columns = asRecords(tableDetailBody.columns);
    const columnNames = columns.map(column => stringValue(column.columnname));
    const missingColumns = expected.requiredColumns.filter(column => !columnNames.includes(column));
    const domainColumns = columns.filter(column => expected.domainColumns?.includes(stringValue(column.columnname)));
    const linkedColumns = columns.filter(column => expected.linkedColumns?.includes(stringValue(column.columnname)));

    assertCondition(columns.length >= expected.minColumns, `Table ${expected.key} has ${columns.length} columns, expected at least ${expected.minColumns}.`);
    assertCondition(!missingColumns.length, `Table ${expected.key} missing columns: ${missingColumns.join(", ")}.`);
    assertCondition(domainColumns.length === (expected.domainColumns?.length || 0), `Table ${expected.key} missing domain-linked columns.`);
    assertCondition(linkedColumns.length === (expected.linkedColumns?.length || 0), `Table ${expected.key} missing lookup-linked columns.`);

    tableChecks.push({
      key: expected.key,
      tableid,
      tablename: stringValue(table.tablename),
      columns_count: columns.length,
      domain_columns: domainColumns.map(column => stringValue(column.columnname)),
      linked_columns: linkedColumns.map(column => stringValue(column.columnname))
    });
  }

  const domainNames = appDomains.map(domain => stringValue(domain.domainname));
  const missingDomains = expectedDomainKeys.filter(key => !domainNames.some(name => name.includes(key)));
  assertCondition(!missingDomains.length, `Missing expected domains: ${missingDomains.join(", ")}.`);

  const windowChecks = [];
  for (const expected of expectedTables) {
    const window = appWindows.find(item => stringValue(item.windowname) === expected.label);
    assertCondition(window, `Missing window ${expected.label}.`);
    const windowid = stringValue(window.windowid);
    const windowDetail = await getDetail(env, session, `window:${windowid}`, true);
    const tabs = asRecords(asRecord(windowDetail.detail).tabs);
    const fields = tabs.flatMap(tab => asRecords(tab.fields));
    assertCondition(tabs.length >= 1, `Window ${expected.label} has no tabs.`);
    assertCondition(fields.length >= expected.minColumns, `Window ${expected.label} has ${fields.length} fields, expected at least ${expected.minColumns}.`);
    windowChecks.push({
      label: expected.label,
      windowid,
      tabs_count: tabs.length,
      fields_count: fields.length
    });
  }

  const menuNames = appMenus.map(menu => stringValue(menu.menuname || menu.translate));
  const missingMenus = ["Quan ly phong tro", ...expectedTables.map(table => table.label)]
    .filter(name => !menuNames.includes(name));
  assertCondition(!missingMenus.length, `Missing menus: ${missingMenus.join(", ")}.`);

  const tableIds = unique(appTables.map(table => stringValue(table.tableid)).filter(Boolean));
  const accessTableIds = unique(appAccesses.map(access => stringValue(access.tableid)).filter(Boolean));
  const missingAccesses = tableIds.filter(tableid => !accessTableIds.includes(tableid));
  assertCondition(!missingAccesses.length, `Missing access rows for tableids: ${missingAccesses.join(", ")}.`);
  assertCondition(appRoleapps.length >= 1, "Missing roleapp binding for room rental app.");
  assertCondition(appRolemenus.length >= 1, "Missing rolemenu bindings for room rental app.");

  console.log(JSON.stringify({
    ok: true,
    appid,
    appname,
    verified: {
      created_tables: tableChecks,
      domains_count: appDomains.length,
      expected_domains_found: expectedDomainKeys,
      windows: windowChecks,
      menus_count: appMenus.length,
      roleapps_count: appRoleapps.length,
      rolemenus_count: appRolemenus.length,
      accesses_count: appAccesses.length
    },
    note: "Verifier checks the Codex room-rental metadata branch, not every table visible through a shared service binding."
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
