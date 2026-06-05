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

  return {
    mode: "detail",
    requested_node_id: requestedNodeId,
    resolved_from: requestedNodeId && requestedNodeId !== nodeId ? requestedNodeId : undefined,
    node,
    detail: buildNodeDetail(context, nodeId, includeFields),
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
        field: ["tabid", "columnid or columnname", "fieldname/label", "seqno", "domainid/linktableid/linkcolumn for select/lookup fields when needed", "controltype/datatype when needed"],
        menu: ["appid", "menuname", "linkwindowid", "seqno"],
        role_access: ["roleapp for app access", "rolemenu for menu access", "access for table permissions when needed"],
        cache: ["delete n_cache rows for changed app/window after UI metadata changes"]
      },
      domain_lookup: {
        domain: ["create_domain or resolve existing domainid before using it on field/column"],
        field_domain_edge: "NField.domainid -> NDomain.domainid",
        field_lookup_edge: "NField.linktableid/linkcolumn -> NTable/NColumn",
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
          "isprimarykey", "isrequire", "isreadonly", "seqno", "description"
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
