import { describe, expect, it } from "vitest";
import {
  __materializeAppBuilderCreateRecordForTest,
  __normalizeAppBuilderWriteRecordForTest
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
});
