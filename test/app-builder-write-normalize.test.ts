import { describe, expect, it } from "vitest";
import {
  __materializeAppBuilderCreateRecordForTest,
  __normalizeAppBuilderWriteRecordForTest,
  __summarizeOperationForTest,
  buildPlannedOperationJournalEvents
} from "../src/app-builder-write";

describe("app builder write record normalization", () => {
  it.each([
    ["app", "appname"],
    ["window", "windowname"],
    ["table", "tablename"],
    ["column", "columnname"],
    ["tab", "tabname"],
    ["field", "fieldname"],
    ["menu", "menuname"],
    ["domain", "domainname"],
    ["service", "servicename"]
  ])("uses new_name as the writable name field for %s", (target, nameField) => {
    const { record } = __normalizeAppBuilderWriteRecordForTest(target, {
      name: "Tên cũ dùng để resolve target",
      new_name: "Tên mới cần ghi"
    });

    expect(record[nameField]).toBe("Tên mới cần ghi");
  });

  it("keeps window link aliases compatible with Zilcode menu metadata", () => {
    const { record } = __normalizeAppBuilderWriteRecordForTest("menu", {
      menu_name: "Quản lý phòng",
      link_window_id: 1150
    });

    expect(record.menuname).toBe("Quản lý phòng");
    expect(record.linkwindowid).toBe(1150);
  });

  it.each([
    ["app", "appname"],
    ["window", "windowname"],
    ["tab", "tabname"],
    ["field", "fieldname"],
    ["menu", "menuname"],
    ["domain", "domainname"],
    ["service", "servicename"]
  ])("uses label/title as the required metadata name field for %s", (target, nameField) => {
    const fromLabel = __normalizeAppBuilderWriteRecordForTest(target, { label: "Tên hiển thị" }).record;
    const fromTitle = __normalizeAppBuilderWriteRecordForTest(target, { title: "Tiêu đề" }).record;

    expect(fromLabel[nameField]).toBe("Tên hiển thị");
    expect(fromTitle[nameField]).toBe("Tiêu đề");
  });

  it("uses table and column labels as aliases, not translate", () => {
    const table = __normalizeAppBuilderWriteRecordForTest("table", {
      table_name: "n_orders",
      label: "Đơn hàng"
    }).record;
    const column = __normalizeAppBuilderWriteRecordForTest("column", {
      column_name: "order_no",
      label: "Số đơn hàng"
    }).record;

    expect(table.tablename).toBe("n_orders");
    expect(table.alias).toBe("Đơn hàng");
    expect(table.translate).toBeUndefined();
    expect(column.columnname).toBe("order_no");
    expect(column.alias).toBe("Số đơn hàng");
    expect(column.translate).toBeUndefined();
  });

  it("normalizes natural lookup and domain aliases for columns", () => {
    const { record } = __normalizeAppBuilderWriteRecordForTest("column", {
      column_name: "customer_id",
      lookup_table: "Customer",
      lookup_column: "customer_name",
      domain_name: "Customer Lookup"
    });

    expect(record.columnname).toBe("customer_id");
    expect(record.lookup_table).toBe("Customer");
    expect(record.linkcolumn).toBe("customer_name");
    expect(record.domainname).toBe("Customer Lookup");
  });

  it("materializes column domain and lookup references from natural names", () => {
    const { record } = __materializeAppBuilderCreateRecordForTest("columns", {
      tableid: 10,
      columnname: "customer_id",
      datatype: "text",
      lookup_table: "n_customers",
      linkcolumn: "customer_name",
      domainname: "Customer Lookup"
    }, {
      allowedColumns: ["tableid", "columnname", "datatype", "columntype", "seqno", "siteid", "domainid", "linktableid", "linkcolumn"],
      recordsByCollection: {
        domains: [{ domainid: 7, domainname: "Customer Lookup" }],
        tables: [{ tableid: 20, tablename: "n_customers", alias: "Customers" }],
        columns: []
      }
    });

    expect(record.domainid).toBe(7);
    expect(record.linktableid).toBe(20);
    expect(record.linkcolumn).toBe("customer_name");
    expect(record.domainname).toBeUndefined();
    expect(record.lookup_table).toBeUndefined();
  });

  it("materializes domain values into domainjson", () => {
    const { record } = __materializeAppBuilderCreateRecordForTest("domains", {
      domain_name: "Order Status",
      domain_values: ["draft", "confirmed"]
    }, {
      allowedColumns: ["domainname", "domainjson", "domaintype", "siteid"],
      recordsByCollection: {
        domains: []
      }
    });

    expect(record.domainname).toBe("Order Status");
    expect(record.domaintype).toBe("list");
    expect(record.domainjson).toBe(JSON.stringify(["draft", "confirmed"]));
  });

  it("keeps field domain and lookup metadata through implicit write contract fields", () => {
    const { record } = __materializeAppBuilderCreateRecordForTest("fields", {
      tabid: 11,
      columnid: 22,
      fieldname: "Khach hang",
      fieldtype: "text",
      lookup_table: "n_customers",
      linkcolumn: "customer_name",
      domainname: "Customer Lookup"
    }, {
      allowedColumns: ["tabid", "columnid", "fieldname", "fieldtype", "seqno", "siteid"],
      recordsByCollection: {
        domains: [{ domainid: 7, domainname: "Customer Lookup" }],
        tables: [{ tableid: 20, tablename: "n_customers", alias: "Customers" }],
        fields: []
      }
    });

    expect(record.domainid).toBe(7);
    expect(record.linktableid).toBe(20);
    expect(record.linkcolumn).toBe("customer_name");
    expect(record.domainname).toBeUndefined();
    expect(record.lookup_table).toBeUndefined();
  });

  it("returns exact non-secret values for confirmation while redacting credentials", () => {
    const summary = __summarizeOperationForTest({
      id: "create_service",
      action: "create",
      target: "service",
      collection: "services",
      label: "ERP service",
      record: {
        servicename: "ERP service",
        url: "https://erp.example.test",
        credential: "top-secret"
      }
    });

    expect(summary.record_preview).toEqual({
      servicename: "ERP service",
      url: "https://erp.example.test",
      credential: "<redacted>"
    });
  });

  it("builds the complete pending journal before the first write attempt", () => {
    const events = buildPlannedOperationJournalEvents("plan_journal", [
      {
        id: "create_app",
        action: "create",
        target: "app",
        collection: "applications",
        label: "Create app",
        record: { appname: "Journal fixture" },
        phase: "app_service"
      },
      {
        id: "create_window",
        action: "create",
        target: "window",
        collection: "windows",
        label: "Create window",
        record: { appid: "$create_app.appid", windowname: "Main" },
        depends_on: ["create_app"],
        phase: "window_tab_field"
      }
    ], 1);

    expect(events).toHaveLength(2);
    expect(events.every(event => event.stage === "planned" && event.status === "pending")).toBe(true);
    expect(events[1]).toMatchObject({
      plan_id: "plan_journal",
      operation_id: "create_window",
      precondition: {
        condition: "dependencies_resolved_and_no_known_duplicate",
        depends_on: ["create_app"]
      },
      expected_effect: {
        postcondition: "target_present_with_expected_values",
        expected_record: { appid: "$create_app.appid", windowname: "Main" }
      }
    });
  });

  it("redacts credentials from the operation journal before persistence callbacks", () => {
    const [event] = buildPlannedOperationJournalEvents("plan_secret", [{
      id: "create_service",
      action: "create",
      target: "service",
      collection: "services",
      label: "Create service",
      record: {
        servicename: "ERP",
        credential: "must-not-be-journaled",
        max_tokens: 2048
      },
      phase: "app_service"
    }], 1);

    expect(event.expected_effect?.expected_record).toEqual({
      servicename: "ERP",
      credential: "<redacted>",
      max_tokens: 2048
    });
  });
});
