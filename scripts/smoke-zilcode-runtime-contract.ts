import fs from "node:fs";
import path from "node:path";
import { runAppBuilderGraphTool } from "../src/app-builder-graph";
import { ZILCODE_API_CONTRACTS } from "../src/zilcode-semantic";

type CheckResult = {
  name: string;
  status: "pass" | "fail";
  evidence: Record<string, unknown>;
};

const rootDir = path.resolve("..");
const apiPath = path.join(rootDir, "api.json");
const daiVietDir = path.join(rootDir, "dai_viet");

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function assertFile(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
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

function containsAll(text: string, snippets: string[]): { missing: string[] } {
  return {
    missing: snippets.filter(snippet => !text.includes(snippet))
  };
}

async function main(): Promise<void> {
  assertFile(apiPath);
  const api = JSON.parse(readText(apiPath)) as { paths?: Record<string, unknown> };
  const paths = Object.keys(api.paths ?? {}).sort();
  const allSemanticPaths = ZILCODE_API_CONTRACTS.flatMap(contract => contract.paths);
  const semanticPaths = [...new Set(allSemanticPaths)].sort();

  const checks: CheckResult[] = [];

  checks.push(makeCheck("api_runtime_paths", () => {
    const missing = semanticPaths.filter(required => !paths.includes(required));
    check(!missing.length, `Missing API paths: ${missing.join(", ")}`);
    return { paths_count: paths.length, required_count: semanticPaths.length, missing };
  }));

  checks.push(makeCheck("api_paths_are_classified_by_semantic_contracts", () => {
    const unclassified = paths.filter(apiPath => !semanticPaths.includes(apiPath));
    const duplicatePaths = allSemanticPaths.filter((apiPath, index) => allSemanticPaths.indexOf(apiPath) !== index);
    check(!unclassified.length, `API paths not classified by semantic contracts: ${unclassified.join(", ")}`);
    check(!duplicatePaths.length, `Duplicate API paths in semantic contracts: ${duplicatePaths.join(", ")}`);
    return {
      api_paths_count: paths.length,
      semantic_paths_count: semanticPaths.length,
      groups: ZILCODE_API_CONTRACTS.map(contract => contract.group),
      unclassified,
      duplicatePaths
    };
  }));

  checks.push(makeCheck("main_runtime_loader", () => {
    const file = path.join(daiVietDir, "js", "index.js");
    const text = readText(file);
    const snippets = [
      "NUT.URL_TOKEN",
      "roleorg",
      "roleusers/",
      "app/",
      "cache/",
      "NUT.access",
      "NUT.workflows",
      "menu.maplayer",
      "NUT.runReport"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing runtime loader snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("dynamic_window_runtime", () => {
    const file = path.join(daiVietDir, "js", "window.js");
    const text = readText(file);
    const snippets = [
      "conf.table.urlview",
      "NUT.ds.insert",
      "NUT.ds.update",
      "NUT.ds.delete",
      "access.noinsert",
      "access.noupdate",
      "access.nodelete",
      "conf.table.maplayer",
      "NUT.uploadFile"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing window runtime snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("nut_client_runtime_contract", () => {
    const file = path.join(daiVietDir, "js", "nut.js");
    const text = readText(file);
    const snippets = [
      "URL_UPLOAD",
      "URL_SOURCE",
      "URL_TOKEN",
      "URL_PROXY",
      "RENDER_TYPE",
      "FILE_EXT",
      "IMAGE_EXT",
      "TEXT_EXT",
      "DOC_EXT",
      "ERD",
      "window:",
      "tab:",
      "field:",
      "menu:",
      "configWindow",
      "cacheDmLink",
      "workflows:",
      "runReport",
      "uploadFile"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing NUT runtime snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("workflow_runtime_contract", () => {
    const file = path.join(daiVietDir, "bpmnwf", "index.js");
    const text = readText(file);
    const snippets = [
      "n_workflow",
      "n_wfstep",
      "contentjson",
      "workflowid",
      "roleid",
      "userid",
      "windowid",
      "deleteWorkflow"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing workflow snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("file_manager_runtime_contract", () => {
    const file = path.join(daiVietDir, "js", "fileman.js");
    const text = readText(file);
    const snippets = [
      "showAttach",
      "saveAttaContent",
      "previewFile",
      "loadFolderNodes",
      "attaCreateFolder_onClick",
      "attaFile_onChange",
      "deleteFile",
      "FormData",
      "method: \"POST\"",
      "method: \"DELETE\"",
      "NUT.FILE_EXT",
      "NUT.TEXT_EXT",
      "NUT.IMAGE_EXT",
      "NUT.DOC_EXT"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing file manager snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("sqlcloud_runtime_contract", () => {
    const file = path.join(daiVietDir, "sqlcloud", "index.js");
    const text = readText(file);
    const snippets = [
      "n_service",
      "servicetype",
      "sqlrest",
      "schema",
      "table/",
      "view/",
      "procedure/",
      "column/",
      "/alter",
      "query",
      "deleteTableView",
      "renameTableAlias"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing SQLCloud snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("datarock_analyst_runtime_contract", () => {
    const file = path.join(daiVietDir, "datarock", "index.js");
    const text = readText(file);
    const snippets = [
      "n_report",
      "reporttype",
      "analyst",
      "contentjson",
      "tableid",
      "appid",
      "nv_appservice_service",
      "nv_appservice_table",
      "NUT.URL_PROXY",
      "arcgis",
      "client_credentials",
      "deleteReport",
      "saveReport",
      "connectTable"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing DataRock analyst snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("source_editor_contract", () => {
    const file = path.join(daiVietDir, "sourceeditor", "index.js");
    const text = readText(file);
    const snippets = [
      "NUT.URL_SOURCE",
      "FMan",
      "loadFolderNodes",
      "previewFile",
      "saveAttaContent"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing source editor snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("report_runtime_contract", () => {
    const file = path.join(daiVietDir, "htmlreport", "index.js");
    const text = readText(file);
    const snippets = [
      "syswindow",
      "syscache",
      "windowtype",
      "report",
      "NUT.runReport",
      "tableid",
      "filter",
      "parameter"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing report snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  checks.push(makeCheck("gis_runtime_contract", () => {
    const file = path.join(daiVietDir, "js", "agmap.js");
    const text = readText(file);
    const snippets = [
      "arcgis",
      "FeatureLayer",
      "maplayer",
      "AGMap.layers",
      "AGMap.tables",
      "selectByOID",
      "selectByQuery",
      "showEditor"
    ];
    const { missing } = containsAll(text, snippets);
    check(!missing.length, `Missing GIS snippets: ${missing.join(", ")}`);
    return { file, snippets_checked: snippets.length };
  }));

  const creationSchema = await runAppBuilderGraphTool({} as never, null, "app_builder_creation_schema", {
    intent: "runtime_contract_audit"
  });

  checks.push(makeCheck("creation_schema_external_runtime_boundaries", () => {
    const runtimeBranches = creationSchema
      && typeof creationSchema === "object"
      && !Array.isArray(creationSchema)
      ? (((creationSchema as Record<string, unknown>).create_app_branch as Record<string, unknown> | undefined)?.runtime_branches as Record<string, unknown> | undefined)
      : undefined;
    const boundaries = creationSchema
      && typeof creationSchema === "object"
      && !Array.isArray(creationSchema)
      ? (creationSchema as Record<string, unknown>).external_runtime_boundaries as Record<string, unknown> | undefined
      : undefined;

    const requiredBranches = [
      "workflow",
      "report",
      "gis",
      "identity_scope",
      "archive",
      "sqlcloud_physical_schema",
      "source_files",
      "upload_attachments",
      "proxy_external"
    ];
    const missingBranches = requiredBranches.filter(key => !runtimeBranches?.[key]);
    check(!missingBranches.length, `Missing creation schema runtime branches: ${missingBranches.join(", ")}`);
    check(boundaries?.answer_rule, "Missing external_runtime_boundaries.answer_rule.");
    return {
      required_branches: requiredBranches,
      has_external_boundaries: Boolean(boundaries),
      answer_rule: boundaries.answer_rule
    };
  }));

  const failed = checks.filter(item => item.status === "fail");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checks,
    api_path_count: paths.length
  }, null, 2));

  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
