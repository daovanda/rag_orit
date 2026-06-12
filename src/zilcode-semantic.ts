export type ZilcodeRuntimeLayer =
  | "app_builder_metadata"
  | "identity_scope"
  | "workflow_runtime"
  | "report_runtime"
  | "gis_runtime"
  | "physical_sqlcloud"
  | "source_runtime"
  | "attachment_runtime"
  | "external_proxy";

export interface ZilcodeSemanticEntity {
  table: string;
  layer: ZilcodeRuntimeLayer;
  meaning: string;
  primary_key: string;
  core_fields: string[];
  relation_meaning: string[];
  read_status: "full" | "metadata" | "boundary";
  write_status: "core_supported" | "partial" | "separate_contract_required" | "not_core";
  safety_note: string;
}

export interface ZilcodeApiContract {
  group: string;
  layer: ZilcodeRuntimeLayer;
  paths: string[];
  purpose: string;
  read_write_scope: "read" | "read_write" | "write_high_risk";
  agent_rule: string;
}

export const ZILCODE_CORE_FLOWS = [
  {
    name: "data_metadata_flow",
    path: "n_app -> n_appservice -> n_service -> n_table -> n_column",
    meaning: "An app uses data through service binding. A table belongs to a service, and columns belong to a table."
  },
  {
    name: "ui_metadata_flow",
    path: "n_app -> n_window -> n_tab -> n_field -> n_column",
    meaning: "A window is UI, a tab binds UI to a table, and a field renders or edits a column."
  },
  {
    name: "navigation_flow",
    path: "n_app -> n_menu -> n_window | n_report | n_layer | exec action",
    meaning: "A menu is the user entry point. It may open a window, report, GIS layer, or execute an action."
  },
  {
    name: "permission_flow",
    path: "n_role -> n_roleapp/n_rolemenu/n_access -> app/menu/table",
    meaning: "Role permissions are split by app access, menu visibility, and table operation flags."
  },
  {
    name: "identity_scope_flow",
    path: "n_site -> n_user/n_org/n_role; n_roleuser/n_orguser bind user to role/org",
    meaning: "Site scopes metadata. Users get permissions through roleuser and org membership through orguser."
  },
  {
    name: "runtime_extension_flow",
    path: "workflow/report/GIS/archive/source/sqlcloud/upload/proxy",
    meaning: "Runtime features extend App Builder metadata, but some write paths are separate from App Builder metadata tools."
  }
] as const;

export const ZILCODE_SEMANTIC_ENTITIES: ZilcodeSemanticEntity[] = [
  {
    table: "n_app",
    layer: "app_builder_metadata",
    meaning: "Application root. It groups windows, menus, domains, service bindings, and role access.",
    primary_key: "appid",
    core_fields: ["appname", "apptype", "seqno", "theme", "translate", "icon", "siteid"],
    relation_meaning: ["parent of windows/menus/domains", "linked to services through n_appservice", "granted to roles through n_roleapp"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Deleting an app should cascade UI/access metadata, but must not delete physical business data."
  },
  {
    table: "n_appservice",
    layer: "app_builder_metadata",
    meaning: "Bridge between app and service.",
    primary_key: "appserviceid",
    core_fields: ["appid", "serviceid", "siteid"],
    relation_meaning: ["app uses service", "service exposes tables"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Without this binding, app-level table visibility can be misleading."
  },
  {
    table: "n_service",
    layer: "app_builder_metadata",
    meaning: "Backend/data service definition such as sqlrest, arcgis, or basemap.",
    primary_key: "serviceid",
    core_fields: ["servicename", "url", "servicetype", "accessuser", "seqno", "siteid"],
    relation_meaning: ["service owns tables", "app binds service through n_appservice", "GIS layers may use service"],
    read_status: "full",
    write_status: "partial",
    safety_note: "Changing service url/credential can affect many apps; require explicit service write policy."
  },
  {
    table: "n_table",
    layer: "app_builder_metadata",
    meaning: "Metadata for a data table/view/layer source in a service.",
    primary_key: "tableid",
    core_fields: ["tablename", "alias", "tabletype", "serviceid", "url", "viewname", "maplayer", "isreadonly", "siteid"],
    relation_meaning: ["table belongs to service", "columns belong to table", "tabs and access records reference table"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Creating n_table metadata is not the same as creating a physical database table."
  },
  {
    table: "n_column",
    layer: "app_builder_metadata",
    meaning: "Metadata for a table column, including datatype, key flags, domain, lookup, default and mapping.",
    primary_key: "columnid",
    core_fields: ["tableid", "columnname", "datatype", "columntype", "domainid", "linktableid", "linkcolumn", "defaultvalue", "seqno"],
    relation_meaning: ["column belongs to table", "field maps to column", "column can use domain or lookup table/column"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Changing n_column metadata does not by itself alter the physical database column."
  },
  {
    table: "n_domain",
    layer: "app_builder_metadata",
    meaning: "Domain/list/status metadata used by columns and fields for select-like behavior.",
    primary_key: "domainid",
    core_fields: ["domainname", "domaintype", "datatype", "appid", "domainjson", "siteid"],
    relation_meaning: ["columns and fields use domainid", "domain often belongs to an app"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Changing a domain can change visible values across every field using that domain."
  },
  {
    table: "n_window",
    layer: "app_builder_metadata",
    meaning: "Business UI screen. It is a container for tabs and is commonly opened by menu.",
    primary_key: "windowid",
    core_fields: ["windowname", "windowtype", "appid", "execname", "isopenfind", "seqno", "siteid"],
    relation_meaning: ["window belongs to app", "window contains tabs", "menus and workflow steps can open window"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Deleting a window should delete/cache fields/tabs/menu links first; it should not delete table data."
  },
  {
    table: "n_tab",
    layer: "app_builder_metadata",
    meaning: "Tab inside a window. It binds a window area to a table and may express parent/child relation or workflow.",
    primary_key: "tabid",
    core_fields: ["windowid", "tableid", "tabname", "parenttabid", "linktableid", "relatetableid", "workflowid", "seqno"],
    relation_meaning: ["tab belongs to window", "tab uses table", "tab contains fields", "tab can reference workflow/relation table"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "A tab is UI metadata. Deleting it should remove fields but not the underlying table."
  },
  {
    table: "n_field",
    layer: "app_builder_metadata",
    meaning: "UI field shown in a tab. It renders or edits a column and can have display logic, domain, lookup, format, or readonly flags.",
    primary_key: "fieldid",
    core_fields: ["tabid", "columnid", "fieldname", "fieldtype", "domainid", "linktableid", "displaylogic", "seqno"],
    relation_meaning: ["field belongs to tab", "field maps to column", "field can use domain or lookup table"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Creating a field without a valid tab and column creates broken UI."
  },
  {
    table: "n_menu",
    layer: "app_builder_metadata",
    meaning: "Navigation item. It can open a window, report, GIS layer, or execute an action.",
    primary_key: "menuid",
    core_fields: ["menuname", "appid", "parentid", "linkwindowid", "windowid", "reportid", "maplayer", "execname", "seqno"],
    relation_meaning: ["menu belongs to app", "menu can link window/report/layer", "rolemenu grants visibility"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Menu visibility also depends on n_rolemenu."
  },
  {
    table: "n_cache",
    layer: "app_builder_metadata",
    meaning: "Generated app/window layout cache.",
    primary_key: "cacheid",
    core_fields: ["appid", "windowid", "configjson", "layoutjson", "siteid"],
    relation_meaning: ["cache can be linked to app/window"],
    read_status: "full",
    write_status: "partial",
    safety_note: "This is not business data cache. Refresh/delete it after UI metadata changes."
  },
  {
    table: "n_roleapp",
    layer: "app_builder_metadata",
    meaning: "Role-to-app access binding.",
    primary_key: "roleappid",
    core_fields: ["roleid", "appid", "siteid"],
    relation_meaning: ["role can access app"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Roleapp alone does not prove the user can see every menu or edit every table."
  },
  {
    table: "n_rolemenu",
    layer: "app_builder_metadata",
    meaning: "Role-to-menu visibility binding.",
    primary_key: "rolemenuid",
    core_fields: ["roleid", "menuid", "whereclause", "siteid"],
    relation_meaning: ["role can see menu"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "Deleting menu should also delete related rolemenu rows."
  },
  {
    table: "n_access",
    layer: "app_builder_metadata",
    meaning: "Role table-level access flags such as noinsert, noupdate, nodelete, noselect, noexport, noattach.",
    primary_key: "accessid",
    core_fields: ["roleid", "tableid", "noinsert", "noupdate", "nodelete", "noselect", "noexport", "noattach", "islock", "siteid"],
    relation_meaning: ["role permissions on table"],
    read_status: "full",
    write_status: "core_supported",
    safety_note: "The no* flags are restrictions; do not invert their meaning."
  },
  {
    table: "n_role",
    layer: "identity_scope",
    meaning: "Role master record.",
    primary_key: "roleid",
    core_fields: ["rolename", "description", "seqno", "siteid"],
    relation_meaning: ["role binds users, apps, menus and table access"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Role changes affect many permissions and should use an identity/security policy."
  },
  {
    table: "n_roleuser",
    layer: "identity_scope",
    meaning: "Bridge between role and user.",
    primary_key: "roleuserid",
    core_fields: ["roleid", "userid", "siteid"],
    relation_meaning: ["user is granted role"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Changing roleuser changes effective permissions."
  },
  {
    table: "n_user",
    layer: "identity_scope",
    meaning: "User account metadata.",
    primary_key: "userid",
    core_fields: ["username", "fullname", "email", "phone", "active", "issystem", "isviewer", "siteid"],
    relation_meaning: ["user can be bound to role and org"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Do not expose password or PIN in graph/detail answers."
  },
  {
    table: "n_org",
    layer: "identity_scope",
    meaning: "Organization/unit tree.",
    primary_key: "orgid",
    core_fields: ["orgname", "orgcode", "active", "parentid", "seqno", "siteid"],
    relation_meaning: ["org can have parent/child orgs and users through orguser"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Org changes affect user scope."
  },
  {
    table: "n_orguser",
    layer: "identity_scope",
    meaning: "Bridge between organization and user.",
    primary_key: "orguserid",
    core_fields: ["orgid", "userid", "siteid"],
    relation_meaning: ["user belongs to org"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Changing orguser changes organization scope."
  },
  {
    table: "n_archive",
    layer: "app_builder_metadata",
    meaning: "Archive/history/attachment behavior metadata linked to a table.",
    primary_key: "archiveid",
    core_fields: ["archivetype", "archivetime", "recordid", "tableid", "siteid"],
    relation_meaning: ["archive configuration belongs to table"],
    read_status: "metadata",
    write_status: "partial",
    safety_note: "Archive metadata is not the archived business record itself."
  },
  {
    table: "n_site",
    layer: "identity_scope",
    meaning: "Tenant/site/database scope.",
    primary_key: "siteid",
    core_fields: ["sitename", "sitecode", "domain", "dbname", "dbserver", "url", "hascache"],
    relation_meaning: ["site scopes metadata, users, roles and orgs"],
    read_status: "full",
    write_status: "not_core",
    safety_note: "Site changes are tenant-level and high impact."
  },
  {
    table: "n_workflow",
    layer: "workflow_runtime",
    meaning: "Workflow/BPMN definition.",
    primary_key: "workflowid",
    core_fields: ["workflowname", "description", "contentjson", "configjson", "appid", "siteid"],
    relation_meaning: ["workflow belongs to app", "tabs can use workflow", "workflow has wfsteps"],
    read_status: "metadata",
    write_status: "separate_contract_required",
    safety_note: "Workflow write needs BPMN validation and step dependency checks."
  },
  {
    table: "n_wfstep",
    layer: "workflow_runtime",
    meaning: "Workflow step and assignment metadata.",
    primary_key: "stepid",
    core_fields: ["workflowid", "elementid", "steptype", "status", "reject", "roleid", "userid", "windowid", "ins", "outs"],
    relation_meaning: ["step belongs to workflow and can assign role/user/open window"],
    read_status: "metadata",
    write_status: "separate_contract_required",
    safety_note: "Step changes can alter approval flow."
  },
  {
    table: "n_report",
    layer: "report_runtime",
    meaning: "Report or analyst metadata.",
    primary_key: "reportid",
    core_fields: ["reportname", "reporttype", "contentjson", "tableid", "appid", "siteid"],
    relation_meaning: ["report belongs to app", "report may use table", "menu may link report"],
    read_status: "metadata",
    write_status: "separate_contract_required",
    safety_note: "Report write needs validation of report JSON, table filters and parameters."
  },
  {
    table: "n_map",
    layer: "gis_runtime",
    meaning: "GIS map configuration.",
    primary_key: "mapid",
    core_fields: ["mapname", "level", "centerx", "centery", "projection", "subtype", "workbook", "siteid"],
    relation_meaning: ["map can contain layers"],
    read_status: "metadata",
    write_status: "separate_contract_required",
    safety_note: "GIS write should validate projection, layer/service compatibility and maplayer references."
  },
  {
    table: "n_layer",
    layer: "gis_runtime",
    meaning: "GIS layer metadata and service/table binding.",
    primary_key: "layerid",
    core_fields: ["layername", "alias", "layertype", "url", "serviceid", "tableid", "isreadonly", "workbook", "siteid"],
    relation_meaning: ["layer can belong to map", "layer can use service/table", "menu/table can reference layer by maplayer"],
    read_status: "metadata",
    write_status: "separate_contract_required",
    safety_note: "Layer writes can affect map behavior and spatial editing."
  }
];

export const ZILCODE_RUNTIME_BOUNDARIES = {
  app_builder_metadata: {
    can_read: true,
    core_write_supported: true,
    summary: "Safe core metadata layer for app/window/table/column/domain/menu/basic access through prepare/apply."
  },
  workflow_runtime: {
    can_read_contract: true,
    core_write_supported: false,
    metadata_tables: ["n_workflow", "n_wfstep"],
    summary: "Workflow/BPMN runtime. Read metadata is covered; write needs BPMN content validation, step dependency checks and role/user/window assignment validation."
  },
  report_runtime: {
    can_read_contract: true,
    core_write_supported: false,
    metadata_tables: ["n_report"],
    summary: "Report and DataRock analyst runtime. Read metadata is covered; write needs report JSON/schema/filter/table validation and menu/report binding checks."
  },
  gis_runtime: {
    can_read_contract: true,
    core_write_supported: false,
    metadata_tables: ["n_map", "n_layer", "n_menu.maplayer", "n_table.maplayer"],
    summary: "GIS/ArcGIS runtime. Read metadata is covered; write needs layer/service/proxy/maplayer validation and spatial edit policy."
  },
  physical_sqlcloud: {
    can_read_contract: true,
    core_write_supported: false,
    api_paths: [
      "/rest/{database}/{schema}/table",
      "/rest/{database}/{schema}/column/{table}/alter",
      "/rest/{database}/{schema}/view/{name}/edit",
      "/rest/{database}/{schema}/procedure/{name}/edit",
      "/rest/{database}/{schema}/query"
    ],
    summary: "Physical DB/schema/SQL runtime. Requires separate SQLCloud tool with backup, preview, dependency scan and verify."
  },
  source_runtime: {
    can_read_contract: true,
    core_write_supported: false,
    api_paths: ["/rest/source/{d1}/{d2}"],
    summary: "Source/file manager runtime. Requires path allow-list, diff preview and separate apply."
  },
  attachment_runtime: {
    can_read_contract: true,
    core_write_supported: false,
    api_paths: ["/rest/upload/{d1}/{d2}/{d3}"],
    summary: "Record/file attachment upload runtime. Requires file/record-specific contract."
  },
  external_proxy: {
    can_read_contract: true,
    core_write_supported: false,
    api_paths: ["/rest/proxy"],
    summary: "External proxy runtime. Treat as network action with strict allow-list."
  }
} as const;

export const ZILCODE_API_CONTRACTS: ZilcodeApiContract[] = [
  {
    group: "token_session",
    layer: "identity_scope",
    paths: [
      "/rest/token",
      "/rest/token/roleorg",
      "/rest/token/app/{id}",
      "/rest/token/cache/{winid}",
      "/rest/token/roleusers/{roleid}",
      "/rest/token/password"
    ],
    purpose: "Login, choose role/org, load app metadata, load window cache and role users.",
    read_write_scope: "read_write",
    agent_rule: "Use for session/bootstrap only. Do not expose token, password or sensitive user fields in answers."
  },
  {
    group: "metadata_and_business_data_crud",
    layer: "app_builder_metadata",
    paths: [
      "/rest/{database}/{schema}/data/{table}",
      "/rest/{database}/{schema}/data/{table}/{id}"
    ],
    purpose: "Generic SqlREST CRUD for metadata tables and business records.",
    read_write_scope: "read_write",
    agent_rule: "For App Builder core metadata writes, go through prepare/apply. For business record writes, require a separate record-level intent and confirmation."
  },
  {
    group: "physical_database_catalog",
    layer: "physical_sqlcloud",
    paths: [
      "/rest/database",
      "/rest/database/{name}",
      "/rest/{database}/schema",
      "/rest/{database}/schema/{name}"
    ],
    purpose: "List or manage databases and schemas.",
    read_write_scope: "write_high_risk",
    agent_rule: "Treat database/schema changes as high-risk SQLCloud operations, not App Builder metadata."
  },
  {
    group: "physical_table_schema",
    layer: "physical_sqlcloud",
    paths: [
      "/rest/{database}/{schema}/table",
      "/rest/{database}/{schema}/table/{name}",
      "/rest/{database}/{schema}/column/{table}",
      "/rest/{database}/{schema}/column/{table}/{name}",
      "/rest/{database}/{schema}/column/{table}/alter"
    ],
    purpose: "Create/read/drop physical tables and alter physical columns.",
    read_write_scope: "write_high_risk",
    agent_rule: "Do not confuse with n_table/n_column metadata. Require SQLCloud contract with preview, backup/dependency scan and verify."
  },
  {
    group: "physical_view_procedure_query",
    layer: "physical_sqlcloud",
    paths: [
      "/rest/{database}/{schema}/view",
      "/rest/{database}/{schema}/view/{name}",
      "/rest/{database}/{schema}/view/{name}/edit",
      "/rest/{database}/{schema}/procedure",
      "/rest/{database}/{schema}/procedure/{name}",
      "/rest/{database}/{schema}/procedure/{name}/edit",
      "/rest/{database}/{schema}/procedure/{name}/{param}",
      "/rest/{database}/{schema}/query"
    ],
    purpose: "Manage SQL views/procedures and execute query/procedure calls.",
    read_write_scope: "write_high_risk",
    agent_rule: "Raw query/procedure/view edits must not be hidden inside App Builder plans. Require explicit SQL policy and result verification."
  },
  {
    group: "source_file_runtime",
    layer: "source_runtime",
    paths: ["/rest/source/{d1}/{d2}"],
    purpose: "List, preview, save, upload or delete source files/folders.",
    read_write_scope: "write_high_risk",
    agent_rule: "Use a separate source tool with path allow-list and diff preview."
  },
  {
    group: "upload_attachment_runtime",
    layer: "attachment_runtime",
    paths: ["/rest/upload/{d1}/{d2}/{d3}"],
    purpose: "Upload attachments or media files.",
    read_write_scope: "write_high_risk",
    agent_rule: "Treat as file/record operation. Require record id, table id and file intent before apply."
  },
  {
    group: "external_proxy_runtime",
    layer: "external_proxy",
    paths: ["/rest/proxy"],
    purpose: "Proxy external network/API calls, used by GIS/DataRock and integration flows.",
    read_write_scope: "write_high_risk",
    agent_rule: "Require allow-list and explicit target. Do not synthesize arbitrary proxy calls."
  },
  {
    group: "attendance_runtime",
    layer: "physical_sqlcloud",
    paths: ["/rest/chamcong/{database}/{schema}/{sid}/{did}/{jwt}"],
    purpose: "Attendance/check-in integration endpoint.",
    read_write_scope: "write_high_risk",
    agent_rule: "Treat as domain-specific runtime outside App Builder metadata. Require a separate attendance contract."
  }
];

export const ZILCODE_AGENT_ANSWER_RULES = [
  "Answer from verified graph facts first, then separate inferred recommendations.",
  "Explain flow before dumping lists: app -> menu -> window -> tab -> table -> field -> column -> domain/lookup.",
  "For create/update/delete, inspect dependency_summary, write_contract_summary, creation_readiness and operation_plan_facts first.",
  "Never claim App Builder metadata writes can alter physical SQLCloud schema, source files, attachments or proxy behavior.",
  "Do not expose sensitive user fields such as password or PIN.",
  "Use roleapp, rolemenu and access with their precise meanings; do not collapse them into one permission."
] as const;

export const ZILCODE_SEMANTIC_GUIDE = {
  version: 1,
  purpose: "Machine-readable meaning map for Zilcode/App Builder graph answers and planning.",
  core_flows: ZILCODE_CORE_FLOWS,
  entities: ZILCODE_SEMANTIC_ENTITIES,
  runtime_boundaries: ZILCODE_RUNTIME_BOUNDARIES,
  api_contracts: ZILCODE_API_CONTRACTS,
  answer_rules: ZILCODE_AGENT_ANSWER_RULES
} as const;
