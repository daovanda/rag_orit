import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  contractSource: "live_schema" as "live_schema" | "metadata_fallback",
  storedPlans: new Map<string, string>(),
  apiCalls: [] as Array<{ endpoint: string; options: Record<string, unknown> }>,
  nextIds: new Map<string, number>(),
  failEndpointContains: ""
}));

const COLLECTION_COLUMNS: Record<string, string[]> = {
  applications: ["appname", "apptype", "seqno", "siteid", "description", "theme"],
  services: ["servicename", "servicetype", "url", "siteid", "seqno", "accessuser", "accesspass", "credential"],
  appservices: ["appid", "serviceid", "siteid"],
  tables: ["tablename", "alias", "tabletype", "serviceid", "siteid", "seqno", "url", "description"],
  columns: [
    "columnname", "alias", "datatype", "tableid", "siteid", "seqno", "length", "defaultvalue",
    "domainid", "linktableid", "linkcolumn", "mapcolumn", "column_type"
  ],
  domains: ["domainname", "domaintype", "domainjson", "appid", "siteid", "description"],
  windows: ["windowname", "windowtype", "appid", "siteid", "seqno", "description", "icon"],
  tabs: [
    "tabname", "windowid", "tableid", "siteid", "seqno", "parenttabid", "linkparentfieldid",
    "linkchildfieldid", "relateparentfieldid", "relatechildfieldid", "relatetableid", "filterfield",
    "filterdefault", "noinsert", "noupdate", "nodelete", "noload", "noexport"
  ],
  fields: [
    "fieldname", "fieldtype", "tabid", "columnid", "siteid", "seqno", "domainid", "linktableid",
    "linkcolumn", "mapcolumn", "options", "isrequire", "isreadonly"
  ],
  menus: ["menuname", "menutype", "windowid", "linkwindowid", "appid", "siteid", "seqno", "parentid"],
  roleapps: ["roleid", "appid", "siteid"],
  rolemenus: ["roleid", "menuid", "siteid"],
  accesses: [
    "roleid", "tableid", "siteid", "noinsert", "noupdate", "nodelete", "noselect", "noexport",
    "noattach", "isarchive", "islock"
  ],
  caches: ["windowid", "appid", "siteid", "configjson", "layoutjson"]
};

vi.mock("../src/zilcode", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/zilcode")>();
  return {
    ...actual,
    buildZilcodeAppBuilderBlueprint: vi.fn(async () => ({
      app_builder_records: {
        collections: Object.fromEntries(
          Object.keys(COLLECTION_COLUMNS).map((collection, index) => [collection, {
            source_table: {
              tableid: index + 1,
              tablename: `n_${collection}`,
              urledit: `rest/applicationjs_nut/dbo/data/n_${collection}`
            },
            records: []
          }])
        )
      }
    })),
    callZilcodeJson: vi.fn(async (
      _env: Env,
      endpoint: string,
      options: Record<string, unknown>
    ) => {
      fixture.apiCalls.push({ endpoint, options });
      if (fixture.failEndpointContains && endpoint.includes(fixture.failEndpointContains)) {
        throw new Error("Zilcode API lỗi 503: temporary fixture failure");
      }
      const record = Array.isArray(options.data) && options.data[0] && typeof options.data[0] === "object"
        ? options.data[0] as Record<string, unknown>
        : {};
      const idEntry = Object.entries({
        n_applications: ["appid", 100],
        n_services: ["serviceid", 200],
        n_appservices: ["appserviceid", 300],
        n_tables: ["tableid", 400],
        n_columns: ["columnid", 500],
        n_domains: ["domainid", 600],
        n_windows: ["windowid", 700],
        n_tabs: ["tabid", 800],
        n_fields: ["fieldid", 900],
        n_menus: ["menuid", 1000],
        n_roleapps: ["roleappid", 1100],
        n_rolemenus: ["rolemenuid", 1200],
        n_accesses: ["accessid", 1300]
      }).find(([table]) => endpoint.includes(table));
      let generatedRecord = record;
      if (idEntry && String(options.method ?? "GET").toUpperCase() === "POST") {
        const table = idEntry[0];
        const nextId = fixture.nextIds.get(table) ?? Number(idEntry[1][1]);
        fixture.nextIds.set(table, nextId + 1);
        generatedRecord = { ...record, [String(idEntry[1][0])]: nextId };
      }
      return {
        success: true,
        result: generatedRecord
      };
    })
  };
});

vi.mock("../src/app-builder-contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/app-builder-contracts")>();
  return {
    ...actual,
    loadDynamicMetadataContractRegistry: vi.fn(async () => ({
      contracts: Object.fromEntries(Object.entries(COLLECTION_COLUMNS).map(([collection, fields]) => [collection, {
        collection,
        table_name: `n_${collection}`,
        schema_endpoint: `rest/applicationjs_nut/dbo/column/n_${collection}`,
        source: fixture.contractSource,
        columns: Object.fromEntries(fields.map(name => [name, {
          name,
          nullable: true,
          identity: false,
          required: false
        }])),
        required_fields: [],
        warnings: [],
        fetched_at: new Date().toISOString()
      }])),
      warnings: [],
      loaded_at: new Date().toISOString()
    }))
  };
});

import { runAppBuilderWriteTool } from "../src/app-builder-write";
import type { ZilcodeSession } from "../src/types";

function envFixture(): Env {
  return {
    CHUNKS: {
      get: vi.fn(async (key: string) => fixture.storedPlans.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { fixture.storedPlans.set(key, value); }),
      delete: vi.fn(async (key: string) => { fixture.storedPlans.delete(key); })
    }
  } as unknown as Env;
}

const session: ZilcodeSession = {
  base_url: "https://zilcode.example.test",
  token: "test-token",
  roleid: 2,
  orgid: 0,
  user: { userid: 7, siteid: 1, sitecode: "TEST" }
};

function fullSpecification() {
  return {
    app: { key: "orders", appname: "Quản lý đơn hàng", apptype: 1, seqno: 10, siteid: 1 },
    services: [{ key: "service", servicename: "Order service", servicetype: "rest", siteid: 1 }],
    service_bindings: [{ service_ref: "service", siteid: 1 }],
    domains: [{ key: "status", domainname: "Trạng thái", domaintype: "list", values: ["draft", "done"], siteid: 1 }],
    tables: [
      {
        key: "order",
        tablename: "n_order",
        tabletype: "table",
        service_ref: "service",
        siteid: 1,
        columns: [
          { key: "order_id", columnname: "orderid", datatype: "int", siteid: 1 },
          { key: "status", columnname: "status", datatype: "nvarchar", domain_ref: "status", siteid: 1 }
        ]
      },
      {
        key: "line",
        tablename: "n_orderline",
        tabletype: "table",
        service_ref: "service",
        siteid: 1,
        columns: [
          { key: "line_id", columnname: "lineid", datatype: "int", siteid: 1 },
          { key: "line_order", columnname: "orderid", datatype: "int", lookup_table: "order", linkcolumn: "orderid", siteid: 1 }
        ]
      }
    ],
    windows: [
      {
        key: "order_window",
        windowname: "Đơn hàng",
        windowtype: "window",
        siteid: 1,
        tabs: [
          {
            key: "order_tab",
            tabname: "Đơn hàng",
            table_ref: "order",
            siteid: 1,
            fields: [
              { key: "order_id_field", fieldname: "Mã đơn", fieldtype: "number", column_ref: "order_id", siteid: 1 },
              { key: "status_field", fieldname: "Trạng thái", fieldtype: "select", column_ref: "status", domain_ref: "status", siteid: 1 }
            ]
          },
          {
            key: "line_tab",
            tabname: "Chi tiết",
            table_ref: "line",
            parent_tab: "order_tab",
            linkparentfield_ref: "order_id_field",
            linkchildfield_ref: "line_order_field",
            siteid: 1,
            fields: [
              { key: "line_id_field", fieldname: "Dòng", fieldtype: "number", column_ref: "line_id", siteid: 1 },
              { key: "line_order_field", fieldname: "Đơn hàng", fieldtype: "lookup", column_ref: "line_order", lookup_table: "order", linkcolumn: "orderid", siteid: 1 }
            ]
          }
        ]
      },
      {
        key: "line_window",
        windowname: "Tra cứu chi tiết đơn hàng",
        windowtype: "window",
        siteid: 1,
        tabs: [
          {
            key: "line_list_tab",
            tabname: "Chi tiết đơn hàng",
            table_ref: "line",
            siteid: 1,
            fields: [
              { key: "line_list_id_field", fieldname: "Mã dòng", fieldtype: "number", column_ref: "line_id", siteid: 1 },
              { key: "line_list_order_field", fieldname: "Đơn hàng", fieldtype: "lookup", column_ref: "line_order", lookup_table: "order", linkcolumn: "orderid", siteid: 1 }
            ]
          }
        ]
      }
    ],
    menus: [
      { key: "order_menu", menuname: "Đơn hàng", menutype: "menu", window_ref: "order_window", siteid: 1 },
      { key: "line_menu", menuname: "Tra cứu chi tiết", menutype: "menu", window_ref: "line_window", siteid: 1 }
    ],
    roleapps: [{ roleid: 2, siteid: 1 }],
    rolemenus: [
      { roleid: 2, menu_ref: "order_menu", siteid: 1 },
      { roleid: 2, menu_ref: "line_menu", siteid: 1 }
    ],
    accesses: [
      { roleid: 2, table_ref: "order", siteid: 1 },
      { roleid: 2, table_ref: "line", siteid: 1 }
    ]
  };
}

describe("mocked Zilcode prepare integration", () => {
  beforeEach(() => {
    fixture.contractSource = "live_schema";
    fixture.storedPlans.clear();
    fixture.apiCalls.length = 0;
    fixture.nextIds.clear();
    fixture.failEndpointContains = "";
  });

  it("prepares a simple app and persists an exact confirmation preview", async () => {
    const result = await runAppBuilderWriteTool(envFixture(), session, "app_builder_prepare_change", {
      intent: "create_simple_app",
      application_specification: {
        app: { appname: "Ứng dụng thử nghiệm", apptype: 1, seqno: 10, siteid: 1 }
      }
    });

    expect(result).toMatchObject({ valid: true, status: "ready_for_confirmation", requires_confirmation: true });
    expect(result.operations).toEqual([
      expect.objectContaining({
        action: "create",
        target: "app",
        record_preview: expect.objectContaining({ appname: "Ứng dụng thử nghiệm" })
      })
    ]);
    expect(fixture.storedPlans.has(`app_builder_change:${String(result.plan_id)}`)).toBe(true);
  });

  it("prepares a full multi-table/window metadata chain as a phased DAG", async () => {
    const result = await runAppBuilderWriteTool(envFixture(), session, "app_builder_prepare_change", {
      intent: "create_full_app",
      application_specification: fullSpecification()
    });

    expect(result.valid, JSON.stringify(result.blocking_errors ?? result, null, 2)).toBe(true);
    const operations = result.operations as Array<Record<string, unknown>>;
    expect(operations.map(operation => operation.target)).toEqual(expect.arrayContaining([
      "app", "service", "appservice", "table", "column", "domain", "window", "tab", "field",
      "menu", "roleapp", "rolemenu", "access"
    ]));
    expect(operations.some(operation => operation.action === "update" && operation.target === "column")).toBe(true);
    expect(operations.some(operation => operation.action === "update" && operation.target === "tab")).toBe(true);
    expect(operations.filter(operation => operation.action === "create" && operation.target === "table")).toHaveLength(2);
    expect(operations.filter(operation => operation.action === "create" && operation.target === "window")).toHaveLength(2);
    expect(operations.filter(operation => operation.action === "create" && operation.target === "menu")).toHaveLength(2);
    expect((result.phases as Array<Record<string, unknown>>).map(phase => phase.phase)).toEqual([
      "app_service",
      "table_column",
      "domain_lookup_relation",
      "window_tab_field",
      "menu_permission",
      "cache_verification"
    ]);
  });

  it("fails closed when live metadata schema is unavailable", async () => {
    fixture.contractSource = "metadata_fallback";
    const result = await runAppBuilderWriteTool(envFixture(), session, "app_builder_prepare_change", {
      intent: "create_without_live_schema",
      operations: [{ id: "create_app", op: "create_app", record: { appname: "Unsafe" } }]
    });

    expect(result).toMatchObject({ valid: false, status: "invalid" });
    expect(result.blocking_errors).toEqual([
      expect.objectContaining({ code: "live_metadata_schema_required", operation_id: "create_app" })
    ]);
    expect(fixture.storedPlans.size).toBe(0);
  });

  it("applies the complete multi-table/window chain with every operation reference resolved", async () => {
    const env = envFixture();
    const prepared = await runAppBuilderWriteTool(env, session, "app_builder_prepare_change", {
      intent: "apply_full_app",
      application_specification: fullSpecification()
    });
    expect(prepared.valid, JSON.stringify(prepared.blocking_errors ?? prepared, null, 2)).toBe(true);
    const operationCount = (prepared.operations as unknown[]).length;

    const applied = await runAppBuilderWriteTool(
      env,
      session,
      "app_builder_apply_change",
      { plan_id: prepared.plan_id },
      { retain_pending_plan: true }
    );

    expect(applied).toMatchObject({
      ok: true,
      status: "success",
      applied_count: operationCount,
      failed_count: 0,
      pending_plan_deleted: false
    });
    expect(fixture.apiCalls.length).toBeGreaterThanOrEqual(operationCount);
    for (const call of fixture.apiCalls) {
      expect(JSON.stringify(call.options.data ?? null), call.endpoint).not.toMatch(/\$[A-Za-z0-9_-]+\.[A-Za-z0-9_]+/);
    }
    expect(fixture.apiCalls.some(call => call.endpoint.includes("n_appservices"))).toBe(true);
    expect(fixture.apiCalls.filter(call => call.endpoint.includes("n_tables") && call.options.method === "POST")).toHaveLength(2);
    expect(fixture.apiCalls.filter(call => call.endpoint.includes("n_windows") && call.options.method === "POST")).toHaveLength(2);
    expect(fixture.apiCalls.filter(call => call.endpoint.includes("n_accesses") && call.options.method === "POST")).toHaveLength(2);
  });

  it("applies a confirmed plan with a complete pre-write journal and retains it for verification", async () => {
    const env = envFixture();
    const prepared = await runAppBuilderWriteTool(env, session, "app_builder_prepare_change", {
      intent: "create_simple_app",
      application_specification: {
        app: { appname: "Journal integration", apptype: 1, seqno: 10, siteid: 1 }
      }
    });
    const events: Array<Record<string, unknown>> = [];

    const applied = await runAppBuilderWriteTool(
      env,
      session,
      "app_builder_apply_change",
      { plan_id: prepared.plan_id },
      {
        attempt: 1,
        retain_pending_plan: true,
        on_operation_event: event => {
          events.push({ ...event, api_call_count: fixture.apiCalls.length });
        }
      }
    );

    expect(applied).toMatchObject({ ok: true, status: "success", applied_count: 1, pending_plan_deleted: false });
    expect(fixture.apiCalls).toHaveLength(1);
    expect(events.filter(event => event.stage === "planned")).toEqual([
      expect.objectContaining({ operation_id: expect.any(String), status: "pending", api_call_count: 0 })
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "before", status: "running", api_call_count: 0 }),
      expect.objectContaining({ stage: "after", status: "succeeded", api_call_count: 1 })
    ]));
    expect(fixture.storedPlans.has(`app_builder_change:${String(prepared.plan_id)}`)).toBe(true);
  });

  it("fails fast after a transient operation error while preserving the full planned DAG", async () => {
    const env = envFixture();
    const prepared = await runAppBuilderWriteTool(env, session, "app_builder_prepare_change", {
      intent: "partial_failure_fixture",
      operations: [
        {
          id: "create_app",
          op: "create_app",
          record: { appname: "Partial fixture", apptype: 1, seqno: 10, siteid: 1 }
        },
        {
          id: "create_window",
          op: "create_window",
          depends_on: ["create_app"],
          record: {
            appid: "$create_app.appid",
            windowname: "Main",
            windowtype: "window",
            siteid: 1
          }
        },
        {
          id: "create_menu",
          op: "create_menu",
          depends_on: ["create_app", "create_window"],
          record: {
            appid: "$create_app.appid",
            windowid: "$create_window.windowid",
            menuname: "Main",
            menutype: "menu",
            seqno: 10,
            siteid: 1
          }
        }
      ]
    });
    expect(prepared.valid, JSON.stringify(prepared.blocking_errors ?? prepared, null, 2)).toBe(true);
    fixture.failEndpointContains = "n_windows";
    const events: Array<Record<string, unknown>> = [];

    const applied = await runAppBuilderWriteTool(
      env,
      session,
      "app_builder_apply_change",
      { plan_id: prepared.plan_id },
      {
        retain_pending_plan: true,
        on_operation_event: event => events.push({ ...event, api_call_count: fixture.apiCalls.length })
      }
    );

    expect(applied).toMatchObject({ ok: false, status: "partial_success", applied_count: 1, failed_count: 1, skipped_count: 1 });
    expect(fixture.apiCalls).toHaveLength(2);
    expect(events.filter(event => event.stage === "planned")).toHaveLength(3);
    expect(events.filter(event => event.stage === "planned").every(event => event.api_call_count === 0)).toBe(true);
    expect(applied.skipped_operations).toEqual([
      expect.objectContaining({ operation_id: "create_menu", reason: "previous_operation_failed" })
    ]);
    expect(fixture.storedPlans.has(`app_builder_change:${String(prepared.plan_id)}`)).toBe(true);
  });
});
