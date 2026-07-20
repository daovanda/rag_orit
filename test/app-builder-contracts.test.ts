import { describe, expect, it } from "vitest";
import {
  deriveColumnSchemaEndpoint,
  materializeContractDefaults,
  mergeLiveAndSemanticContract,
  normalizeLiveColumnSchema,
  validateRecordAgainstContract
} from "../src/app-builder-contracts";

describe("dynamic App Builder metadata contracts", () => {
  it("derives the live column endpoint from relative and absolute data URLs", () => {
    expect(deriveColumnSchemaEndpoint({
      urledit: "rest/applicationjs_nut/dbo/data/n_app"
    })).toBe("rest/applicationjs_nut/dbo/column/n_app");

    expect(deriveColumnSchemaEndpoint({
      urlview: "https://demo.zilcode.vn/rest/applicationjs_nut/dbo/data/n_window?limit=100"
    })).toBe("https://demo.zilcode.vn/rest/applicationjs_nut/dbo/column/n_window");
  });

  it("normalizes nullable, identity, PK, length and default fields from ColumnJson", () => {
    const columns = normalizeLiveColumnSchema([
      {
        id: 1,
        name: "appid",
        dataType: "int",
        nullable: false,
        inPrimaryKey: true,
        identity: true
      },
      {
        id: 2,
        name: "appname",
        dataType: "nvarchar",
        length: 120,
        nullable: false,
        identity: false
      },
      {
        id: 3,
        name: "seqno",
        dataType: "int",
        nullable: false,
        defaultValue: "(1)"
      }
    ]);

    expect(columns).toHaveLength(3);
    expect(columns.find(column => column.name === "appid")?.required).toBe(false);
    expect(columns.find(column => column.name === "appname")?.required).toBe(true);
    expect(columns.find(column => column.name === "seqno")?.required).toBe(false);
  });

  it("lets live schema win over stale semantic required fields and records warnings", () => {
    const liveColumns = normalizeLiveColumnSchema([
      { name: "appname", dataType: "nvarchar", nullable: false, length: 80 },
      { name: "apptype", dataType: "nvarchar", nullable: true },
      { name: "seqno", dataType: "int", nullable: false, defaultValue: "(10)" }
    ]);
    const contract = mergeLiveAndSemanticContract(
      "applications",
      "n_app",
      "rest/db/dbo/column/n_app",
      liveColumns,
      ["appname", "apptype", "seqno", "field_that_does_not_exist"]
    );

    expect(contract.required_fields).toEqual(["appname"]);
    expect(contract.warnings.some(warning => warning.includes("field_that_does_not_exist"))).toBe(true);
    expect(contract.warnings.some(warning => warning.includes("schema live được ưu tiên"))).toBe(true);
  });

  it("materializes only safe literal defaults and validates type and length", () => {
    const contract = mergeLiveAndSemanticContract(
      "applications",
      "n_app",
      "rest/db/dbo/column/n_app",
      normalizeLiveColumnSchema([
        { name: "appname", dataType: "nvarchar", length: 8, nullable: false },
        { name: "seqno", dataType: "int", nullable: false, defaultValue: "(10)" },
        { name: "created_at", dataType: "datetime", nullable: false, defaultValue: "getdate()" }
      ]),
      []
    );
    const warnings: string[] = [];
    const record: Record<string, unknown> = { appname: "Tên ứng dụng quá dài" };

    materializeContractDefaults(contract, record, warnings);
    const errors = validateRecordAgainstContract(contract, record);

    expect(record.seqno).toBe(10);
    expect(record.created_at).toBeUndefined();
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "max_length_exceeded", field: "appname" })
    ]));
  });
});
