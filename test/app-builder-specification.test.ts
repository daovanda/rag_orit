import { describe, expect, it } from "vitest";
import {
  compileApplicationSpecification,
  validateApplicationSpecification
} from "../src/app-builder-specification";

function fullSpecification() {
  return {
    app: { key: "rental", appname: "Quản lý phòng trọ" },
    services: [
      { key: "metadata_service", servicename: "Rental Metadata", servicetype: "rest", siteid: 1 }
    ],
    service_bindings: [
      { service_ref: "metadata_service", siteid: 1 }
    ],
    tables: [
      {
        key: "room",
        tablename: "n_room",
        tabletype: "table",
        service_ref: "metadata_service",
        siteid: 1,
        columns: [
          { key: "room_id", columnname: "roomid", datatype: "int", siteid: 1 },
          { key: "room_status", columnname: "status", datatype: "nvarchar", domain_ref: "room_status", siteid: 1 }
        ]
      },
      {
        key: "tenant",
        tablename: "n_tenant",
        tabletype: "table",
        service_ref: "metadata_service",
        siteid: 1,
        columns: [
          { key: "tenant_id", columnname: "tenantid", datatype: "int", siteid: 1 },
          { key: "tenant_room", columnname: "roomid", datatype: "int", lookup_table: "room", linkcolumn: "roomid", siteid: 1 }
        ]
      }
    ],
    domains: [
      { key: "room_status", domainname: "Trạng thái phòng", values: ["empty", "occupied"] }
    ],
    windows: [
      {
        key: "rental_window",
        windowname: "Quản lý phòng trọ",
        windowtype: "window",
        siteid: 1,
        tabs: [
          {
            key: "rooms_tab",
            tabname: "Phòng",
            table_ref: "room",
            siteid: 1,
            fields: [
              { key: "room_id_field", fieldname: "Mã phòng", column_ref: "room_id", fieldtype: "number", siteid: 1 },
              { key: "room_status_field", fieldname: "Trạng thái", column_ref: "room_status", domain_ref: "room_status", fieldtype: "select", siteid: 1 }
            ]
          },
          {
            key: "tenants_tab",
            tabname: "Khách thuê",
            table_ref: "tenant",
            parent_tab: "rooms_tab",
            linkparentfield_ref: "room_id_field",
            linkchildfield_ref: "tenant_room_field",
            siteid: 1,
            fields: [
              { key: "tenant_id_field", fieldname: "Mã khách", column_ref: "tenant_id", fieldtype: "number", siteid: 1 },
              { key: "tenant_room_field", fieldname: "Phòng", column_ref: "tenant_room", fieldtype: "lookup", lookup_table: "room", linkcolumn: "roomid", siteid: 1 }
            ]
          }
        ]
      }
    ],
    menus: [
      { key: "rental_menu", menuname: "Quản lý phòng trọ", window_ref: "rental_window", menutype: "menu", siteid: 1 }
    ],
    roleapps: [{ roleid: 2, siteid: 1 }],
    rolemenus: [{ roleid: 2, menu_ref: "rental_menu", siteid: 1 }],
    accesses: [
      { roleid: 2, table_ref: "room", siteid: 1 },
      { roleid: 2, table_ref: "tenant", siteid: 1 }
    ]
  };
}

describe("ApplicationSpecification compiler", () => {
  it("compiles a full metadata app into a deterministic phase DAG", () => {
    const result = compileApplicationSpecification(fullSpecification());

    expect(result.valid).toBe(true);
    expect(result.blocking_errors).toEqual([]);
    expect(result.operations.map(operation => operation.op)).toEqual(expect.arrayContaining([
      "create_app",
      "create_service",
      "create_appservice",
      "create_table",
      "create_column",
      "create_domain",
      "update_column",
      "create_window",
      "create_tab",
      "create_field",
      "update_tab",
      "create_menu",
      "create_roleapp",
      "create_rolemenu",
      "create_access"
    ]));

    const operationIndex = new Map(result.operations.map((operation, index) => [operation.id, index]));
    result.operations.forEach(operation => {
      operation.depends_on.forEach(dependency => {
        expect(operationIndex.get(dependency)).toBeLessThan(operationIndex.get(operation.id));
      });
    });
    expect(result.phases.find(phase => phase.phase === "window_tab_field")?.operation_ids.length).toBeGreaterThan(0);
    expect(result.verification_targets).toHaveLength(result.operations.length);
    expect(result.operations.find(operation => operation.id.includes("create_tab_rental_window_rooms_tab"))?.record)
      .toEqual(expect.objectContaining({ tableid: expect.stringContaining("create_table_room") }));
    expect(result.operations.find(operation => operation.id.includes("create_menu_rental_menu"))?.record)
      .toEqual(expect.objectContaining({ linkwindowid: expect.stringContaining("create_window_rental_window") }));
    expect(result.operations.find(operation => operation.id.includes("create_access_1"))?.record)
      .toEqual(expect.objectContaining({ tableid: expect.stringContaining("create_table_room") }));
    expect(result.operations.find(operation => operation.id.includes("update_column_relation_room_status"))?.record)
      .toEqual(expect.objectContaining({ domainid: expect.stringContaining("create_domain_room_status") }));
  });

  it("rejects a parent tab outside the current window", () => {
    const specification = fullSpecification();
    specification.windows[0].tabs[1].parent_tab = "tab_from_another_window";

    const errors = validateApplicationSpecification(specification);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "parent_tab_not_in_window", field: "parenttabid" })
    ]));
  });

  it("rejects missing lookup tables and domains before prepare", () => {
    const specification = fullSpecification();
    specification.tables[0].columns[1].domain_ref = "missing_domain";
    specification.tables[1].columns[1].lookup_table = "missing_table";

    const errors = validateApplicationSpecification(specification);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "domain_not_found" }),
      expect.objectContaining({ code: "lookup_table_not_found" })
    ]));
  });

  it("rejects duplicate permissions and invalid permission targets", () => {
    const specification = fullSpecification();
    specification.rolemenus.push({ roleid: 2, menu_ref: "rental_menu", siteid: 1 });
    specification.accesses.push({ roleid: 2, table_ref: "missing_table", siteid: 1 });

    const errors = validateApplicationSpecification(specification);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_permission", entity: "rolemenu" }),
      expect.objectContaining({ code: "permission_target_not_found", entity: "access" })
    ]));
  });

  it("rejects a field mapped to a column outside its tab table", () => {
    const specification = fullSpecification();
    specification.windows[0].tabs[0].fields[0].column_ref = "tenant_id";

    const errors = validateApplicationSpecification(specification);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "field_column_wrong_table" })
    ]));
  });

  it("validates lookup target column and datatype compatibility", () => {
    const specification = fullSpecification();
    specification.tables[1].columns[1].linkcolumn = "missing_column";

    let errors = validateApplicationSpecification(specification);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lookup_column_not_found" })
    ]));

    specification.tables[1].columns[1].linkcolumn = "roomid";
    specification.tables[0].columns[0].datatype = "nvarchar";
    errors = validateApplicationSpecification(specification);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lookup_type_mismatch" })
    ]));
  });

  it("rejects incomplete or type-incompatible parent-child relation fields", () => {
    const specification = fullSpecification();
    delete specification.windows[0].tabs[1].linkchildfield_ref;

    let errors = validateApplicationSpecification(specification);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tab_relation_pair_incomplete" })
    ]));

    specification.windows[0].tabs[1].linkchildfield_ref = "tenant_room_field";
    specification.tables[0].columns[0].datatype = "nvarchar";
    errors = validateApplicationSpecification(specification);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tab_relation_type_mismatch" })
    ]));
  });

  it("rejects explicit access flags that contradict global tab restrictions", () => {
    const specification = fullSpecification();
    specification.windows[0].tabs[0].noinsert = true;
    specification.accesses[0].noinsert = false;

    const errors = validateApplicationSpecification(specification);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tab_access_flag_conflict", field: "noinsert" })
    ]));
  });

  it("requires actual n_tab relation fields for many-to-many declarations", () => {
    const specification = fullSpecification();
    specification.relations = [{
      key: "room_tenant_many",
      target: "tab",
      tab_ref: "tenants_tab",
      relation_type: "many_to_many"
    }];

    const errors = validateApplicationSpecification(specification);

    expect(errors.filter(error => error.code === "many_to_many_relation_incomplete")).toHaveLength(3);
  });

  it("compiles an explicit many-to-many relation after planned tab and field references exist", () => {
    const specification = fullSpecification();
    specification.relations = [{
      key: "room_tenant_many",
      target: "tab",
      tab_ref: "tenants_tab",
      relation_type: "many_to_many",
      relate_table_ref: "tenant",
      relateparentfield_ref: "room_id_field",
      relatechildfield_ref: "tenant_room_field"
    }];

    const result = compileApplicationSpecification(specification);
    expect(result.valid, JSON.stringify(result.blocking_errors)).toBe(true);
    const relation = result.operations.find(operation => operation.id === "update_tab_relation_room_tenant_many");
    expect(relation).toMatchObject({
      op: "update_tab",
      phase: "window_tab_field",
      id_value: expect.stringContaining("create_tab_")
    });
    expect(relation?.record).toEqual({
      relateparentfield: expect.stringContaining("create_field_"),
      relatechildfield: expect.stringContaining("create_field_"),
      relatetableid: expect.stringContaining("create_table_")
    });
    expect(relation?.depends_on.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects explicit relation references that do not exist", () => {
    const specification = fullSpecification();
    specification.relations = [{
      key: "invalid_many",
      target: "tab",
      tab_ref: "tenants_tab",
      relation_type: "many_to_many",
      relate_table_ref: "missing_table",
      relateparentfield_ref: "missing_parent",
      relatechildfield_ref: "missing_child"
    }];

    expect(validateApplicationSpecification(specification)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "relation_table_not_found" }),
      expect.objectContaining({ code: "relation_field_not_found", field: "relateparentfield" }),
      expect.objectContaining({ code: "relation_field_not_found", field: "relatechildfield" })
    ]));
  });
});
