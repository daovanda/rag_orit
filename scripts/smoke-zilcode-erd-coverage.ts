import fs from "node:fs";
import path from "node:path";
import { runAppBuilderGraphTool } from "../src/app-builder-graph";
import { ZILCODE_API_CONTRACTS, ZILCODE_SEMANTIC_GUIDE } from "../src/zilcode-semantic";

type CheckResult = {
  name: string;
  status: "pass" | "fail";
  evidence: Record<string, unknown>;
};

const root = process.cwd();
const zilcodePath = path.join(root, "src", "zilcode.ts");
const graphPath = path.join(root, "src", "app-builder-graph.ts");
const coveragePath = path.join(root, "doc", "logic", "zilcode-agent-read-coverage.md");

const erdTables = [
  "n_app",
  "n_appservice",
  "n_service",
  "n_table",
  "n_column",
  "n_domain",
  "n_window",
  "n_tab",
  "n_field",
  "n_menu",
  "n_cache",
  "n_roleapp",
  "n_rolemenu",
  "n_access",
  "n_role",
  "n_roleuser",
  "n_user",
  "n_org",
  "n_orguser",
  "n_archive",
  "n_site",
  "n_workflow",
  "n_wfstep",
  "n_report",
  "n_map",
  "n_layer"
];

const coreEdges = [
  "app_has_appservice",
  "appservice_links_service",
  "service_has_table",
  "app_has_table",
  "table_has_column",
  "app_has_window",
  "window_has_tab",
  "tab_uses_table",
  "tab_has_field",
  "field_maps_column",
  "column_uses_domain",
  "field_uses_domain",
  "column_links_table",
  "column_links_column",
  "field_links_table",
  "field_links_column",
  "app_has_menu",
  "menu_links_window",
  "menu_links_report",
  "menu_links_layer",
  "app_has_domain",
  "app_has_cache",
  "cache_for_window",
  "app_has_archive",
  "table_has_archive",
  "app_has_workflow",
  "tab_uses_workflow",
  "workflow_has_step",
  "wfstep_assigned_role",
  "wfstep_assigned_user",
  "wfstep_opens_window",
  "app_has_report",
  "report_uses_table",
  "app_builder_has_map",
  "app_builder_has_layer",
  "map_has_layer",
  "app_has_layer",
  "layer_uses_table",
  "layer_uses_service",
  "app_has_roleapp",
  "role_grants_app",
  "role_has_rolemenu",
  "rolemenu_grants_menu",
  "role_has_table_access",
  "access_controls_table",
  "app_builder_has_site",
  "app_builder_has_user",
  "app_builder_has_org",
  "org_parent_child",
  "role_has_user_binding",
  "roleuser_grants_user",
  "org_has_user_binding",
  "orguser_assigns_user"
];

const requiredFactKeys = [
  "flow_summary",
  "tables_summary",
  "windows_summary",
  "menus_summary",
  "permissions_summary",
  "runtime_summary",
  "workflow_summary",
  "report_summary",
  "map_layer_summary",
  "user_org_summary",
  "site_summary",
  "archive_summary",
  "verified_relations",
  "dependency_summary",
  "write_contract_summary",
  "creation_readiness",
  "operation_plan_facts",
  "inferred_notes",
  "truncated",
  "scope"
];

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeCheck(name: string, fn: () => Record<string, unknown>): CheckResult {
  try {
    return { name, status: "pass", evidence: fn() };
  } catch (error) {
    return {
      name,
      status: "fail",
      evidence: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function missingSnippets(text: string, snippets: string[]): string[] {
  return snippets.filter(snippet => !text.includes(snippet));
}

async function main(): Promise<void> {
  const zilcode = read(zilcodePath);
  const graph = read(graphPath);
  const coverage = read(coveragePath);
  const semanticTables = ZILCODE_SEMANTIC_GUIDE.entities.map(entity => entity.table);
  const creationSchema = await runAppBuilderGraphTool({} as never, null, "app_builder_creation_schema", {
    intent: "semantic_guide_smoke"
  });

  const checks = [
    makeCheck("zilcode_record_specs_cover_erd_tables", () => {
      const missing = missingSnippets(zilcode, erdTables.map(table => `table_names: ["${table}"]`));
      check(!missing.length, `Missing record specs: ${missing.join(", ")}`);
      return { required_tables: erdTables.length, missing };
    }),
    makeCheck("graph_dependency_edges_cover_erd_flow", () => {
      const missing = missingSnippets(graph, coreEdges.map(edge => `"${edge}"`));
      check(!missing.length, `Missing graph edge names: ${missing.join(", ")}`);
      return { required_edges: coreEdges.length, missing };
    }),
    makeCheck("answer_facts_cover_read_write_reasoning", () => {
      const missing = missingSnippets(graph, requiredFactKeys);
      check(!missing.length, `Missing answer fact keys in graph implementation: ${missing.join(", ")}`);
      return { required_fact_keys: requiredFactKeys.length, missing };
    }),
    makeCheck("coverage_doc_lists_erd_tables", () => {
      const missing = missingSnippets(coverage, erdTables.map(table => `\`${table}\``));
      check(!missing.length, `Coverage doc missing ERD table names: ${missing.join(", ")}`);
      return { required_tables: erdTables.length, missing };
    }),
    makeCheck("semantic_guide_covers_erd_tables", () => {
      const missing = erdTables.filter(table => !semanticTables.includes(table));
      check(!missing.length, `Semantic guide missing ERD tables: ${missing.join(", ")}`);
      return {
        required_tables: erdTables.length,
        semantic_entities: semanticTables.length,
        missing
      };
    }),
    makeCheck("semantic_guide_states_runtime_boundaries", () => {
      const boundaries = ZILCODE_SEMANTIC_GUIDE.runtime_boundaries;
      const required = [
        "app_builder_metadata",
        "workflow_runtime",
        "report_runtime",
        "gis_runtime",
        "physical_sqlcloud",
        "source_runtime",
        "attachment_runtime",
        "external_proxy"
      ] as const;
      const missing = required.filter(key => !boundaries[key]);
      check(!missing.length, `Semantic guide missing runtime boundaries: ${missing.join(", ")}`);
      check(boundaries.app_builder_metadata.core_write_supported === true, "App Builder metadata boundary should be core-write supported.");
      check(boundaries.workflow_runtime.core_write_supported === false, "Workflow runtime must not be marked core-write supported.");
      check(boundaries.report_runtime.core_write_supported === false, "Report runtime must not be marked core-write supported.");
      check(boundaries.gis_runtime.core_write_supported === false, "GIS runtime must not be marked core-write supported.");
      check(boundaries.physical_sqlcloud.core_write_supported === false, "SQLCloud physical schema must not be marked core-write supported.");
      check(boundaries.source_runtime.core_write_supported === false, "Source runtime must not be marked core-write supported.");
      return {
        required_boundaries: required,
        missing,
        sqlcloud_summary: boundaries.physical_sqlcloud.summary
      };
    }),
    makeCheck("creation_schema_exposes_semantic_guide", () => {
      const schema = creationSchema && typeof creationSchema === "object" && !Array.isArray(creationSchema)
        ? creationSchema as Record<string, unknown>
        : {};
      const guide = schema.semantic_guide && typeof schema.semantic_guide === "object" && !Array.isArray(schema.semantic_guide)
        ? schema.semantic_guide as Record<string, unknown>
        : {};
      const entities = Array.isArray(guide.entities) ? guide.entities : [];
      const coreFlows = Array.isArray(guide.core_flows) ? guide.core_flows : [];
      const apiContracts = Array.isArray(guide.api_contracts) ? guide.api_contracts : [];
      const answerRules = Array.isArray(guide.answer_rules) ? guide.answer_rules : [];
      check(guide.version === 1, "creation_schema.semantic_guide.version should be 1.");
      check(entities.length >= erdTables.length, "creation_schema.semantic_guide.entities does not cover ERD tables.");
      check(coreFlows.length >= 5, "creation_schema.semantic_guide.core_flows is too small.");
      check(apiContracts.length === ZILCODE_API_CONTRACTS.length, "creation_schema.semantic_guide.api_contracts count mismatch.");
      check(answerRules.length >= 5, "creation_schema.semantic_guide.answer_rules is too small.");
      return {
        version: guide.version,
        entities_count: entities.length,
        core_flows_count: coreFlows.length,
        api_contracts_count: apiContracts.length,
        answer_rules_count: answerRules.length
      };
    }),
    makeCheck("coverage_doc_states_boundaries", () => {
      const snippets = [
        "Metadata App Builder va physical schema la hai lop khac nhau.",
        "Da write an toan",
        "Can write layer rieng",
        "SQLCloud physical schema",
        "source editor",
        "workflow/report/GIS full runtime"
      ];
      const missing = missingSnippets(coverage, snippets);
      check(!missing.length, `Coverage doc missing boundary statements: ${missing.join(", ")}`);
      return { snippets_checked: snippets.length, missing };
    })
  ];

  const failed = checks.filter(item => item.status === "fail");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checks
  }, null, 2));

  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
