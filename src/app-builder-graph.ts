import type { Env } from "./config";
import { asRecord, getCaseInsensitiveValue, getNumberArg, getStringArg, toArrayValues, truncateDebugText } from "./utils";
import { buildZilcodeAppBuilderBlueprint, type ZilcodeSession } from "./zilcode";

export const APP_BUILDER_GRAPH_TOOL_NAMES = new Set([
  "app_builder_graph_overview",
  "app_builder_graph_search",
  "app_builder_graph_subgraph",
  "app_builder_node_detail",
  "app_builder_creation_schema"
]);

type GraphToolName =
  | "app_builder_graph_overview"
  | "app_builder_graph_search"
  | "app_builder_graph_subgraph"
  | "app_builder_node_detail"
  | "app_builder_creation_schema";

interface AppBuilderNode {
  id: string;
  type: string;
  label: string;
  summary?: Record<string, unknown>;
  counts?: Record<string, number>;
  has_detail: boolean;
}

interface AppBuilderEdge {
  from: string;
  to: string;
  type: string;
  metadata?: Record<string, unknown>;
}

interface AnswerFactScope {
  node_ids: string[];
  node_types: Record<string, number>;
  source: string;
}

interface VerifiedRelationFact {
  type: string;
  from: {
    id: string;
    type: string;
    label: string;
  };
  to: {
    id: string;
    type: string;
    label: string;
  };
  metadata?: Record<string, unknown>;
}

interface AnswerFacts {
  scope: AnswerFactScope;
  flow_summary: string[];
  tables_summary: Record<string, unknown>[];
  windows_summary: Record<string, unknown>[];
  menus_summary: Record<string, unknown>[];
  permissions_summary: Record<string, unknown>[];
  verified_relations: VerifiedRelationFact[];
  dependency_summary: Record<string, unknown>;
  write_contract_summary: Record<string, unknown>;
  creation_readiness: Record<string, unknown>;
  operation_plan_facts: Record<string, unknown>;
  inferred_notes: string[];
  truncated: Record<string, boolean>;
}

interface SourceRecord {
  type: string;
  record: Record<string, unknown>;
  parent?: Record<string, unknown>;
}

interface GraphContext {
  blueprint: Record<string, unknown>;
  nodes: AppBuilderNode[];
  edges: AppBuilderEdge[];
  nodeById: Map<string, AppBuilderNode>;
  sourceByNodeId: Map<string, SourceRecord>;
  cache?: {
    hit: boolean;
    cache_key: string;
    expires_in_ms?: number;
  };
}

const CHILD_KEYS = new Set([
  "tables",
  "columns",
  "windows",
  "tabs",
  "fields",
  "menus",
  "services",
  "appservices",
  "domains",
  "caches",
  "roleapps",
  "rolemenus",
  "accesses",
  "archives",
  "archives_summary"
]);
const GRAPH_CONTEXT_CACHE_TTL_MS = 90 * 1000;
const graphContextCache = new Map<string, { expiresAt: number; context: GraphContext }>();

const WRITE_ENTITY_CONTRACTS: Record<string, Record<string, unknown>> = {
  app: {
    metadata_table: "n_app",
    collection: "applications",
    primary_key: "appid",
    create_required_fields: ["appname", "seqno", "apptype"],
    defaults_or_resolvable: {
      seqno: "next sequence from existing n_app",
      apptype: "existing apptype app value, first existing apptype, or app",
      siteid: "session siteid or existing app siteid"
    },
    create_aliases: { name: "appname" },
    delete_cascade_supported: true,
    delete_scope: "Deletes app UI/access metadata: cache, field, tab, rolemenu, menu, roleapp, appservice, domain, window, then app. Does not delete physical business tables/data.",
    api_endpoint: "/rest/{database}/{schema}/data/n_app"
  },
  service: {
    metadata_table: "n_service",
    collection: "services",
    primary_key: "serviceid",
    create_required_fields: ["servicename", "servicetype", "siteid"],
    defaults_or_resolvable: { siteid: "session/existing", seqno: "next sequence" },
    create_aliases: { name: "servicename" },
    api_endpoint: "/rest/{database}/{schema}/data/n_service"
  },
  appservice: {
    metadata_table: "n_appservice",
    collection: "appservices",
    primary_key: "appserviceid",
    create_required_fields: ["appid", "serviceid", "siteid"],
    defaults_or_resolvable: { appid: "app reference or previous create_app", serviceid: "service reference", siteid: "session/existing" },
    api_endpoint: "/rest/{database}/{schema}/data/n_appservice"
  },
  table: {
    metadata_table: "n_table",
    collection: "tables",
    primary_key: "tableid",
    create_required_fields: ["tablename", "tabletype", "siteid", "serviceid"],
    defaults_or_resolvable: {
      alias: "tablename",
      tabletype: "table",
      serviceid: "explicit serviceid or inferred service binding",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "tablename" },
    delete_cascade_supported: true,
    delete_scope: "Deletes related field, tab, access, archive, column metadata, then table. Does not delete physical data.",
    api_endpoint: "/rest/{database}/{schema}/data/n_table"
  },
  column: {
    metadata_table: "n_column",
    collection: "columns",
    primary_key: "columnid",
    create_required_fields: ["tableid", "columnname", "seqno", "siteid"],
    defaults_or_resolvable: {
      tableid: "table reference or previous create_table",
      datatype: "from columntype when provided",
      columntype: "from datatype when provided",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "columnname", default: "defaultvalue", default_value: "defaultvalue" },
    delete_cascade_supported: true,
    delete_scope: "Deletes fields mapped to column before deleting column. Does not delete table/data.",
    api_endpoint: "/rest/{database}/{schema}/data/n_column"
  },
  window: {
    metadata_table: "n_window",
    collection: "windows",
    primary_key: "windowid",
    create_required_fields: ["appid", "windowname", "windowtype", "siteid"],
    defaults_or_resolvable: {
      appid: "app reference or previous create_app",
      windowtype: "window",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "windowname" },
    delete_cascade_supported: true,
    delete_scope: "Deletes cache, field, tab, rolemenu, linked menu, then window. Does not delete table/column/data.",
    api_endpoint: "/rest/{database}/{schema}/data/n_window"
  },
  tab: {
    metadata_table: "n_tab",
    collection: "tabs",
    primary_key: "tabid",
    create_required_fields: ["windowid", "tableid", "tabname", "seqno", "siteid"],
    defaults_or_resolvable: {
      windowid: "window reference or previous create_window",
      tableid: "table reference or previous create_table",
      tabname: "name",
      tablevel: "1 when parenttabid exists, else 0",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "tabname" },
    delete_cascade_supported: true,
    delete_scope: "Deletes fields under tab before deleting tab. Does not delete table/column/data.",
    api_endpoint: "/rest/{database}/{schema}/data/n_tab"
  },
  field: {
    metadata_table: "n_field",
    collection: "fields",
    primary_key: "fieldid",
    create_required_fields: ["tabid", "columnid", "fieldname", "fieldtype", "seqno", "siteid"],
    defaults_or_resolvable: {
      tabid: "tab reference or previous create_tab",
      columnid: "column reference or previous create_column",
      fieldname: "name, columnname, or mapped columnname",
      fieldtype: "columntype/datatype from record or mapped column, else text",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "fieldname", required: "isrequire", is_required: "isrequire", default: "defaultvalue" },
    api_endpoint: "/rest/{database}/{schema}/data/n_field"
  },
  menu: {
    metadata_table: "n_menu",
    collection: "menus",
    primary_key: "menuid",
    create_required_fields: ["appid", "menuname", "seqno", "siteid", "menutype"],
    defaults_or_resolvable: {
      appid: "app reference or previous create_app",
      linkwindowid: "window reference when menu opens a window",
      translate: "menuname",
      menutype: "menu",
      siteid: "session/existing",
      seqno: "next sequence"
    },
    create_aliases: { name: "menuname" },
    api_endpoint: "/rest/{database}/{schema}/data/n_menu"
  },
  domain: {
    metadata_table: "n_domain",
    collection: "domains",
    primary_key: "domainid",
    create_required_fields: ["domainname"],
    defaults_or_resolvable: { appid: "app reference", domainjson: "[]", domaintype: "list", siteid: "session/existing" },
    create_aliases: { name: "domainname", values: "domainjson" },
    api_endpoint: "/rest/{database}/{schema}/data/n_domain"
  },
  roleapp: {
    metadata_table: "n_roleapp",
    collection: "roleapps",
    primary_key: "roleappid",
    create_required_fields: ["roleid", "appid", "siteid"],
    defaults_or_resolvable: { roleid: "role reference", appid: "app reference", siteid: "session/existing" },
    api_endpoint: "/rest/{database}/{schema}/data/n_roleapp"
  },
  rolemenu: {
    metadata_table: "n_rolemenu",
    collection: "rolemenus",
    primary_key: "rolemenuid",
    create_required_fields: ["roleid", "menuid", "siteid"],
    defaults_or_resolvable: { roleid: "role reference", menuid: "menu reference", siteid: "session/existing" },
    api_endpoint: "/rest/{database}/{schema}/data/n_rolemenu"
  },
  access: {
    metadata_table: "n_access",
    collection: "accesses",
    primary_key: "accessid",
    create_required_fields: ["roleid", "tableid", "siteid"],
    defaults_or_resolvable: { roleid: "role reference", tableid: "table reference", siteid: "session/existing" },
    api_endpoint: "/rest/{database}/{schema}/data/n_access"
  },
  cache: {
    metadata_table: "n_cache",
    collection: "caches",
    primary_key: "cacheid",
    create_required_fields: ["appid", "siteid"],
    defaults_or_resolvable: { appid: "app reference", windowid: "window reference when cache is window-specific", siteid: "session/existing" },
    api_endpoint: "/rest/{database}/{schema}/data/n_cache"
  }
};

export function invalidateAppBuilderGraphCache(session?: ZilcodeSession | null): void {
  if (!session) {
    graphContextCache.clear();
    return;
  }

  const prefix = graphContextCachePrefix(session);
  for (const key of graphContextCache.keys()) {
    if (key.startsWith(prefix)) graphContextCache.delete(key);
  }
}

export function isAppBuilderGraphTool(name: string): boolean {
  return APP_BUILDER_GRAPH_TOOL_NAMES.has(name);
}

export async function runAppBuilderGraphTool(
  env: Env,
  session: ZilcodeSession | null,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (toolName === "app_builder_creation_schema") {
    return buildCreationSchema(args);
  }

  if (!session) {
    return {
      error: "Chưa đăng nhập Zilcode trong chatbot. Hãy đăng nhập trước khi đọc App Builder graph."
    };
  }

  const context = await buildAppBuilderGraphContext(env, session, args);

  switch (toolName as GraphToolName) {
    case "app_builder_graph_overview":
      return buildOverviewResponse(context, args);
    case "app_builder_graph_search":
      return buildSearchResponse(context, args);
    case "app_builder_graph_subgraph":
      return buildSubgraphResponse(context, args);
    case "app_builder_node_detail":
      return buildNodeDetailResponse(context, args);
    default:
      return { error: `Unsupported App Builder graph tool: ${toolName}` };
  }
}

async function buildAppBuilderGraphContext(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<GraphContext> {
  const cacheKey = graphContextCacheKey(session, args);
  const now = Date.now();
  const cached = graphContextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.context,
      cache: {
        hit: true,
        cache_key: cacheKey,
        expires_in_ms: cached.expiresAt - now
      }
    };
  }

  const blueprint = await buildZilcodeAppBuilderBlueprint(env, session, {
    appid: getStringArg(args, "app_builder_appid") || getStringArg(args, "appid") || "1",
    mode: "graph",
    include_records: "true",
    include_fields: "false",
    include_raw: "false",
    max_records_per_table: String(getNumberArg(args, "max_records_per_table", 500, 1, 5000)),
    max_windows_per_app: String(getNumberArg(args, "max_windows_per_app", 50, 1, 300))
  });

  const context = buildGraphFromBlueprint(blueprint);
  const expiresAt = now + GRAPH_CONTEXT_CACHE_TTL_MS;
  graphContextCache.set(cacheKey, { expiresAt, context });
  return {
    ...context,
    cache: {
      hit: false,
      cache_key: cacheKey,
      expires_in_ms: GRAPH_CONTEXT_CACHE_TTL_MS
    }
  };
}

function buildGraphFromBlueprint(blueprint: Record<string, unknown>): GraphContext {
  const nodes = new Map<string, AppBuilderNode>();
  const edges = new Map<string, AppBuilderEdge>();
  const sourceByNodeId = new Map<string, SourceRecord>();
  const tableById = new Map<string, string>();
  const tableByAppAndName = new Map<string, string>();
  const serviceById = new Map<string, string>();
  const columnById = new Map<string, string>();
  const columnByTableAndName = new Map<string, string>();
  const columnRecordByNodeId = new Map<string, Record<string, unknown>>();
  const windowById = new Map<string, string>();
  const tabById = new Map<string, string>();
  const menuById = new Map<string, string>();
  const domainById = new Map<string, string>();
  const pendingTabParents: Array<{ child: string; parenttabid: unknown }> = [];
  const pendingColumnLinks: Array<{ columnNodeId: string; domainid?: unknown; linktableid?: unknown; linkcolumn?: unknown }> = [];

  const addNode = (node: AppBuilderNode, source?: SourceRecord): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    if (source) sourceByNodeId.set(node.id, source);
  };

  const addEdge = (edge: AppBuilderEdge): void => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    const key = `${edge.from}->${edge.to}:${edge.type}`;
    if (!edges.has(key)) edges.set(key, edge);
  };

  const session = asRecord(blueprint.session) ?? {};
  const rootId = "root:app_builder";
  addNode({
    id: rootId,
    type: "root",
    label: "App Builder",
    summary: {
      role_name: session.role_name,
      org_name: session.org_name,
      base_url: session.base_url
    },
    has_detail: true
  }, { type: "root", record: session });

  const inventory = asRecord(asRecord(blueprint.app_builder_records)?.inventory) ?? {};
  const collections = asRecord(asRecord(blueprint.app_builder_records)?.collections) ?? {};
  const apps = toRecords(inventory.apps);

  for (const app of apps) {
    const appid = stringValue(ci(app, "appid") ?? fallbackId(app, "app"));
    const appNodeId = `app:${idPart(appid)}`;
    const services = toRecords(app.services);
    const appservices = toRecords(app.appservices);
    const tables = toRecords(app.tables);
    const windows = toRecords(app.windows);
    const menus = toRecords(app.menus);
    const domains = toRecords(app.domains);
    const caches = toRecords(app.caches);
    const roleapps = toRecords(app.roleapps);
    const rolemenus = toRecords(app.rolemenus);
    const accesses = toRecords(app.accesses);

    addNode({
      id: appNodeId,
      type: "app",
      label: labelOf(app, ["appname", "app_name", "name", "appcode"], appNodeId),
      summary: compactRecord(app, ["appid", "appname", "appcode", "description", "siteid", "seqno", "active", "apptype"]),
      counts: {
        services: services.length,
        tables: tables.length,
        windows: windows.length,
        menus: menus.length,
        domains: domains.length,
        caches: caches.length,
        roleapps: roleapps.length,
        rolemenus: rolemenus.length,
        accesses: accesses.length
      },
      has_detail: true
    }, { type: "app", record: app });
    addEdge({ from: rootId, to: appNodeId, type: "manages_app" });

    for (const service of services) {
      const serviceKey = stringValue(ci(service, "serviceid") ?? ci(service, "servicename") ?? fallbackId(service, "service"));
      const serviceNodeId = `service:${idPart(serviceKey)}`;
      addNode({
        id: serviceNodeId,
        type: "service",
        label: labelOf(service, ["servicename", "url", "description"], serviceNodeId),
        summary: compactRecord(service, ["serviceid", "servicename", "url", "servicetype", "description", "accessuser", "seqno", "siteid"]),
        has_detail: true
      }, { type: "service", record: service, parent: app });
      serviceById.set(serviceKey, serviceNodeId);
      addEdge({ from: appNodeId, to: serviceNodeId, type: "app_uses_service" });
    }

    for (const appservice of appservices) {
      const appserviceKey = stringValue(ci(appservice, "appserviceid") ?? fallbackId(appservice, "appservice"));
      const serviceId = stringValue(ci(appservice, "serviceid"));
      const appserviceNodeId = `appservice:${idPart(appid)}:${idPart(appserviceKey)}`;
      addNode({
        id: appserviceNodeId,
        type: "appservice",
        label: `appservice ${appserviceKey}`,
        summary: compactRecord(appservice, ["appserviceid", "appid", "serviceid", "siteid"]),
        has_detail: true
      }, { type: "appservice", record: appservice, parent: app });
      addEdge({ from: appNodeId, to: appserviceNodeId, type: "app_has_appservice" });
      const serviceNodeId = serviceId ? serviceById.get(serviceId) : undefined;
      if (serviceNodeId) addEdge({ from: appserviceNodeId, to: serviceNodeId, type: "appservice_links_service" });
    }

    for (const table of tables) {
      const tableKey = stringValue(ci(table, "tableid") ?? ci(table, "tablename") ?? fallbackId(table, "table"));
      const tableNodeId = `table:${idPart(appid)}:${idPart(tableKey)}`;
      const columns = toRecords(table.columns);
      const tableName = stringValue(ci(table, "tablename"));
      const serviceId = stringValue(ci(table, "serviceid"));

      addNode({
        id: tableNodeId,
        type: "table",
        label: labelOf(table, ["alias", "tablename", "table_name", "name"], tableNodeId),
        summary: compactRecord(table, [
          "tableid", "tablename", "alias", "tabletype", "description", "columnkey", "columncode",
          "columndisplay", "columnfind", "serviceid", "isreadonly", "isview"
        ]),
        counts: { columns: columns.length },
        has_detail: true
      }, { type: "table", record: table, parent: app });
      addEdge({ from: appNodeId, to: tableNodeId, type: "app_has_table" });
      const serviceNodeId = serviceId ? serviceById.get(serviceId) : undefined;
      if (serviceNodeId) {
        addEdge({ from: serviceNodeId, to: tableNodeId, type: "service_has_table", metadata: compactRecord(table, ["serviceid", "tableid"]) });
      }

      if (tableKey) tableById.set(String(tableKey), tableNodeId);
      if (tableName) tableByAppAndName.set(`${appid}:${normalizeKey(tableName)}`, tableNodeId);

      for (const column of columns) {
        const columnKey = stringValue(ci(column, "columnid") ?? ci(column, "columnname") ?? fallbackId(column, "column"));
        const columnName = stringValue(ci(column, "columnname"));
        const columnNodeId = `column:${idPart(appid)}:${idPart(tableKey)}:${idPart(columnKey)}`;

        addNode({
          id: columnNodeId,
          type: "column",
          label: labelOf(column, ["columnname", "name", "description"], columnNodeId),
          summary: compactRecord(column, [
            "columnid", "columnname", "tablename", "tableid", "columntype", "datatype",
            "length", "isprimarykey", "isrequire", "isreadonly", "domainid", "linktableid",
            "linkcolumn", "mapcolumn", "seqno", "description"
          ]),
          has_detail: true
        }, { type: "column", record: column, parent: table });
        addEdge({ from: tableNodeId, to: columnNodeId, type: "table_has_column" });
        pendingColumnLinks.push({
          columnNodeId,
          domainid: ci(column, "domainid"),
          linktableid: ci(column, "linktableid"),
          linkcolumn: ci(column, "linkcolumn") ?? ci(column, "mapcolumn")
        });

        const columnId = stringValue(ci(column, "columnid"));
        if (columnId) columnById.set(columnId, columnNodeId);
        if (columnName) columnByTableAndName.set(`${tableNodeId}:${normalizeKey(columnName)}`, columnNodeId);
        columnRecordByNodeId.set(columnNodeId, column);
      }
    }
  }

  const domainsCollection = asRecord(collections.domains);
  for (const domain of toRecords(domainsCollection?.records)) {
    const domainKey = stringValue(ci(domain, "domainid") ?? ci(domain, "domainname") ?? fallbackId(domain, "domain"));
    const domainNodeId = `domain:${idPart(domainKey)}`;
    addNode({
      id: domainNodeId,
      type: "domain",
      label: labelOf(domain, ["domainname", "name", "description"], domainNodeId),
      summary: compactRecord(domain, [
        "domainid", "domainname", "name", "description", "datatype", "controltype",
        "domain_values_count", "domainjson_chars"
      ]),
      has_detail: true
    }, { type: "domain", record: domain });
    domainById.set(domainKey, domainNodeId);
    addEdge({ from: rootId, to: domainNodeId, type: "app_builder_has_domain" });
  }

  for (const app of apps) {
    const appid = stringValue(ci(app, "appid") ?? fallbackId(app, "app"));
    const appNodeId = `app:${idPart(appid)}`;
    for (const domain of toRecords(app.domains)) {
      const domainKey = stringValue(ci(domain, "domainid") ?? ci(domain, "domainname") ?? fallbackId(domain, "domain"));
      const domainNodeId = `domain:${idPart(domainKey)}`;
      if (!nodes.has(domainNodeId)) {
        addNode({
          id: domainNodeId,
          type: "domain",
          label: labelOf(domain, ["domainname", "name", "description"], domainNodeId),
          summary: compactRecord(domain, [
            "domainid", "domainname", "name", "domaintype", "description", "datatype", "controltype",
            "appid", "domain_values_count", "domainjson_chars"
          ]),
          has_detail: true
        }, { type: "domain", record: domain, parent: app });
      }
      domainById.set(domainKey, domainNodeId);
      addEdge({ from: appNodeId, to: domainNodeId, type: "app_has_domain" });
    }
  }

  for (const pending of pendingColumnLinks) {
    const domainid = stringValue(pending.domainid);
    const domainNodeId = domainid ? domainById.get(domainid) : undefined;
    if (domainNodeId) {
      addEdge({ from: pending.columnNodeId, to: domainNodeId, type: "column_uses_domain" });
    }

    const linkTableId = stringValue(pending.linktableid);
    const linkTableNodeId = linkTableId ? tableById.get(linkTableId) : undefined;
    if (linkTableNodeId) {
      addEdge({ from: pending.columnNodeId, to: linkTableNodeId, type: "column_links_table" });
      const linkColumn = stringValue(pending.linkcolumn);
      const linkColumnNodeId = linkColumn ? columnByTableAndName.get(`${linkTableNodeId}:${normalizeKey(linkColumn)}`) : undefined;
      if (linkColumnNodeId) {
        addEdge({ from: pending.columnNodeId, to: linkColumnNodeId, type: "column_links_column" });
      }
    }
  }

  for (const app of apps) {
    const appid = stringValue(ci(app, "appid") ?? fallbackId(app, "app"));
    const appNodeId = `app:${idPart(appid)}`;

    for (const windowRecord of toRecords(app.windows)) {
      const windowid = stringValue(ci(windowRecord, "windowid") ?? fallbackId(windowRecord, "window"));
      const windowNodeId = `window:${idPart(windowid)}`;
      const tabs = toRecords(windowRecord.tabs);
      const windowFieldsByTab = new Map<string, Record<string, unknown>[]>();
      for (const field of toRecords(windowRecord.fields)) {
        const fieldTabId = stringValue(ci(field, "tabid"));
        if (!fieldTabId) continue;
        const bucket = windowFieldsByTab.get(fieldTabId) ?? [];
        bucket.push(field);
        windowFieldsByTab.set(fieldTabId, bucket);
      }

      addNode({
        id: windowNodeId,
        type: "window",
        label: labelOf(windowRecord, ["windowname", "translate", "name", "description"], windowNodeId),
        summary: compactRecord(windowRecord, [
          "windowid", "windowname", "windowtype", "appid", "execname", "isopenfind", "translate", "description"
        ]),
        counts: { tabs: tabs.length },
        has_detail: true
      }, { type: "window", record: windowRecord, parent: app });
      addEdge({ from: appNodeId, to: windowNodeId, type: "app_has_window" });
      if (windowid) windowById.set(windowid, windowNodeId);

      for (const tab of tabs) {
        const tabid = stringValue(ci(tab, "tabid") ?? fallbackId(tab, "tab"));
        const tabNodeId = `tab:${idPart(windowid)}:${idPart(tabid)}`;
        const fields = mergeRecordsById(
          toRecords(tab.fields),
          windowFieldsByTab.get(tabid) ?? [],
          ["fieldid", "columnid", "fieldname", "columnname"]
        );
        const tableNodeId = resolveTableNode(tab, appid, tableById, tableByAppAndName);

        addNode({
          id: tabNodeId,
          type: "tab",
          label: labelOf(tab, ["tabname", "translate", "name", "description"], tabNodeId),
          summary: compactRecord(tab, [
            "tabid", "tabname", "parenttabid", "tablevel", "seqno", "tableid", "linktableid",
            "linkchildfield", "linkparentfield", "relatetableid", "relatechildfield",
            "relateparentfield", "workflowid", "isviewonly", "noinsert", "noupdate", "nodelete"
          ]),
          counts: { fields: fields.length },
          has_detail: true
        }, { type: "tab", record: tab, parent: windowRecord });
        addEdge({ from: windowNodeId, to: tabNodeId, type: "window_has_tab" });
        if (tableNodeId) {
          addEdge({
            from: tabNodeId,
            to: tableNodeId,
            type: "tab_uses_table",
            metadata: compactRecord(tab, ["tableid", "linktableid", "linkchildfield", "linkparentfield"])
          });
        }

        if (tabid) tabById.set(tabid, tabNodeId);
        const parenttabid = ci(tab, "parenttabid");
        if (parenttabid !== undefined && parenttabid !== null && String(parenttabid) !== "0") {
          pendingTabParents.push({ child: tabNodeId, parenttabid });
        }

        const relateTableNodeId = resolveRelateTableNode(tab, appid, tableById, tableByAppAndName);
        if (relateTableNodeId) {
          addEdge({
            from: tabNodeId,
            to: relateTableNodeId,
            type: "tab_uses_relation_table",
            metadata: compactRecord(tab, ["relatetableid", "relatechildfield", "relateparentfield"])
          });
        }

        for (const field of fields) {
          const fieldid = stringValue(ci(field, "fieldid") ?? ci(field, "fieldname") ?? ci(field, "columnname") ?? fallbackId(field, "field"));
          const fieldNodeId = `field:${idPart(windowid)}:${idPart(tabid)}:${idPart(fieldid)}`;
          const fieldColumnNodeId = resolveColumnNode(field, tableNodeId, columnById, columnByTableAndName);
          const mappedColumn = fieldColumnNodeId ? columnRecordByNodeId.get(fieldColumnNodeId) : undefined;

          addNode({
            id: fieldNodeId,
            type: "field",
            label: labelOf(field, ["fieldname", "caption", "label", "columnname", "translate"], fieldNodeId),
            summary: compactRecord(field, [
              "fieldid", "fieldname", "columnname", "tableid", "tabid", "caption", "label",
              "datatype", "controltype", "fieldtype", "domainid", "defaultvalue", "isrequire",
              "linktableid", "linkcolumn", "mapcolumn", "whereclause", "isreadonly", "isvisible",
              "isprimarykey", "seqno"
            ]),
            has_detail: true
          }, { type: "field", record: field, parent: tab });
          addEdge({ from: tabNodeId, to: fieldNodeId, type: "tab_has_field" });

          if (fieldColumnNodeId) {
            addEdge({ from: fieldNodeId, to: fieldColumnNodeId, type: "field_maps_column" });
          }

          const domainid = stringValue(ci(field, "domainid") ?? (mappedColumn ? ci(mappedColumn, "domainid") : undefined));
          const domainNodeId = domainid ? domainById.get(domainid) : undefined;
          if (domainNodeId) {
            addEdge({ from: fieldNodeId, to: domainNodeId, type: "field_uses_domain" });
          }

          const linkTableId = stringValue(ci(field, "linktableid") ?? (mappedColumn ? ci(mappedColumn, "linktableid") : undefined));
          const linkTableNodeId = linkTableId ? tableById.get(linkTableId) : undefined;
          if (linkTableNodeId) {
            addEdge({ from: fieldNodeId, to: linkTableNodeId, type: "field_links_table" });
            const linkColumn = stringValue(
              ci(field, "linkcolumn")
                ?? ci(field, "mapcolumn")
                ?? (mappedColumn ? ci(mappedColumn, "linkcolumn") ?? ci(mappedColumn, "mapcolumn") : undefined)
            );
            const linkColumnNodeId = linkColumn ? columnByTableAndName.get(`${linkTableNodeId}:${normalizeKey(linkColumn)}`) : undefined;
            if (linkColumnNodeId) {
              addEdge({ from: fieldNodeId, to: linkColumnNodeId, type: "field_links_column" });
            }
          }
        }
      }
    }
  }

  for (const pending of pendingTabParents) {
    const parentNodeId = tabById.get(String(pending.parenttabid));
    if (parentNodeId) {
      addEdge({ from: parentNodeId, to: pending.child, type: "tab_parent_child" });
    }
  }

  for (const app of apps) {
    const appid = stringValue(ci(app, "appid") ?? fallbackId(app, "app"));
    const appNodeId = `app:${idPart(appid)}`;

    for (const menu of toRecords(app.menus)) {
      const menuKey = stringValue(ci(menu, "menuid") ?? ci(menu, "menuname") ?? fallbackId(menu, "menu"));
      const menuNodeId = `menu:${idPart(appid)}:${idPart(menuKey)}`;
      addNode({
        id: menuNodeId,
        type: "menu",
        label: labelOf(menu, ["menuname", "translate", "name", "description"], menuNodeId),
        summary: compactRecord(menu, [
          "menuid", "menuname", "translate", "parentid", "seqno", "linktype",
          "linkwindowid", "windowid", "appid", "execname", "icon"
        ]),
        has_detail: true
      }, { type: "menu", record: menu, parent: app });
      addEdge({ from: appNodeId, to: menuNodeId, type: "app_has_menu" });
      if (menuKey) menuById.set(String(menuKey), menuNodeId);

      const linkedWindowId = stringValue(ci(menu, "linkwindowid") ?? ci(menu, "windowid"));
      const linkedWindowNodeId = linkedWindowId ? windowById.get(linkedWindowId) : undefined;
      if (linkedWindowNodeId) {
        addEdge({
          from: menuNodeId,
          to: linkedWindowNodeId,
          type: "menu_links_window",
          metadata: compactRecord(menu, ["linkwindowid", "windowid", "execname"])
        });
      }
    }
  }

  const roleById = new Map<string, string>();
  const rolesCollection = asRecord(collections.roles);
  for (const role of toRecords(rolesCollection?.records)) {
    const roleKey = stringValue(ci(role, "roleid") ?? ci(role, "rolename") ?? fallbackId(role, "role"));
    const roleNodeId = `role:${idPart(roleKey)}`;
    addNode({
      id: roleNodeId,
      type: "role",
      label: labelOf(role, ["rolename", "description"], roleNodeId),
      summary: compactRecord(role, ["roleid", "rolename", "description", "seqno", "siteid"]),
      has_detail: true
    }, { type: "role", record: role });
    roleById.set(roleKey, roleNodeId);
    addEdge({ from: rootId, to: roleNodeId, type: "app_builder_has_role" });
  }

  for (const app of apps) {
    const appid = stringValue(ci(app, "appid") ?? fallbackId(app, "app"));
    const appNodeId = `app:${idPart(appid)}`;

    for (const cache of toRecords(app.caches)) {
      const cacheKey = stringValue(ci(cache, "cacheid") ?? fallbackId(cache, "cache"));
      const cacheNodeId = `cache:${idPart(cacheKey)}`;
      addNode({
        id: cacheNodeId,
        type: "cache",
        label: `cache ${cacheKey}`,
        summary: compactRecord(cache, ["cacheid", "windowid", "appid", "siteid"]),
        has_detail: true
      }, { type: "cache", record: cache, parent: app });
      addEdge({ from: appNodeId, to: cacheNodeId, type: "app_has_cache" });
      const windowId = stringValue(ci(cache, "windowid"));
      const windowNodeId = windowId ? windowById.get(windowId) : undefined;
      if (windowNodeId) addEdge({ from: cacheNodeId, to: windowNodeId, type: "cache_for_window" });
    }

    for (const roleapp of toRecords(app.roleapps)) {
      const roleAppKey = stringValue(ci(roleapp, "roleappid") ?? fallbackId(roleapp, "roleapp"));
      const roleAppNodeId = `roleapp:${idPart(appid)}:${idPart(roleAppKey)}`;
      addNode({
        id: roleAppNodeId,
        type: "roleapp",
        label: `roleapp ${roleAppKey}`,
        summary: compactRecord(roleapp, ["roleappid", "roleid", "appid", "siteid"]),
        has_detail: true
      }, { type: "roleapp", record: roleapp, parent: app });
      addEdge({ from: appNodeId, to: roleAppNodeId, type: "app_has_roleapp" });
      const roleId = stringValue(ci(roleapp, "roleid"));
      const roleNodeId = roleId ? roleById.get(roleId) : undefined;
      if (roleNodeId) addEdge({ from: roleNodeId, to: roleAppNodeId, type: "role_grants_app" });
    }

    for (const rolemenu of toRecords(app.rolemenus)) {
      const roleMenuKey = stringValue(ci(rolemenu, "rolemenuid") ?? fallbackId(rolemenu, "rolemenu"));
      const roleMenuNodeId = `rolemenu:${idPart(appid)}:${idPart(roleMenuKey)}`;
      addNode({
        id: roleMenuNodeId,
        type: "rolemenu",
        label: `rolemenu ${roleMenuKey}`,
        summary: compactRecord(rolemenu, ["rolemenuid", "roleid", "menuid", "whereclause", "siteid"]),
        has_detail: true
      }, { type: "rolemenu", record: rolemenu, parent: app });
      const menuId = stringValue(ci(rolemenu, "menuid"));
      const menuNodeId = menuId ? menuById.get(menuId) : undefined;
      if (menuNodeId) addEdge({ from: roleMenuNodeId, to: menuNodeId, type: "rolemenu_grants_menu" });
      const roleId = stringValue(ci(rolemenu, "roleid"));
      const roleNodeId = roleId ? roleById.get(roleId) : undefined;
      if (roleNodeId) addEdge({ from: roleNodeId, to: roleMenuNodeId, type: "role_has_rolemenu" });
    }

    for (const access of toRecords(app.accesses)) {
      const accessKey = stringValue(ci(access, "accessid") ?? fallbackId(access, "access"));
      const accessNodeId = `access:${idPart(appid)}:${idPart(accessKey)}`;
      addNode({
        id: accessNodeId,
        type: "access",
        label: `access ${accessKey}`,
        summary: compactRecord(access, [
          "accessid", "roleid", "tableid", "isarchive", "noinsert", "noupdate", "nodelete",
          "noselect", "noexport", "noattach", "islock", "siteid"
        ]),
        has_detail: true
      }, { type: "access", record: access, parent: app });
      const tableId = stringValue(ci(access, "tableid"));
      const tableNodeId = tableId ? tableById.get(tableId) : undefined;
      if (tableNodeId) addEdge({ from: accessNodeId, to: tableNodeId, type: "access_controls_table" });
      const roleId = stringValue(ci(access, "roleid"));
      const roleNodeId = roleId ? roleById.get(roleId) : undefined;
      if (roleNodeId) addEdge({ from: roleNodeId, to: accessNodeId, type: "role_has_table_access" });
    }
  }

  const nodeList = [...nodes.values()];
  const edgeList = [...edges.values()];

  return {
    blueprint,
    nodes: nodeList,
    edges: edgeList,
    nodeById: nodes,
    sourceByNodeId
  };
}

function buildOverviewResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const maxApps = getNumberArg(args, "max_apps", 100, 1, 500);
  const root = context.nodes.find(node => node.type === "root");
  const allApps = context.nodes.filter(node => node.type === "app");
  const apps = allApps.slice(0, maxApps);
  const overviewNodes = root ? [root, ...apps] : apps;
  const overviewNodeIds = new Set(overviewNodes.map(node => node.id));
  const overviewEdges = context.edges.filter(edge => overviewNodeIds.has(edge.from) && overviewNodeIds.has(edge.to));
  const graph = summarizeGraph(overviewNodes, overviewEdges);

  return {
    mode: "overview",
    description: "Tổng quan App Builder dạng rút gọn theo app. Dùng node_id/appid trong apps để gọi search, subgraph hoặc node_detail khi cần chi tiết.",
    session: context.blueprint.session,
    scan: context.blueprint.scan,
    graph,
    answer_facts: buildAnswerFactsFromSelection(context, overviewNodes, overviewEdges, overviewNodes.map(node => node.id)),
    apps_count: allApps.length,
    apps,
    graph_counts: graphCounts(context.nodes, context.edges),
    truncated: {
      apps: allApps.length > maxApps,
      total_nodes: context.nodes.length,
      total_edges: context.edges.length
    },
    cache: context.cache,
    errors: collectErrors(context.blueprint)
  };
}

function buildSearchResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const query = getStringArg(args, "query") || getStringArg(args, "q");
  const limit = getNumberArg(args, "limit", 12, 1, 50);
  const types = new Set(parseListArg(args, "types").concat(parseListArg(args, "type")));

  if (!query) {
    return {
      mode: "search",
      error: "Thiếu query. Hãy truyền query để tìm app/service/table/window/tab/field/menu/domain/cache/role/access.",
      graph_counts: graphCounts(context.nodes, context.edges)
    };
  }

  const normalizedQuery = normalizeSearchText(query);
  const matches = context.nodes
    .map(node => ({
      node,
      score: scoreNode(node, normalizedQuery),
      matched_text: searchableNodeText(node)
    }))
    .filter(match => match.score > 0)
    .filter(match => !types.size || types.has(match.node.type))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(match => ({
      ...match.node,
      score: match.score
    }));

  return {
    mode: "search",
    query,
    types: types.size ? [...types] : undefined,
    matches_count: matches.length,
    matches,
    graph_counts: graphCounts(context.nodes, context.edges),
    cache: context.cache,
    hint: "Dùng node_id trong matches để gọi app_builder_graph_subgraph hoặc app_builder_node_detail."
  };
}

function buildSubgraphResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const depth = getNumberArg(args, "depth", 1, 1, 5);
  const maxNodes = getNumberArg(args, "max_nodes", 120, 10, 500);
  const startIds = getNodeIds(args);
  const query = getStringArg(args, "query") || getStringArg(args, "q");
  const resolvedStartIds = startIds.length
    ? startIds.flatMap(id => resolveNodeIdCandidates(context, id, 3).map(match => match.id))
    : query
      ? searchNodeIds(context, query, 3)
      : [];

  if (!resolvedStartIds.length) {
    return {
      mode: "subgraph",
      error: "Thiếu node_id/node_ids. Có thể truyền query để tool tự tìm node gần nhất.",
      graph_counts: graphCounts(context.nodes, context.edges)
    };
  }

  const subgraph = filterNeighborhood(context, resolvedStartIds, depth, maxNodes);
  return {
    mode: "subgraph",
    start_node_ids: resolvedStartIds,
    depth,
    graph: summarizeGraph(subgraph.nodes, subgraph.edges),
    answer_facts: buildAnswerFactsFromSelection(context, subgraph.nodes, subgraph.edges, resolvedStartIds),
    graph_counts: graphCounts(context.nodes, context.edges),
    cache: context.cache,
    missing_node_ids: resolvedStartIds.filter(id => !context.nodeById.has(id))
  };
}

function buildNodeDetailResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const includeNeighbors = getBooleanArg(args, "include_neighbors", true);
  const includeFields = getBooleanArg(args, "include_fields", true);
  const requestedNodeId = getNodeIds(args)[0];
  const query = getStringArg(args, "query") || getStringArg(args, "q");
  const candidates = requestedNodeId
    ? resolveNodeIdCandidates(context, requestedNodeId, 5)
    : searchNodeMatches(context, query, 5);
  const nodeId = candidates[0]?.id;

  if (!nodeId) {
    return {
      mode: "detail",
      error: "Thiếu node_id. Có thể truyền query để tool tìm node gần nhất.",
      graph_counts: graphCounts(context.nodes, context.edges),
      cache: context.cache
    };
  }

  const node = context.nodeById.get(nodeId);
  if (!node) {
    return {
      mode: "detail",
      requested_node_id: requestedNodeId,
      node_id: nodeId,
      error: "Không tìm thấy node_id trong graph.",
      candidates,
      search_hint: "Dùng một node_id trong candidates, hoặc truyền query tên app/table/window."
    };
  }

  const factGraph = filterNeighborhood(context, [nodeId], 2, 220);

  return {
    mode: "detail",
    requested_node_id: requestedNodeId,
    resolved_from: requestedNodeId && requestedNodeId !== nodeId ? requestedNodeId : undefined,
    node,
    detail: buildNodeDetail(context, nodeId, includeFields),
    answer_facts: buildAnswerFactsFromSelection(context, factGraph.nodes, factGraph.edges, [nodeId]),
    neighbors: includeNeighbors ? buildNeighborSummary(context, nodeId) : undefined,
    cache: context.cache
  };
}

function buildCreationSchema(args: Record<string, unknown>): Record<string, unknown> {
  const intent = getStringArg(args, "intent") || "general";

  return {
    mode: "creation_schema",
    intent,
    status: "prepare_then_apply",
    note: "Dùng app_builder_prepare_change để tạo pending plan. Chỉ dùng app_builder_apply_change sau khi user xác nhận rõ ràng.",
    graph_first_rule: [
      "1. Gọi app_builder_graph_overview để nắm skeleton hệ thống.",
      "2. Gọi app_builder_graph_search nếu cần tìm app/table/window/tab/field hiện có.",
      "3. Gọi app_builder_graph_subgraph để mở vùng liên quan.",
      "4. Gọi app_builder_node_detail cho node cần sửa/thêm nhanh.",
      "5. Gọi app_builder_prepare_change để validate và lưu pending plan nếu đã đủ thông tin.",
      "6. Chỉ apply sau khi user xác nhận."
    ],
    create_app_branch: {
      order: ["app", "service/appservice", "table", "column", "window", "tab", "field", "menu", "roleapp/rolemenu/access", "cache refresh/delete"],
      required_edges: [
        "root -> app",
        "app -> appservice -> service",
        "service -> table",
        "table -> column",
        "app -> window",
        "window -> tab",
        "tab -> table",
        "tab -> field",
        "field -> column",
        "field -> domain when domainid is used",
        "field -> linked table/column when lookup is used",
        "app -> menu",
        "menu -> window",
        "app -> roleapp <- role",
        "role -> rolemenu -> menu",
        "role -> access -> table"
      ],
      required_information: {
        app: ["appname", "seqno", "apptype", "optional description"],
        service: ["serviceid của service hiện có hoặc create service trước"],
        appservice: ["appid", "serviceid"],
        table: ["serviceid", "tablename", "alias", "tabletype"],
        column: ["tableid or table reference", "columnname", "datatype/columntype", "domainid/linktableid/linkcolumn when needed", "primary/display/search flags when needed"],
        window: ["appid", "windowname"],
        tab: ["windowid", "tableid", "tabname", "seqno"],
        field: ["tabid", "columnid or columnname", "fieldname/label", "seqno", "controltype/datatype when needed"],
        menu: ["appid", "menuname", "linkwindowid", "seqno"],
        role_access: ["roleapp for app access", "rolemenu for menu access", "access for table permissions when needed"],
        cache: ["delete n_cache rows for changed app/window after UI metadata changes"]
      },
      domain_lookup: {
        domain: ["create_domain or resolve existing domainid before using it on column"],
        field_domain_edge: "NField.columnid -> NColumn.domainid -> NDomain.domainid",
        field_lookup_edge: "NField.columnid -> NColumn.linktableid/linkcolumn -> NTable/NColumn",
        column_lookup_edge: "NColumn.linktableid/linkcolumn -> NTable/NColumn",
        tab_relation_edge: "NTab.relatetableid + relatechildfield/relateparentfield -> related table"
      },
      role_access: {
        roleapp: ["roleid", "appid", "siteid"],
        rolemenu: ["roleid", "menuid", "siteid", "optional whereclause"],
        access: ["roleid", "tableid", "siteid", "noinsert/noupdate/nodelete/noselect/noexport flags"],
        edges: ["role -> roleapp -> app", "role -> rolemenu -> menu", "role -> access -> table"]
      },
      service_binding: {
        service: ["serviceid", "servicename", "url", "servicetype"],
        appservice: ["appid", "serviceid"],
        table: ["serviceid"],
        edges: ["app -> appservice -> service", "service -> table"]
      }
    },
    edit_existing_branch: {
      order: ["search target", "subgraph around target", "node detail", "proposed patch plan"],
      rules: [
        "Không tạo trùng app/table/window/menu/field nếu graph đã có node tương ứng.",
        "Nếu user nói tên app/table/window mơ hồ, dùng search trước rồi hỏi lại nếu có nhiều kết quả.",
        "Nếu cần thêm field vào window, phải biết tab và column; nếu column chưa có thì plan cần tạo column trước field."
      ]
    },
    proposed_plan_format: {
      intent: "create_app | add_table | add_window | add_tab | add_field | update_node",
      target_node_ids: ["node id nếu sửa node hiện có"],
      operations: [
        {
          id: "create_app_1",
          op: "create_app",
          record: { appname: "...", description: "..." },
          creates_node: "app:<new>"
        },
        {
          id: "create_table_1",
          op: "create_table",
          after: "create_appservice_1",
          record: { serviceid: "$create_service_or_existing.serviceid", tablename: "...", alias: "...", tabletype: "table" }
        },
        {
          id: "create_column_1",
          op: "create_column",
          after: "create_table_1",
          record: { tableid: "$create_table_1.tableid", columnname: "...", datatype: "text" }
        }
      ],
      reference_rule: "Có thể dùng $operation_id.field để nối output của bước trước vào bước sau, ví dụ $create_app_1.appid.",
      delete_rule: "Xóa node chỉ khi user nói rõ. Dùng delete_app/delete_window cascade khi xóa app/window; cascade phải dọn field, tab, menu, cache và role/menu access trước.",
      validation: ["duplicate check", "required ids", "edge completeness", "payload fields filtered by actual App Builder metadata"]
    }
  };
}

function buildAnswerFactsFromSelection(
  context: GraphContext,
  selectedNodes: AppBuilderNode[],
  selectedEdges: AppBuilderEdge[],
  focusNodeIds: string[] = []
): AnswerFacts {
  const nodeById = new Map(selectedNodes.map(node => [node.id, node]));
  const edgeList = selectedEdges.filter(edge => nodeById.has(edge.from) && nodeById.has(edge.to));

  const tables = selectedNodes
    .filter(node => node.type === "table")
    .slice(0, 24)
    .map(node => tableFact(context, node));

  const windows = selectedNodes
    .filter(node => node.type === "window")
    .slice(0, 16)
    .map(node => windowFact(context, node));

  const menus = selectedNodes
    .filter(node => node.type === "menu")
    .slice(0, 16)
    .map(node => menuFact(context, node));

  const permissions = selectedNodes
    .filter(node => ["roleapp", "rolemenu", "access"].includes(node.type))
    .slice(0, 24)
    .map(node => permissionFact(context, node));

  const importantEdges = edgeList.filter(edge => isImportantRelation(edge.type));
  const verifiedRelations = importantEdges
    .slice(0, 80)
    .map(edge => verifiedRelationFact(context, edge))
    .filter((relation): relation is VerifiedRelationFact => Boolean(relation));

  return {
    scope: {
      node_ids: focusNodeIds.length ? focusNodeIds : selectedNodes.slice(0, 20).map(node => node.id),
      node_types: countBy(selectedNodes, node => node.type),
      source: "derived_from_app_builder_graph_nodes_and_edges"
    },
    flow_summary: buildFlowSummary(selectedNodes, edgeList),
    tables_summary: tables,
    windows_summary: windows,
    menus_summary: menus,
    permissions_summary: permissions,
    verified_relations: verifiedRelations,
    dependency_summary: buildDependencySummary(context, selectedNodes, edgeList, focusNodeIds),
    write_contract_summary: buildWriteContractSummary(selectedNodes),
    creation_readiness: buildCreationReadiness(selectedNodes, focusNodeIds),
    operation_plan_facts: buildOperationPlanFacts(selectedNodes),
    inferred_notes: buildInferredNotes(selectedNodes, edgeList),
    truncated: {
      tables_summary: selectedNodes.filter(node => node.type === "table").length > tables.length,
      windows_summary: selectedNodes.filter(node => node.type === "window").length > windows.length,
      menus_summary: selectedNodes.filter(node => node.type === "menu").length > menus.length,
      permissions_summary: selectedNodes.filter(node => ["roleapp", "rolemenu", "access"].includes(node.type)).length > permissions.length,
      verified_relations: importantEdges.length > verifiedRelations.length
    }
  };
}

function buildFlowSummary(nodes: AppBuilderNode[], edges: AppBuilderEdge[]): string[] {
  const counts = countBy(nodes, node => node.type);
  const edgeCounts = countBy(edges, edge => edge.type);
  const summary: string[] = [];

  if (counts.app) {
    summary.push(`Đã thấy ${counts.app} app trong phạm vi này; app là gốc cấu hình cho window, menu, domain, service binding và quyền app.`);
  }
  if (edgeCounts.app_has_appservice || edgeCounts.appservice_links_service || edgeCounts.service_has_table) {
    summary.push("Luồng dữ liệu đã thấy: app -> n_appservice -> n_service -> n_table; table thuộc service, app dùng table thông qua service binding.");
  } else if (counts.table) {
    summary.push("Đã thấy table metadata trong phạm vi này; nếu cần xác minh table thuộc service/app nào, hãy mở rộng subgraph quanh table hoặc app.");
  }
  if (edgeCounts.app_has_window || edgeCounts.window_has_tab || edgeCounts.tab_uses_table || edgeCounts.tab_has_field || edgeCounts.field_maps_column) {
    summary.push("Luồng giao diện đã thấy: app -> n_window -> n_tab -> n_field; tab gắn với n_table và field map về n_column.");
  }
  if (edgeCounts.app_has_menu || edgeCounts.menu_links_window) {
    summary.push("Luồng điều hướng đã thấy: app -> n_menu; menu có thể mở window qua linkwindowid/windowid khi có cạnh menu_links_window.");
  }
  if (edgeCounts.column_uses_domain || edgeCounts.field_uses_domain) {
    summary.push("Đã thấy domain/list giá trị được gắn qua domainid trên column hoặc field.");
  }
  if (edgeCounts.column_links_table || edgeCounts.field_links_table || edgeCounts.column_links_column || edgeCounts.field_links_column) {
    summary.push("Đã thấy lookup/link qua linktableid/linkcolumn hoặc mapcolumn giữa field/column và table/column đích.");
  }
  if (edgeCounts.role_grants_app || edgeCounts.role_has_rolemenu || edgeCounts.rolemenu_grants_menu || edgeCounts.role_has_table_access || edgeCounts.access_controls_table) {
    summary.push("Luồng quyền đã thấy: role -> roleapp -> app, role -> rolemenu -> menu, và role -> access -> table.");
  }

  if (!summary.length) {
    summary.push("Phạm vi này có node/edge metadata nhưng chưa đủ cạnh để mô tả một flow hoàn chỉnh; cần mở subgraph sâu hơn hoặc node_detail của node liên quan.");
  }

  return summary;
}

function tableFact(context: GraphContext, node: AppBuilderNode): Record<string, unknown> {
  const source = context.sourceByNodeId.get(node.id);
  const record = source?.record ?? {};
  const serviceEdges = context.edges.filter(edge => edge.to === node.id && edge.type === "service_has_table");
  const tabEdges = context.edges.filter(edge => edge.to === node.id && ["tab_uses_table", "tab_uses_relation_table"].includes(edge.type));
  const accessEdges = context.edges.filter(edge => edge.to === node.id && edge.type === "access_controls_table");
  const columnEdges = context.edges.filter(edge => edge.from === node.id && edge.type === "table_has_column");

  return compactUndefined({
    node_id: node.id,
    tableid: ci(record, "tableid") ?? node.summary?.tableid,
    tablename: ci(record, "tablename") ?? node.summary?.tablename,
    alias: ci(record, "alias") ?? node.label,
    tabletype: ci(record, "tabletype") ?? node.summary?.tabletype,
    serviceid: ci(record, "serviceid") ?? node.summary?.serviceid,
    isreadonly: ci(record, "isreadonly") ?? node.summary?.isreadonly,
    isview: ci(record, "isview") ?? node.summary?.isview,
    columns_count: node.counts?.columns ?? columnEdges.length,
    services: serviceEdges.map(edge => compactNodeRef(context.nodeById.get(edge.from))).filter(Boolean),
    used_by_tabs: tabEdges.slice(0, 12).map(edge => {
      const tab = context.nodeById.get(edge.from);
      return compactUndefined({
        tab: compactNodeRef(tab),
        relation_type: edge.type,
        window: tab ? compactNodeRef(findConnectedNode(context, tab.id, "in", "window_has_tab")) : undefined
      });
    }),
    permission_records_count: accessEdges.length
  });
}

function windowFact(context: GraphContext, node: AppBuilderNode): Record<string, unknown> {
  const source = context.sourceByNodeId.get(node.id);
  const record = source?.record ?? {};
  const app = findConnectedNode(context, node.id, "in", "app_has_window");
  const tabEdges = context.edges.filter(edge => edge.from === node.id && edge.type === "window_has_tab");
  const menuEdges = context.edges.filter(edge => edge.to === node.id && edge.type === "menu_links_window");
  const cacheEdges = context.edges.filter(edge => edge.to === node.id && edge.type === "cache_for_window");

  return compactUndefined({
    node_id: node.id,
    windowid: ci(record, "windowid") ?? node.summary?.windowid,
    windowname: ci(record, "windowname") ?? node.label,
    windowtype: ci(record, "windowtype") ?? node.summary?.windowtype,
    app: compactNodeRef(app),
    tabs_count: node.counts?.tabs ?? tabEdges.length,
    tabs: tabEdges.slice(0, 12).map(edge => {
      const tab = context.nodeById.get(edge.to);
      return compactUndefined({
        tab: compactNodeRef(tab),
        table: tab ? compactNodeRef(findConnectedNode(context, tab.id, "out", "tab_uses_table")) : undefined,
        relation_table: tab ? compactNodeRef(findConnectedNode(context, tab.id, "out", "tab_uses_relation_table")) : undefined
      });
    }),
    linked_menus: menuEdges.map(edge => compactNodeRef(context.nodeById.get(edge.from))).filter(Boolean),
    cache_records_count: cacheEdges.length
  });
}

function menuFact(context: GraphContext, node: AppBuilderNode): Record<string, unknown> {
  const source = context.sourceByNodeId.get(node.id);
  const record = source?.record ?? {};
  const app = findConnectedNode(context, node.id, "in", "app_has_menu");
  const linkedWindow = findConnectedNode(context, node.id, "out", "menu_links_window");
  const roleMenuEdges = context.edges.filter(edge => edge.to === node.id && edge.type === "rolemenu_grants_menu");

  return compactUndefined({
    node_id: node.id,
    menuid: ci(record, "menuid") ?? node.summary?.menuid,
    menuname: ci(record, "menuname") ?? node.label,
    menutype: ci(record, "menutype") ?? node.summary?.menutype,
    parentid: ci(record, "parentid") ?? node.summary?.parentid,
    seqno: ci(record, "seqno") ?? node.summary?.seqno,
    app: compactNodeRef(app),
    linkwindowid: ci(record, "linkwindowid") ?? ci(record, "windowid") ?? node.summary?.linkwindowid ?? node.summary?.windowid,
    linked_window: compactNodeRef(linkedWindow),
    permission_records_count: roleMenuEdges.length
  });
}

function permissionFact(context: GraphContext, node: AppBuilderNode): Record<string, unknown> {
  const source = context.sourceByNodeId.get(node.id);
  const record = source?.record ?? {};

  if (node.type === "roleapp") {
    return compactUndefined({
      type: "roleapp",
      node_id: node.id,
      role: compactNodeRef(findConnectedNode(context, node.id, "in", "role_grants_app")),
      app: compactNodeRef(findConnectedNode(context, node.id, "in", "app_has_roleapp")),
      roleid: ci(record, "roleid") ?? node.summary?.roleid,
      appid: ci(record, "appid") ?? node.summary?.appid,
      note: "Metadata cấp quyền role vào app; không chứng minh tần suất sử dụng thực tế."
    });
  }

  if (node.type === "rolemenu") {
    return compactUndefined({
      type: "rolemenu",
      node_id: node.id,
      role: compactNodeRef(findConnectedNode(context, node.id, "in", "role_has_rolemenu")),
      menu: compactNodeRef(findConnectedNode(context, node.id, "out", "rolemenu_grants_menu")),
      roleid: ci(record, "roleid") ?? node.summary?.roleid,
      menuid: ci(record, "menuid") ?? node.summary?.menuid,
      whereclause: ci(record, "whereclause") ?? node.summary?.whereclause,
      note: "Metadata cấp quyền role vào menu; whereclause nếu có là điều kiện lọc quyền/menu."
    });
  }

  return compactUndefined({
    type: "access",
    node_id: node.id,
    role: compactNodeRef(findConnectedNode(context, node.id, "in", "role_has_table_access")),
    table: compactNodeRef(findConnectedNode(context, node.id, "out", "access_controls_table")),
    roleid: ci(record, "roleid") ?? node.summary?.roleid,
    tableid: ci(record, "tableid") ?? node.summary?.tableid,
    flags: compactRecord(record, ["isarchive", "noinsert", "noupdate", "nodelete", "noselect", "noexport", "noattach", "islock"]),
    note: "Metadata quyền trên table; các cờ no* là hạn chế thao tác, không phải log hành vi người dùng."
  });
}

function verifiedRelationFact(context: GraphContext, edge: AppBuilderEdge): VerifiedRelationFact | undefined {
  const from = context.nodeById.get(edge.from);
  const to = context.nodeById.get(edge.to);
  if (!from || !to) return undefined;
  return {
    type: edge.type,
    from: { id: from.id, type: from.type, label: from.label },
    to: { id: to.id, type: to.type, label: to.label },
    metadata: edge.metadata
  };
}

function buildInferredNotes(nodes: AppBuilderNode[], edges: AppBuilderEdge[]): string[] {
  const notes: string[] = [
    "Các mục trong verified_relations là quan hệ đã thấy trực tiếp trong graph/tool result; các ghi chú ở đây là suy luận hoặc khuyến nghị diễn giải.",
    "Permission metadata chỉ cho biết role/menu/table access được cấu hình, không chứng minh người dùng đã sử dụng chức năng đó."
  ];
  const edgeCounts = countBy(edges, edge => edge.type);
  const nodeCounts = countBy(nodes, node => node.type);

  if (nodeCounts.table && !edgeCounts.service_has_table) {
    notes.push("Có table trong phạm vi này nhưng chưa thấy cạnh service_has_table; cần mở rộng subgraph nếu muốn xác minh service binding.");
  }
  if (nodeCounts.menu && !edgeCounts.menu_links_window) {
    notes.push("Có menu trong phạm vi này nhưng không phải menu nào cũng link trực tiếp tới window; menu có thể là nhóm, tool, report hoặc cần kiểm tra menutype/execname.");
  }
  if (nodeCounts.window && !edgeCounts.menu_links_window) {
    notes.push("Có window trong phạm vi này nhưng chưa thấy menu trỏ tới window; window có thể tồn tại trong App Builder mà chưa được đưa vào navigation.");
  }
  if (edgeCounts.app_has_table && !edgeCounts.appservice_links_service) {
    notes.push("Cạnh app_has_table trong graph là tiện ích để gom bảng theo app; theo metadata Zilcode, binding đúng nên được xác minh qua n_appservice/n_service/n_table.");
  }

  return notes;
}

function isImportantRelation(type: string): boolean {
  return [
    "manages_app",
    "app_uses_service",
    "app_has_appservice",
    "appservice_links_service",
    "service_has_table",
    "app_has_table",
    "table_has_column",
    "app_has_window",
    "window_has_tab",
    "tab_parent_child",
    "tab_uses_table",
    "tab_uses_relation_table",
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
    "app_has_domain",
    "app_has_cache",
    "cache_for_window",
    "app_has_roleapp",
    "role_grants_app",
    "role_has_rolemenu",
    "rolemenu_grants_menu",
    "role_has_table_access",
    "access_controls_table"
  ].includes(type);
}

function findConnectedNode(
  context: GraphContext,
  nodeId: string,
  direction: "in" | "out",
  edgeType: string
): AppBuilderNode | undefined {
  const edge = context.edges.find(item => {
    if (item.type !== edgeType) return false;
    return direction === "in" ? item.to === nodeId : item.from === nodeId;
  });
  if (!edge) return undefined;
  return context.nodeById.get(direction === "in" ? edge.from : edge.to);
}

function compactNodeRef(node: AppBuilderNode | undefined): Record<string, unknown> | undefined {
  if (!node) return undefined;
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    summary: compactRecord(node.summary ?? {}, ["appid", "tableid", "windowid", "tabid", "fieldid", "columnid", "menuid", "roleid", "serviceid"])
  };
}

function compactUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    if (value === undefined) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value as Record<string, unknown>).length) return false;
    return true;
  }));
}

function buildDependencySummary(
  context: GraphContext,
  selectedNodes: AppBuilderNode[],
  selectedEdges: AppBuilderEdge[],
  focusNodeIds: string[]
): Record<string, unknown> {
  const selected = new Set(selectedNodes.map(node => node.id));
  const focus = (focusNodeIds.length ? focusNodeIds : selectedNodes.slice(0, 8).map(node => node.id))
    .map(id => context.nodeById.get(id))
    .filter((node): node is AppBuilderNode => Boolean(node));

  const focusSummaries = focus.map(node => {
    const inbound = context.edges.filter(edge => edge.to === node.id);
    const outbound = context.edges.filter(edge => edge.from === node.id);
    const dependents = inbound
      .filter(edge => isDependencyEdge(edge.type))
      .slice(0, 24)
      .map(edge => compactUndefined({
        relation: edge.type,
        node: compactNodeRef(context.nodeById.get(edge.from)),
        in_current_scope: selected.has(edge.from)
      }));
    const dependencies = outbound
      .filter(edge => isDependencyEdge(edge.type))
      .slice(0, 24)
      .map(edge => compactUndefined({
        relation: edge.type,
        node: compactNodeRef(context.nodeById.get(edge.to)),
        in_current_scope: selected.has(edge.to)
      }));

    return compactUndefined({
      node: compactNodeRef(node),
      dependencies,
      dependents,
      delete_order: deleteOrderForNodeType(node.type),
      delete_cascade_supported: Boolean(WRITE_ENTITY_CONTRACTS[node.type]?.delete_cascade_supported),
      shared_usage: sharedUsageForNode(context, node),
      update_impact: updateImpactForNodeType(node.type)
    });
  });

  return {
    source: "derived_from_graph_edges",
    focused_nodes: focusSummaries,
    scope_dependency_counts: {
      dependencies_edges_in_scope: selectedEdges.filter(edge => isDependencyEdge(edge.type)).length,
      nodes_with_external_dependents: selectedNodes.filter(node =>
        context.edges.some(edge => edge.to === node.id && !selected.has(edge.from) && isDependencyEdge(edge.type))
      ).length
    },
    delete_safety_rules: [
      "Không xóa table/column/window/app nếu chưa xem dependency_summary hoặc cascade plan.",
      "delete_window cascade chỉ xóa UI metadata/cache/menu/rolemenu/window, không xóa table/column/dữ liệu thật.",
      "delete_table cascade chỉ xóa metadata liên quan trong App Builder, không drop bảng vật lý hay dữ liệu business.",
      "Nếu shared_usage cho thấy table/column/menu đang được dùng ở nhiều nơi, cần xác nhận rõ trước khi delete."
    ]
  };
}

function buildWriteContractSummary(selectedNodes: AppBuilderNode[]): Record<string, unknown> {
  const typesInScope = [...new Set(selectedNodes.map(node => node.type))]
    .filter(type => WRITE_ENTITY_CONTRACTS[type]);
  const priorityTypes = typesInScope.length
    ? typesInScope
    : ["app", "table", "column", "window", "tab", "field", "menu"];

  return {
    source: "static_contract_from_app_builder_write_prepare_change",
    note: "Các contract này phản ánh logic prepare_change hiện tại: lọc payload theo metadata thật, materialize default, validate required fields, rồi apply sau xác nhận.",
    contracts: Object.fromEntries(priorityTypes.map(type => [type, WRITE_ENTITY_CONTRACTS[type]])),
    always_filtered_by_metadata: true,
    apply_requires_confirmation: true,
    unsupported_without_prepare_change: "Không gọi API ghi trực tiếp từ agent final answer; phải tạo pending plan qua app_builder_prepare_change rồi app_builder_apply_change sau xác nhận."
  };
}

function buildCreationReadiness(selectedNodes: AppBuilderNode[], focusNodeIds: string[]): Record<string, unknown> {
  const nodeTypes = [...new Set(selectedNodes.map(node => node.type))];
  const writableTypes = nodeTypes.filter(type => WRITE_ENTITY_CONTRACTS[type]);
  const focusedExistingTargets = selectedNodes
    .filter(node => focusNodeIds.includes(node.id) && WRITE_ENTITY_CONTRACTS[node.type])
    .map(node => compactUndefined({
      node: compactNodeRef(node),
      update_can_prepare: true,
      delete_can_prepare: true,
      delete_cascade_supported: Boolean(WRITE_ENTITY_CONTRACTS[node.type]?.delete_cascade_supported)
    }));

  const requiredInputs = Object.fromEntries(
    (writableTypes.length ? writableTypes : ["app", "table", "column", "window", "tab", "field", "menu"])
      .map(type => [type, {
        required_fields: WRITE_ENTITY_CONTRACTS[type]?.create_required_fields ?? [],
        defaults_or_resolvable: WRITE_ENTITY_CONTRACTS[type]?.defaults_or_resolvable ?? {}
      }])
  );

  return {
    source: "derived_from_scope_plus_write_contract",
    can_prepare_create_when: "Có đủ required fields hoặc có thể resolve/default theo write_contract_summary.",
    can_prepare_update_when: "Có target id/node_id/id_value và có field update hợp lệ sau khi lọc metadata.",
    can_prepare_delete_when: "Có target id/node_id/id_value; cascade chỉ dùng khi entity được hỗ trợ và user yêu cầu/xác nhận rõ.",
    can_apply_after_confirmation: true,
    requires_user_confirmation_before_apply: true,
    focused_existing_targets: focusedExistingTargets,
    create_required_inputs_by_entity: requiredInputs,
    blocking_conditions: [
      "Thiếu target id cho update/delete.",
      "Thiếu required field không tự resolve/default được khi create.",
      "Tên app/table/window mơ hồ và graph_search không có top match rõ.",
      "Update không còn field hợp lệ sau khi lọc metadata.",
      "Delete có shared_usage/rủi ro cao nhưng user chưa xác nhận phạm vi cascade."
    ],
    recommended_agent_decision: "Nếu thiếu thông tin trong blocking_conditions thì hỏi lại; nếu đủ thì gọi app_builder_prepare_change, không tự apply."
  };
}

function buildOperationPlanFacts(selectedNodes: AppBuilderNode[]): Record<string, unknown> {
  const types = new Set(selectedNodes.map(node => node.type));
  const commonSequences: Record<string, unknown> = {
    create_app_full: [
      "create_app",
      "create_or_bind_service/appservice",
      "create_table",
      "create_column",
      "create_window",
      "create_tab",
      "create_field",
      "create_menu",
      "create_roleapp/rolemenu/access if user wants permissions",
      "clear_cache_or_verify_cache"
    ],
    add_table_to_existing_app: [
      "resolve app",
      "resolve/create service binding",
      "create_table",
      "create_column",
      "optional create_window/tab/field/menu",
      "optional grant access",
      "verify graph"
    ],
    add_field_to_existing_window: [
      "resolve window",
      "resolve tab",
      "resolve or create column on tab table",
      "create_field mapped to column",
      "delete/refresh n_cache for window/app",
      "verify field_maps_column"
    ],
    update_metadata: [
      "resolve node",
      "load node_detail/subgraph",
      "prepare update with allowed fields only",
      "apply after confirmation",
      "verify node_detail and cache impact"
    ],
    delete_window_cascade: ["delete_cache", "delete_field", "delete_tab", "delete_rolemenu", "delete_menu", "delete_window"],
    delete_table_cascade: ["delete_field", "delete_tab", "delete_access", "delete_archive", "delete_column", "delete_table"],
    delete_app_cascade: ["delete_cache", "delete_field", "delete_tab", "delete_rolemenu", "delete_menu", "delete_roleapp", "delete_appservice", "delete_domain", "delete_window", "delete_app"]
  };

  return {
    source: "static_plan_templates_aligned_with_app_builder_write",
    relevant_to_scope: {
      has_app: types.has("app"),
      has_table: types.has("table"),
      has_window: types.has("window"),
      has_tab_or_field: types.has("tab") || types.has("field"),
      has_menu: types.has("menu"),
      has_permissions: ["roleapp", "rolemenu", "access"].some(type => types.has(type))
    },
    operation_sequences: commonSequences,
    reference_bindings: [
      "$create_app.appid -> create_window.appid/create_menu.appid/create_roleapp.appid/create_appservice.appid",
      "$create_appservice.serviceid or existing serviceid -> create_table.serviceid",
      "$create_table.tableid -> create_column.tableid/create_tab.tableid/create_access.tableid",
      "$create_column.columnid -> create_field.columnid",
      "$create_window.windowid -> create_tab.windowid/create_menu.linkwindowid",
      "$create_tab.tabid -> create_field.tabid",
      "$create_menu.menuid -> create_rolemenu.menuid"
    ],
    validation_rules: [
      "Resolve existing node before create to avoid duplicates.",
      "Use dependency_summary before delete/update destructive fields.",
      "Payload must be filtered by actual metadata columns before prepare result is considered valid.",
      "app_builder_apply_change only after explicit user confirmation with a valid plan_id."
    ],
    post_apply_verification: [
      "invalidate graph cache",
      "graph_search target by id/name",
      "node_detail target",
      "verify expected verified_relations exist",
      "for UI changes, verify/delete n_cache impact if applicable"
    ]
  };
}

function isDependencyEdge(type: string): boolean {
  return [
    "app_uses_service",
    "app_has_appservice",
    "appservice_links_service",
    "service_has_table",
    "app_has_table",
    "table_has_column",
    "app_has_window",
    "window_has_tab",
    "tab_parent_child",
    "tab_uses_table",
    "tab_uses_relation_table",
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
    "app_has_domain",
    "app_has_cache",
    "cache_for_window",
    "app_has_roleapp",
    "role_grants_app",
    "role_has_rolemenu",
    "rolemenu_grants_menu",
    "role_has_table_access",
    "access_controls_table"
  ].includes(type);
}

function deleteOrderForNodeType(type: string): string[] | undefined {
  const orders: Record<string, string[]> = {
    app: ["cache", "field", "tab", "rolemenu", "menu", "roleapp", "appservice", "domain", "window", "app"],
    window: ["cache", "field", "tab", "rolemenu", "menu", "window"],
    tab: ["field", "tab"],
    table: ["field", "tab", "access", "archive", "column", "table"],
    column: ["field", "column"],
    menu: ["rolemenu", "menu"],
    role: ["roleapp", "rolemenu", "access", "role if explicitly supported"]
  };
  return orders[type];
}

function updateImpactForNodeType(type: string): string[] {
  const impacts: Record<string, string[]> = {
    app: ["Có thể ảnh hưởng menu/window/domain/service binding/roleapp thuộc app.", "Đổi app metadata không tự đổi table vật lý."],
    table: ["Có thể ảnh hưởng tab dùng table, access permission, column/field mapping.", "Không đồng nghĩa đổi schema vật lý nếu chỉ sửa n_table metadata."],
    column: ["Có thể ảnh hưởng field_maps_column, lookup/domain, và UI field hiển thị.", "Cần kiểm tra field đang map column trước khi xóa/đổi kiểu."],
    window: ["Có thể ảnh hưởng tab/field/menu/cache của window.", "Sau đổi window/tab/field thường cần refresh hoặc xóa n_cache."],
    tab: ["Có thể ảnh hưởng field trong tab và quan hệ parent/child tab.", "Đổi tableid của tab ảnh hưởng field-column mapping."],
    field: ["Ảnh hưởng UI hiển thị/nhập liệu, domain/lookup, validation và readonly/required behavior."],
    menu: ["Ảnh hưởng navigation và rolemenu permissions.", "Nếu menu link window, đổi linkwindowid sẽ đổi nơi điều hướng."],
    roleapp: ["Ảnh hưởng quyền role vào app."],
    rolemenu: ["Ảnh hưởng quyền role vào menu/navigation."],
    access: ["Ảnh hưởng quyền thao tác trên table qua các cờ noinsert/noupdate/nodelete/noselect/noexport."]
  };
  return impacts[type] ?? ["Cần xem verified_relations/dependency_summary trước khi update để đánh giá ảnh hưởng."];
}

function sharedUsageForNode(context: GraphContext, node: AppBuilderNode): Record<string, unknown> | undefined {
  if (node.type === "table") {
    const tabs = context.edges.filter(edge => edge.to === node.id && ["tab_uses_table", "tab_uses_relation_table"].includes(edge.type));
    const accesses = context.edges.filter(edge => edge.to === node.id && edge.type === "access_controls_table");
    return {
      used_by_tabs_count: tabs.length,
      access_records_count: accesses.length,
      safe_to_delete_without_user_confirmation: false
    };
  }
  if (node.type === "column") {
    const fields = context.edges.filter(edge => edge.to === node.id && edge.type === "field_maps_column");
    return {
      mapped_fields_count: fields.length,
      safe_to_delete_without_user_confirmation: false
    };
  }
  if (node.type === "window") {
    const menus = context.edges.filter(edge => edge.to === node.id && edge.type === "menu_links_window");
    const caches = context.edges.filter(edge => edge.to === node.id && edge.type === "cache_for_window");
    return {
      linked_menus_count: menus.length,
      cache_records_count: caches.length,
      safe_to_delete_without_user_confirmation: false
    };
  }
  if (node.type === "menu") {
    const rolemenus = context.edges.filter(edge => edge.to === node.id && edge.type === "rolemenu_grants_menu");
    return {
      rolemenu_records_count: rolemenus.length,
      safe_to_delete_without_user_confirmation: false
    };
  }
  return undefined;
}

function buildNodeDetail(context: GraphContext, nodeId: string, includeFields: boolean): Record<string, unknown> {
  const source = context.sourceByNodeId.get(nodeId);
  if (!source) return { error: "Node không có source detail." };

  switch (source.type) {
    case "app": {
      const services = toRecords(source.record.services);
      const tables = toRecords(source.record.tables);
      const windows = toRecords(source.record.windows);
      const menus = toRecords(source.record.menus);
      const domains = toRecords(source.record.domains);
      const caches = toRecords(source.record.caches);
      const roleapps = toRecords(source.record.roleapps);
      const rolemenus = toRecords(source.record.rolemenus);
      const accesses = toRecords(source.record.accesses);
      return {
        record: stripChildren(source.record),
        counts: {
          services: services.length,
          tables: tables.length,
          windows: windows.length,
          menus: menus.length,
          domains: domains.length,
          caches: caches.length,
          roleapps: roleapps.length,
          rolemenus: rolemenus.length,
          accesses: accesses.length
        },
        services: services.map(service => compactRecord(service, ["serviceid", "servicename", "url", "servicetype", "siteid"])),
        tables: tables.map(table => ({
          ...compactRecord(table, ["tableid", "tablename", "alias", "tabletype", "serviceid", "description"]),
          columns_count: toRecords(table.columns).length,
          access_count: Number(ci(table, "access_count") ?? 0),
          archive_count: Number(ci(table, "archive_count") ?? 0)
        })),
        windows: windows.map(windowRecord => ({
          ...compactRecord(windowRecord, ["windowid", "windowname", "windowtype", "execname"]),
          tabs_count: toRecords(windowRecord.tabs).length
        })),
        menus: menus.map(menu => compactRecord(menu, ["menuid", "menuname", "translate", "linkwindowid", "parentid", "seqno"])),
        domains: domains.map(domain => compactRecord(domain, ["domainid", "domainname", "domaintype", "appid", "domain_values_count"])),
        caches: caches.map(cache => compactRecord(cache, ["cacheid", "appid", "windowid", "siteid"])),
        roleapps: roleapps.map(roleapp => compactRecord(roleapp, ["roleappid", "roleid", "appid", "siteid"])),
        rolemenus: rolemenus.map(rolemenu => compactRecord(rolemenu, ["rolemenuid", "roleid", "menuid", "siteid"])),
        accesses: accesses.map(access => compactRecord(access, ["accessid", "roleid", "tableid", "noinsert", "noupdate", "nodelete", "noselect", "siteid"]))
      };
    }
    case "table": {
      const columns = toRecords(source.record.columns);
      return {
        record: stripChildren(source.record),
        columns_count: columns.length,
        columns: columns.map(column => compactRecord(column, [
          "columnid", "columnname", "tablename", "tableid", "columntype", "datatype",
          "length", "isprimarykey", "isrequire", "isreadonly", "domainid", "linktableid",
          "linkcolumn", "mapcolumn", "seqno", "description"
        ]))
      };
    }
    case "window": {
      const tabs = toRecords(source.record.tabs);
      return {
        record: stripChildren(source.record),
        tabs_count: tabs.length,
        tabs: tabs.map(tab => {
          const fields = toRecords(tab.fields);
          return {
            ...compactRecord(tab, [
              "tabid", "tabname", "parenttabid", "tableid", "linktableid",
              "linkchildfield", "linkparentfield", "seqno", "isviewonly"
            ]),
            fields_count: fields.length,
            fields: includeFields ? fields.map(field => compactRecord(field, [
              "fieldid", "fieldname", "columnname", "tabid", "columnid",
              "domainid", "fieldtype", "controltype", "seqno", "isreadonly", "isrequire"
            ])) : undefined
          };
        })
      };
    }
    case "tab": {
      const fields = toRecords(source.record.fields);
      return {
        record: stripChildren(source.record),
        fields_count: fields.length,
        fields: includeFields ? fields.map(field => compactRecord(field, [
          "fieldid", "fieldname", "columnname", "tabid", "columnid",
          "domainid", "fieldtype", "controltype", "seqno", "isreadonly", "isrequire"
        ])) : undefined
      };
    }
    case "root":
    case "column":
    case "field":
    case "menu":
    case "domain":
    case "service":
    case "appservice":
    case "cache":
    case "role":
    case "roleapp":
    case "rolemenu":
    case "access":
    default:
      return { record: stripChildren(source.record) };
  }
}

function buildNeighborSummary(context: GraphContext, nodeId: string): Record<string, unknown> {
  const inbound = context.edges
    .filter(edge => edge.to === nodeId)
    .map(edge => ({
      edge,
      node: context.nodeById.get(edge.from)
    }))
    .filter(item => item.node);

  const outbound = context.edges
    .filter(edge => edge.from === nodeId)
    .map(edge => ({
      edge,
      node: context.nodeById.get(edge.to)
    }))
    .filter(item => item.node);

  return {
    inbound: inbound.map(item => ({ type: item.edge.type, node: item.node })),
    outbound: outbound.map(item => ({ type: item.edge.type, node: item.node }))
  };
}

function filterNeighborhood(
  context: GraphContext,
  startIds: string[],
  depth: number,
  maxNodes: number
): { nodes: AppBuilderNode[]; edges: AppBuilderEdge[] } {
  const selected = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const id of startIds) {
    if (context.nodeById.has(id)) {
      selected.add(id);
      queue.push({ id, depth: 0 });
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (item.depth >= depth || selected.size >= maxNodes) continue;

    const connected = context.edges.filter(edge => edge.from === item.id || edge.to === item.id);
    for (const edge of connected) {
      const next = edge.from === item.id ? edge.to : edge.from;
      if (!selected.has(next) && context.nodeById.has(next)) {
        selected.add(next);
        queue.push({ id: next, depth: item.depth + 1 });
        if (selected.size >= maxNodes) break;
      }
    }
  }

  return {
    nodes: [...selected].map(id => context.nodeById.get(id)).filter((node): node is AppBuilderNode => Boolean(node)),
    edges: context.edges.filter(edge => selected.has(edge.from) && selected.has(edge.to))
  };
}

function summarizeGraph(nodes: AppBuilderNode[], edges: AppBuilderEdge[]): Record<string, unknown> {
  return {
    node_counts: countBy(nodes, node => node.type),
    edge_counts: countBy(edges, edge => edge.type),
    nodes_count: nodes.length,
    edges_count: edges.length,
    nodes,
    edges
  };
}

function graphCounts(nodes: AppBuilderNode[], edges: AppBuilderEdge[]): Record<string, unknown> {
  return {
    node_counts: countBy(nodes, node => node.type),
    edge_counts: countBy(edges, edge => edge.type),
    nodes_count: nodes.length,
    edges_count: edges.length
  };
}

function searchNodeIds(context: GraphContext, query: string, limit: number): string[] {
  return searchNodeMatches(context, query, limit).map(match => match.id);
}

function searchNodeMatches(context: GraphContext, query: string, limit: number): Array<AppBuilderNode & { score: number }> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return context.nodes
    .map(node => ({ node, score: scoreNode(node, normalizedQuery) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => ({ ...item.node, score: item.score }));
}

function resolveNodeIdCandidates(context: GraphContext, rawNodeId: string, limit: number): Array<AppBuilderNode & { score: number }> {
  const direct = context.nodeById.get(rawNodeId);
  if (direct) return [{ ...direct, score: 100 }];

  const [prefix, ...rest] = rawNodeId.split(":");
  const query = rest.length ? rest.join(":") : rawNodeId;
  const type = rest.length ? prefix : "";
  const candidates = searchNodeMatches(context, query, limit);
  return type
    ? candidates.filter(candidate => candidate.type === type)
    : candidates;
}

function scoreNode(node: AppBuilderNode, normalizedQuery: string): number {
  const id = normalizeSearchText(node.id);
  const label = normalizeSearchText(node.label);
  const text = normalizeSearchText(searchableNodeText(node));

  if (!normalizedQuery) return 0;
  if (id === normalizedQuery || label === normalizedQuery) return 100;
  if (id.includes(normalizedQuery)) return 80;
  if (label.includes(normalizedQuery)) return 70;
  if (text.includes(normalizedQuery)) return 45;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const matchedTerms = terms.filter(term => text.includes(term)).length;
  return matchedTerms ? 20 + matchedTerms * 5 : 0;
}

function searchableNodeText(node: AppBuilderNode): string {
  return [
    node.id,
    node.type,
    node.label,
    JSON.stringify(node.summary ?? {}),
    JSON.stringify(node.counts ?? {})
  ].join(" ");
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function graphContextCachePrefix(session: ZilcodeSession): string {
  return [
    "app_builder_graph",
    session.base_url ?? "",
    session.roleid ?? "",
    session.orgid ?? "",
    hashString(String(session.token ?? ""))
  ].join("|");
}

function graphContextCacheKey(session: ZilcodeSession, args: Record<string, unknown>): string {
  return [
    graphContextCachePrefix(session),
    getStringArg(args, "app_builder_appid") || getStringArg(args, "appid") || "1",
    getNumberArg(args, "max_records_per_table", 500, 1, 5000),
    getNumberArg(args, "max_windows_per_app", 50, 1, 300)
  ].join("|");
}

function mergeRecordsById(
  primary: Record<string, unknown>[],
  secondary: Record<string, unknown>[],
  keys: string[]
): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  const indexByKey = new Map<string, number>();
  const remember = (record: Record<string, unknown>, index: number): void => {
    for (const key of keys) {
      const value = stringValue(ci(record, key));
      if (value) indexByKey.set(`${key}:${normalizeKey(value)}`, index);
    }
  };

  for (const record of primary) {
    merged.push({ ...record });
    remember(record, merged.length - 1);
  }

  for (const record of secondary) {
    let existingIndex: number | undefined;
    for (const key of keys) {
      const value = stringValue(ci(record, key));
      if (!value) continue;
      existingIndex = indexByKey.get(`${key}:${normalizeKey(value)}`);
      if (existingIndex !== undefined) break;
    }
    if (existingIndex === undefined) {
      merged.push({ ...record });
      remember(record, merged.length - 1);
    } else {
      merged[existingIndex] = { ...merged[existingIndex], ...record };
      remember(merged[existingIndex], existingIndex);
    }
  }

  return merged;
}

function resolveTableNode(
  record: Record<string, unknown>,
  appid: string,
  tableById: Map<string, string>,
  tableByAppAndName: Map<string, string>
): string | undefined {
  const tableid = stringValue(ci(record, "tableid") ?? ci(record, "linktableid"));
  if (tableid && tableById.has(tableid)) return tableById.get(tableid);

  const tablename = stringValue(ci(record, "tablename"));
  if (tablename) return tableByAppAndName.get(`${appid}:${normalizeKey(tablename)}`);

  return undefined;
}

function resolveRelateTableNode(
  record: Record<string, unknown>,
  appid: string,
  tableById: Map<string, string>,
  tableByAppAndName: Map<string, string>
): string | undefined {
  const tableid = stringValue(ci(record, "relatetableid"));
  if (tableid && tableById.has(tableid)) return tableById.get(tableid);

  const tablename = stringValue(ci(record, "relatetablename"));
  if (tablename) return tableByAppAndName.get(`${appid}:${normalizeKey(tablename)}`);

  return undefined;
}

function resolveColumnNode(
  field: Record<string, unknown>,
  tableNodeId: string | undefined,
  columnById: Map<string, string>,
  columnByTableAndName: Map<string, string>
): string | undefined {
  const columnid = stringValue(ci(field, "columnid"));
  if (columnid && columnById.has(columnid)) return columnById.get(columnid);

  const columnName = stringValue(ci(field, "columnname") ?? ci(field, "fieldname"));
  if (tableNodeId && columnName) {
    return columnByTableAndName.get(`${tableNodeId}:${normalizeKey(columnName)}`);
  }

  return undefined;
}

function collectErrors(blueprint: Record<string, unknown>): Record<string, unknown> {
  const appErrors = Array.isArray(blueprint.errors) ? blueprint.errors : [];
  const recordErrors = Array.isArray(asRecord(blueprint.app_builder_records)?.errors)
    ? asRecord(blueprint.app_builder_records)?.errors
    : [];

  return {
    app_errors_count: appErrors.length,
    app_errors: appErrors.map(error => truncateDebugText(error)),
    record_errors_count: Array.isArray(recordErrors) ? recordErrors.length : 0,
    record_errors: Array.isArray(recordErrors) ? recordErrors : []
  };
}

function getNodeIds(args: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const key of ["node_id", "node_ids", "id", "ids"]) {
    const value = args[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) ids.add(item.trim());
      }
    } else if (typeof value === "string") {
      for (const part of value.split(",")) {
        if (part.trim()) ids.add(part.trim());
      }
    }
  }
  return [...ids];
}

function parseListArg(args: Record<string, unknown>, name: string): string[] {
  const value = args[name];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(item => item.trim()).filter(Boolean);
  return [];
}

function getBooleanArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const value = args[name];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function toRecords(value: unknown): Record<string, unknown>[] {
  return toArrayValues(value)
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object" && !Array.isArray(record));
}

function ci(record: Record<string, unknown>, key: string): unknown {
  return getCaseInsensitiveValue(record, key);
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function idPart(value: unknown): string {
  const text = stringValue(value);
  return (text || "unknown").replace(/\s+/g, "_").replace(/[:/\\]+/g, "_");
}

function normalizeKey(value: unknown): string {
  return stringValue(value).toLowerCase();
}

function fallbackId(record: Record<string, unknown>, prefix: string): string {
  return `${prefix}_${Math.abs(hashString(JSON.stringify(stripChildren(record))))}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function labelOf(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = ci(record, key);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function compactRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = ci(record, key);
    if (value !== undefined && value !== null && value !== "") {
      output[key] = value;
    }
  }
  return output;
}

function stripChildren(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (CHILD_KEYS.has(key.toLowerCase())) continue;
    output[key] = value;
  }
  return output;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((output, item) => {
    const key = keyFn(item);
    output[key] = (output[key] ?? 0) + 1;
    return output;
  }, {});
}
