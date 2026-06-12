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

type ColumnSpec = {
  id: string;
  name: string;
  label: string;
  datatype: string;
  length?: number;
  domain?: string;
  linkTable?: string;
  linkColumn?: string;
};

type TableSpec = {
  id: string;
  name: string;
  alias: string;
  columns: ColumnSpec[];
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
  if (!token) throw new Error("Login khong tra token.");

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

function resultReference(apply: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const results = Array.isArray(apply.results) ? apply.results as Record<string, unknown>[] : [];
  const match = results.find(result => result.operation_id === operationId);
  const reference = match?.reference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw new Error(`Khong tim thay reference cho operation ${operationId}: ${JSON.stringify(match)}`);
  }
  return reference as Record<string, unknown>;
}

function domainJson(items: Array<[string, string, string?]>): string {
  return JSON.stringify(items);
}

function buildTables(suffix: string): TableSpec[] {
  return [
    {
      id: "rooms",
      name: `codex_room_rooms_${suffix}`,
      alias: "Phong tro",
      columns: [
        { id: "room_code", name: "room_code", label: "Ma phong", datatype: "text", length: 40 },
        { id: "room_name", name: "room_name", label: "Ten phong", datatype: "text", length: 120 },
        { id: "floor_no", name: "floor_no", label: "Tang", datatype: "number" },
        { id: "area_sqm", name: "area_sqm", label: "Dien tich", datatype: "decimal" },
        { id: "monthly_rent", name: "monthly_rent", label: "Gia thue thang", datatype: "decimal" },
        { id: "deposit_amount", name: "deposit_amount", label: "Tien coc", datatype: "decimal" },
        { id: "room_status", name: "room_status", label: "Trang thai phong", datatype: "text", length: 40, domain: "room_status" },
        { id: "note", name: "note", label: "Ghi chu", datatype: "text", length: 255 }
      ]
    },
    {
      id: "tenants",
      name: `codex_room_tenants_${suffix}`,
      alias: "Khach thue",
      columns: [
        { id: "tenant_code", name: "tenant_code", label: "Ma khach thue", datatype: "text", length: 40 },
        { id: "full_name", name: "full_name", label: "Ho ten", datatype: "text", length: 160 },
        { id: "phone", name: "phone", label: "Dien thoai", datatype: "text", length: 40 },
        { id: "email", name: "email", label: "Email", datatype: "text", length: 160 },
        { id: "identity_no", name: "identity_no", label: "CCCD/CMND", datatype: "text", length: 40 },
        { id: "address", name: "address", label: "Dia chi", datatype: "text", length: 255 },
        { id: "tenant_status", name: "tenant_status", label: "Trang thai", datatype: "text", length: 40, domain: "tenant_status" }
      ]
    },
    {
      id: "contracts",
      name: `codex_room_contracts_${suffix}`,
      alias: "Hop dong",
      columns: [
        { id: "contract_code", name: "contract_code", label: "Ma hop dong", datatype: "text", length: 40 },
        { id: "room_code", name: "room_code", label: "Phong", datatype: "text", length: 40, linkTable: "rooms", linkColumn: "room_code" },
        { id: "tenant_code", name: "tenant_code", label: "Khach thue", datatype: "text", length: 40, linkTable: "tenants", linkColumn: "tenant_code" },
        { id: "start_date", name: "start_date", label: "Ngay bat dau", datatype: "date" },
        { id: "end_date", name: "end_date", label: "Ngay ket thuc", datatype: "date" },
        { id: "rent_amount", name: "rent_amount", label: "Tien thue", datatype: "decimal" },
        { id: "deposit_amount", name: "deposit_amount", label: "Tien coc", datatype: "decimal" },
        { id: "contract_status", name: "contract_status", label: "Trang thai hop dong", datatype: "text", length: 40, domain: "contract_status" }
      ]
    },
    {
      id: "invoices",
      name: `codex_room_invoices_${suffix}`,
      alias: "Hoa don",
      columns: [
        { id: "invoice_no", name: "invoice_no", label: "So hoa don", datatype: "text", length: 40 },
        { id: "contract_code", name: "contract_code", label: "Hop dong", datatype: "text", length: 40, linkTable: "contracts", linkColumn: "contract_code" },
        { id: "billing_month", name: "billing_month", label: "Thang tinh tien", datatype: "text", length: 20 },
        { id: "room_amount", name: "room_amount", label: "Tien phong", datatype: "decimal" },
        { id: "electricity_amount", name: "electricity_amount", label: "Tien dien", datatype: "decimal" },
        { id: "water_amount", name: "water_amount", label: "Tien nuoc", datatype: "decimal" },
        { id: "service_amount", name: "service_amount", label: "Phi dich vu", datatype: "decimal" },
        { id: "total_amount", name: "total_amount", label: "Tong tien", datatype: "decimal" },
        { id: "payment_status", name: "payment_status", label: "Trang thai thanh toan", datatype: "text", length: 40, domain: "payment_status" },
        { id: "due_date", name: "due_date", label: "Han thanh toan", datatype: "date" }
      ]
    },
    {
      id: "payments",
      name: `codex_room_payments_${suffix}`,
      alias: "Thanh toan",
      columns: [
        { id: "payment_no", name: "payment_no", label: "Ma thanh toan", datatype: "text", length: 40 },
        { id: "invoice_no", name: "invoice_no", label: "Hoa don", datatype: "text", length: 40, linkTable: "invoices", linkColumn: "invoice_no" },
        { id: "payment_date", name: "payment_date", label: "Ngay thanh toan", datatype: "date" },
        { id: "amount", name: "amount", label: "So tien", datatype: "decimal" },
        { id: "method", name: "method", label: "Phuong thuc", datatype: "text", length: 80 },
        { id: "note", name: "note", label: "Ghi chu", datatype: "text", length: 255 }
      ]
    }
  ];
}

function buildOperations(suffix: string, appName: string): Record<string, unknown>[] {
  const operations: Record<string, unknown>[] = [
    {
      id: "create_app_1",
      op: "create_app",
      record: {
        appname: appName,
        description: "Quan ly phong tro, khach thue, hop dong, hoa don va thanh toan"
      }
    },
    {
      id: "create_domain_room_status",
      op: "create_domain",
      record: {
        appid: "$create_app_1.appid",
        domainname: `codex_room_status_${suffix}`,
        domaintype: "list",
        domainjson: domainJson([["available", "Con trong", "green"], ["occupied", "Dang thue", "blue"], ["maintenance", "Bao tri", "orange"]])
      }
    },
    {
      id: "create_domain_contract_status",
      op: "create_domain",
      record: {
        appid: "$create_app_1.appid",
        domainname: `codex_contract_status_${suffix}`,
        domaintype: "list",
        domainjson: domainJson([["draft", "Nhap", "gray"], ["active", "Dang hieu luc", "green"], ["ended", "Da ket thuc", "blue"], ["cancelled", "Da huy", "red"]])
      }
    },
    {
      id: "create_domain_tenant_status",
      op: "create_domain",
      record: {
        appid: "$create_app_1.appid",
        domainname: `codex_tenant_status_${suffix}`,
        domaintype: "list",
        domainjson: domainJson([["active", "Dang thue", "green"], ["inactive", "Ngung thue", "gray"], ["blocked", "Tam khoa", "red"]])
      }
    },
    {
      id: "create_domain_payment_status",
      op: "create_domain",
      record: {
        appid: "$create_app_1.appid",
        domainname: `codex_payment_status_${suffix}`,
        domaintype: "list",
        domainjson: domainJson([["unpaid", "Chua thanh toan", "red"], ["partial", "Thanh toan mot phan", "orange"], ["paid", "Da thanh toan", "green"]])
      }
    }
  ];

  const tables = buildTables(suffix);
  for (const table of tables) {
    operations.push({
      id: `create_table_${table.id}`,
      op: "create_table",
      record: {
        tablename: table.name,
        alias: table.alias,
        tabletype: "table"
      }
    });

    for (const column of table.columns) {
      const record: Record<string, unknown> = {
        tableid: `$create_table_${table.id}.tableid`,
        columnname: column.name,
        alias: column.label,
        datatype: column.datatype,
        length: column.length
      };
      if (column.domain) record.domainid = `$create_domain_${column.domain}.domainid`;
      if (column.linkTable) record.linktableid = `$create_table_${column.linkTable}.tableid`;
      if (column.linkColumn) record.linkcolumn = column.linkColumn;
      operations.push({
        id: `create_column_${table.id}_${column.id}`,
        op: "create_column",
        record
      });
    }
  }

  operations.push({
    id: "create_appservice_1",
    op: "create_appservice",
    record: {
      appid: "$create_app_1.appid",
      serviceid: "$create_table_rooms.serviceid"
    }
  });

  for (const table of tables) {
    operations.push({
      id: `create_window_${table.id}`,
      op: "create_window",
      record: {
        appid: "$create_app_1.appid",
        windowname: table.alias
      }
    });
    operations.push({
      id: `create_tab_${table.id}`,
      op: "create_tab",
      record: {
        windowid: `$create_window_${table.id}.windowid`,
        tableid: `$create_table_${table.id}.tableid`,
        tabname: table.alias
      }
    });

    for (const column of table.columns) {
      const record: Record<string, unknown> = {
        tabid: `$create_tab_${table.id}.tabid`,
        columnid: `$create_column_${table.id}_${column.id}.columnid`,
        fieldname: column.label
      };
      if (column.domain) record.domainid = `$create_domain_${column.domain}.domainid`;
      if (column.linkTable) record.linktableid = `$create_table_${column.linkTable}.tableid`;
      if (column.linkColumn) record.linkcolumn = column.linkColumn;
      operations.push({
        id: `create_field_${table.id}_${column.id}`,
        op: "create_field",
        record
      });
    }
  }

  operations.push({
    id: "create_menu_root",
    op: "create_menu",
    record: {
      appid: "$create_app_1.appid",
      menuname: "Quan ly phong tro",
      translate: "Quan ly phong tro"
    }
  });

  for (const table of tables) {
    operations.push({
      id: `create_menu_${table.id}`,
      op: "create_menu",
      record: {
        appid: "$create_app_1.appid",
        parentid: "$create_menu_root.menuid",
        menuname: table.alias,
        translate: table.alias,
        linkwindowid: `$create_window_${table.id}.windowid`
      }
    });
  }

  operations.push({
    id: "create_roleapp_1",
    op: "create_roleapp",
    record: {
      roleid,
      appid: "$create_app_1.appid"
    }
  });

  operations.push({
    id: "create_rolemenu_root",
    op: "create_rolemenu",
    record: {
      roleid,
      menuid: "$create_menu_root.menuid"
    }
  });

  for (const table of tables) {
    operations.push({
      id: `create_rolemenu_${table.id}`,
      op: "create_rolemenu",
      record: {
        roleid,
        menuid: `$create_menu_${table.id}.menuid`
      }
    });
    operations.push({
      id: `create_access_${table.id}`,
      op: "create_access",
      record: {
        roleid,
        tableid: `$create_table_${table.id}.tableid`,
        noinsert: false,
        noupdate: false,
        nodelete: false,
        noselect: false,
        noexport: false
      }
    });
  }

  return operations;
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);
  const suffix = process.env.ROOM_RENTAL_SUFFIX || String(Date.now());
  const appName = process.env.ROOM_RENTAL_APP_NAME || `Quan ly phong tro Codex ${suffix}`;
  const operations = buildOperations(suffix, appName);

  const prepare = await runAppBuilderWriteTool(env as never, session as never, "app_builder_prepare_change", {
    intent: "create_room_rental_app",
    summary: `Create room rental app ${appName}`,
    operations,
    max_records_per_table: "5000"
  });
  ok(prepare.valid, `Prepare failed: ${JSON.stringify(prepare, null, 2)}`);

  const apply = await runAppBuilderWriteTool(env as never, session as never, "app_builder_apply_change", {
    plan_id: prepare.plan_id
  });
  ok(apply.ok, `Apply failed: ${JSON.stringify(apply, null, 2)}`);

  const appRef = resultReference(apply, "create_app_1");
  const appid = String(appRef.appid);
  const detail = await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
    node_id: `app:${appid}`,
    include_neighbors: true,
    include_fields: false,
    max_records_per_table: "5000"
  });

  const answerFacts = detail.answer_facts && typeof detail.answer_facts === "object"
    ? detail.answer_facts as Record<string, unknown>
    : {};
  const scope = answerFacts.scope && typeof answerFacts.scope === "object"
    ? answerFacts.scope as Record<string, unknown>
    : {};

  console.log(JSON.stringify({
    ok: true,
    app_name: appName,
    appid,
    plan_id: prepare.plan_id,
    operations_count: operations.length,
    applied_count: apply.applied_count,
    graph_node_types: scope.node_types,
    created_refs: {
      app: appRef,
      rooms_table: resultReference(apply, "create_table_rooms"),
      tenants_table: resultReference(apply, "create_table_tenants"),
      contracts_table: resultReference(apply, "create_table_contracts"),
      invoices_table: resultReference(apply, "create_table_invoices"),
      payments_table: resultReference(apply, "create_table_payments"),
      menu_root: resultReference(apply, "create_menu_root")
    }
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
