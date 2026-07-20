import { describe, expect, it, vi } from "vitest";

const blueprintFixture = vi.hoisted(() => ({
  session: {
    base_url: "https://zilcode.example.test",
    roleid: 100,
    role_name: "Administrator",
    orgid: 300,
    org_name: "Head office"
  },
  app_builder_records: {
    inventory: {
      apps: [{
        appid: 1,
        appname: "Full metadata fixture",
        services: [{ serviceid: 10, servicename: "Main service", servicetype: "rest", siteid: 1 }],
        appservices: [{ appserviceid: 11, appid: 1, serviceid: 10, siteid: 1 }],
        tables: [
          {
            tableid: 20,
            tablename: "parent_table",
            alias: "Parent",
            serviceid: 10,
            columns: [
              { columnid: 201, tableid: 20, columnname: "parentid", datatype: "int" },
              { columnid: 202, tableid: 20, columnname: "status", datatype: "nvarchar", domainid: 30 }
            ]
          },
          {
            tableid: 21,
            tablename: "child_table",
            alias: "Child",
            serviceid: 10,
            columns: [
              { columnid: 211, tableid: 21, columnname: "childid", datatype: "int" },
              {
                columnid: 212,
                tableid: 21,
                columnname: "parentid",
                datatype: "int",
                linktableid: 20,
                linkcolumn: "parentid"
              }
            ]
          }
        ],
        domains: [{ domainid: 30, appid: 1, domainname: "Status", datatype: "nvarchar" }],
        workflows: [{ workflowid: 70, appid: 1, workflowname: "Approval", steps_count: 1 }],
        wfsteps: [{
          stepid: 71,
          workflowid: 70,
          stepname: "Review",
          roleid: 100,
          userid: 200,
          windowid: 40
        }],
        reports: [{ reportid: 80, appid: 1, reportname: "Parent report", tableid: 20 }],
        layers: [{ layerid: 91, layername: "Parent layer", mapid: 90, serviceid: 10, tableid: 20 }],
        windows: [{
          windowid: 40,
          appid: 1,
          windowname: "Parent and child",
          tabs: [
            {
              tabid: 50,
              windowid: 40,
              tableid: 20,
              tabname: "Parent",
              workflowid: 70,
              fields: [
                { fieldid: 501, tabid: 50, columnid: 201, fieldname: "Parent ID" },
                { fieldid: 502, tabid: 50, columnid: 202, fieldname: "Status", domainid: 30 }
              ]
            },
            {
              tabid: 51,
              windowid: 40,
              tableid: 21,
              tabname: "Children",
              parenttabid: 50,
              relatetableid: 20,
              relatechildfield: "parentid",
              relateparentfield: "parentid",
              fields: [
                { fieldid: 511, tabid: 51, columnid: 211, fieldname: "Child ID" },
                {
                  fieldid: 512,
                  tabid: 51,
                  columnid: 212,
                  fieldname: "Parent",
                  linktableid: 20,
                  linkcolumn: "parentid"
                }
              ]
            }
          ]
        }],
        menus: [{
          menuid: 60,
          appid: 1,
          menuname: "Open parent",
          linkwindowid: 40,
          reportid: 80,
          maplayer: 91
        }],
        roleapps: [{ roleappid: 110, roleid: 100, appid: 1 }],
        rolemenus: [{ rolemenuid: 111, roleid: 100, menuid: 60 }],
        accesses: [{ accessid: 112, roleid: 100, tableid: 20, noinsert: false, noupdate: false }],
        archives: [{ archiveid: 120, appid: 1, tableid: 20, archivetype: "json" }],
        caches: [{ cacheid: 121, appid: 1, windowid: 40 }]
      }]
    },
    collections: {
      domains: { records: [{ domainid: 30, appid: 1, domainname: "Status", datatype: "nvarchar" }] },
      maps: { records: [{ mapid: 90, mapname: "Operations map", projection: "EPSG:4326" }] },
      layers: { records: [{ layerid: 91, layername: "Parent layer", mapid: 90, serviceid: 10, tableid: 20 }] },
      roles: { records: [{ roleid: 100, rolename: "Administrator" }] },
      sites: { records: [{ siteid: 1, sitecode: "TEST", sitename: "Test site" }] },
      users: { records: [{ userid: 200, username: "reviewer", fullname: "Reviewer", siteid: 1 }] },
      roleusers: { records: [{ roleuserid: 210, roleid: 100, userid: 200, siteid: 1 }] },
      orgs: { records: [{ orgid: 300, orgname: "Head office", siteid: 1 }] },
      orgusers: { records: [{ orguserid: 310, orgid: 300, userid: 200, siteid: 1 }] }
    }
  }
}));

vi.mock("../src/zilcode", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/zilcode")>();
  return {
    ...actual,
    buildZilcodeAppBuilderBlueprint: vi.fn(async () => blueprintFixture)
  };
});

import { runAppBuilderGraphTool } from "../src/app-builder-graph";

describe("app builder read coverage", () => {
  it("builds verified nodes, relations and answer facts for the full supported metadata graph", async () => {
    const result = await runAppBuilderGraphTool(
      {} as Env,
      {
        base_url: "https://zilcode.example.test",
        token: "test-token",
        roleid: 100,
        orgid: 300,
        user: { userid: 200, siteid: 1, sitecode: "TEST" }
      },
      "app_builder_graph_subgraph",
      { node_id: "app:1", depth: 5, max_nodes: 500 }
    );

    const graph = result.graph as {
      node_counts: Record<string, number>;
      edge_counts: Record<string, number>;
      nodes: Array<{ type: string }>;
      edges: Array<{ type: string }>;
    };
    const facts = result.answer_facts as Record<string, unknown>;

    for (const type of [
      "app", "service", "appservice", "table", "column", "domain", "window", "tab", "field", "menu",
      "roleapp", "rolemenu", "access", "workflow", "wfstep", "report", "map", "layer", "archive", "cache",
      "role", "user", "roleuser", "org", "orguser", "site"
    ]) {
      expect(graph.node_counts[type], `missing node type ${type}`).toBeGreaterThan(0);
    }

    for (const relation of [
      "app_has_appservice", "appservice_links_service", "service_has_table", "table_has_column",
      "column_uses_domain", "column_links_table", "column_links_column", "app_has_window", "window_has_tab",
      "tab_parent_child", "tab_uses_table", "tab_uses_relation_table", "tab_has_field", "field_maps_column",
      "field_uses_domain", "field_links_table", "field_links_column", "app_has_menu", "menu_links_window",
      "app_has_workflow", "workflow_has_step", "tab_uses_workflow", "wfstep_assigned_role",
      "wfstep_assigned_user", "wfstep_opens_window", "app_has_report", "report_uses_table", "menu_links_report",
      "map_has_layer", "app_has_layer", "layer_uses_table", "layer_uses_service", "menu_links_layer",
      "app_has_roleapp", "role_grants_app", "role_has_rolemenu", "rolemenu_grants_menu",
      "role_has_table_access", "access_controls_table", "app_has_archive", "table_has_archive",
      "app_has_cache", "cache_for_window", "role_has_user_binding", "roleuser_grants_user",
      "org_has_user_binding", "orguser_assigns_user"
    ]) {
      expect(graph.edge_counts[relation], `missing relation ${relation}`).toBeGreaterThan(0);
    }

    expect((facts.flow_summary as unknown[]).length).toBeGreaterThan(4);
    expect((facts.tables_summary as unknown[]).length).toBe(2);
    expect((facts.windows_summary as unknown[]).length).toBe(1);
    expect((facts.menus_summary as unknown[]).length).toBe(1);
    expect((facts.permissions_summary as unknown[]).length).toBe(3);
    expect((facts.workflow_summary as unknown[]).length).toBe(1);
    expect((facts.report_summary as unknown[]).length).toBe(1);
    expect((facts.map_layer_summary as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((facts.archive_summary as unknown[]).length).toBe(1);
    expect((facts.verified_relations as unknown[]).length).toBeGreaterThan(20);
    expect(facts.runtime_summary).toMatchObject({
      workflows: 1,
      wfsteps: 1,
      reports: 1,
      maps: 1,
      layers: 1,
      archives: 1
    });
  });
});
