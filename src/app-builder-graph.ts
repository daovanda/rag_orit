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
}

const CHILD_KEYS = new Set(["tables", "columns", "windows", "tabs", "fields", "menus"]);

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
      error: "Chua dang nhap Zilcode trong chatbot. Hay dang nhap truoc khi doc App Builder graph."
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
  const blueprint = await buildZilcodeAppBuilderBlueprint(env, session, {
    appid: getStringArg(args, "app_builder_appid") || getStringArg(args, "appid") || "1",
    mode: "graph",
    include_records: "true",
    include_fields: "false",
    include_raw: "false",
    max_records_per_table: String(getNumberArg(args, "max_records_per_table", 500, 1, 5000)),
    max_windows_per_app: String(getNumberArg(args, "max_windows_per_app", 50, 1, 300))
  });

  return buildGraphFromBlueprint(blueprint);
}

function buildGraphFromBlueprint(blueprint: Record<string, unknown>): GraphContext {
  const nodes = new Map<string, AppBuilderNode>();
  const edges = new Map<string, AppBuilderEdge>();
  const sourceByNodeId = new Map<string, SourceRecord>();
  const tableById = new Map<string, string>();
  const tableByAppAndName = new Map<string, string>();
  const columnById = new Map<string, string>();
  const columnByTableAndName = new Map<string, string>();
  const windowById = new Map<string, string>();
  const tabById = new Map<string, string>();
  const domainById = new Map<string, string>();
  const pendingTabParents: Array<{ child: string; parenttabid: unknown }> = [];

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
    const tables = toRecords(app.tables);
    const windows = toRecords(app.windows);
    const menus = toRecords(app.menus);

    addNode({
      id: appNodeId,
      type: "app",
      label: labelOf(app, ["appname", "app_name", "name", "appcode"], appNodeId),
      summary: compactRecord(app, ["appid", "appname", "appcode", "description", "siteid", "seqno", "active", "apptype"]),
      counts: {
        tables: tables.length,
        windows: windows.length,
        menus: menus.length
      },
      has_detail: true
    }, { type: "app", record: app });
    addEdge({ from: rootId, to: appNodeId, type: "manages_app" });

    for (const table of tables) {
      const tableKey = stringValue(ci(table, "tableid") ?? ci(table, "tablename") ?? fallbackId(table, "table"));
      const tableNodeId = `table:${idPart(appid)}:${idPart(tableKey)}`;
      const columns = toRecords(table.columns);
      const tableName = stringValue(ci(table, "tablename"));

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
            "length", "isprimarykey", "isrequire", "isreadonly", "seqno", "description"
          ]),
          has_detail: true
        }, { type: "column", record: column, parent: table });
        addEdge({ from: tableNodeId, to: columnNodeId, type: "table_has_column" });

        const columnId = stringValue(ci(column, "columnid"));
        if (columnId) columnById.set(columnId, columnNodeId);
        if (columnName) columnByTableAndName.set(`${tableNodeId}:${normalizeKey(columnName)}`, columnNodeId);
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

    for (const windowRecord of toRecords(app.windows)) {
      const windowid = stringValue(ci(windowRecord, "windowid") ?? fallbackId(windowRecord, "window"));
      const windowNodeId = `window:${idPart(windowid)}`;
      const tabs = toRecords(windowRecord.tabs);

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
        const fields = toRecords(tab.fields);
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

          addNode({
            id: fieldNodeId,
            type: "field",
            label: labelOf(field, ["fieldname", "caption", "label", "columnname", "translate"], fieldNodeId),
            summary: compactRecord(field, [
              "fieldid", "fieldname", "columnname", "tableid", "tabid", "caption", "label",
              "datatype", "controltype", "fieldtype", "domainid", "defaultvalue", "isrequire",
              "isreadonly", "isvisible", "isprimarykey", "seqno"
            ]),
            has_detail: true
          }, { type: "field", record: field, parent: tab });
          addEdge({ from: tabNodeId, to: fieldNodeId, type: "tab_has_field" });

          if (fieldColumnNodeId) {
            addEdge({ from: fieldNodeId, to: fieldColumnNodeId, type: "field_maps_column" });
          }

          const domainid = stringValue(ci(field, "domainid"));
          const domainNodeId = domainid ? domainById.get(domainid) : undefined;
          if (domainNodeId) {
            addEdge({ from: fieldNodeId, to: domainNodeId, type: "field_uses_domain" });
          }

          const linkTableId = stringValue(ci(field, "linktableid"));
          const linkTableNodeId = linkTableId ? tableById.get(linkTableId) : undefined;
          if (linkTableNodeId) {
            addEdge({ from: fieldNodeId, to: linkTableNodeId, type: "field_links_table" });
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
  const maxNodes = getNumberArg(args, "max_nodes", 250, 20, 1000);
  const maxEdges = getNumberArg(args, "max_edges", 500, 20, 2000);
  const graph = summarizeGraph(context.nodes.slice(0, maxNodes), context.edges.slice(0, maxEdges));

  return {
    mode: "overview",
    description: "Skeleton graph cua App Builder. Dung node_id tu day de goi search, subgraph hoac node_detail.",
    session: context.blueprint.session,
    scan: context.blueprint.scan,
    graph,
    truncated: {
      nodes: context.nodes.length > maxNodes,
      edges: context.edges.length > maxEdges,
      total_nodes: context.nodes.length,
      total_edges: context.edges.length
    },
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
      error: "Thieu query. Hay truyen query de tim app/table/window/tab/field/menu/domain.",
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
    hint: "Dung node_id trong matches de goi app_builder_graph_subgraph hoac app_builder_node_detail."
  };
}

function buildSubgraphResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const depth = getNumberArg(args, "depth", 1, 1, 5);
  const maxNodes = getNumberArg(args, "max_nodes", 120, 10, 500);
  const startIds = getNodeIds(args);
  const query = getStringArg(args, "query") || getStringArg(args, "q");
  const resolvedStartIds = startIds.length
    ? startIds
    : query
      ? searchNodeIds(context, query, 3)
      : [];

  if (!resolvedStartIds.length) {
    return {
      mode: "subgraph",
      error: "Thieu node_id/node_ids. Co the truyen query de tool tu tim node gan nhat.",
      graph_counts: graphCounts(context.nodes, context.edges)
    };
  }

  const subgraph = filterNeighborhood(context, resolvedStartIds, depth, maxNodes);
  return {
    mode: "subgraph",
    start_node_ids: resolvedStartIds,
    depth,
    graph: summarizeGraph(subgraph.nodes, subgraph.edges),
    missing_node_ids: resolvedStartIds.filter(id => !context.nodeById.has(id))
  };
}

function buildNodeDetailResponse(context: GraphContext, args: Record<string, unknown>): Record<string, unknown> {
  const includeNeighbors = getBooleanArg(args, "include_neighbors", true);
  const includeFields = getBooleanArg(args, "include_fields", true);
  const nodeId = getNodeIds(args)[0] ?? searchNodeIds(context, getStringArg(args, "query") || getStringArg(args, "q"), 1)[0];

  if (!nodeId) {
    return {
      mode: "detail",
      error: "Thieu node_id. Co the truyen query de tool tim node gan nhat.",
      graph_counts: graphCounts(context.nodes, context.edges)
    };
  }

  const node = context.nodeById.get(nodeId);
  if (!node) {
    return {
      mode: "detail",
      node_id: nodeId,
      error: "Khong tim thay node_id trong graph.",
      search_hint: "Goi app_builder_graph_search de tim node_id dung."
    };
  }

  return {
    mode: "detail",
    node,
    detail: buildNodeDetail(context, nodeId, includeFields),
    neighbors: includeNeighbors ? buildNeighborSummary(context, nodeId) : undefined
  };
}

function buildCreationSchema(args: Record<string, unknown>): Record<string, unknown> {
  const intent = getStringArg(args, "intent") || "general";

  return {
    mode: "creation_schema",
    intent,
    status: "prepare_then_apply",
    note: "Dung app_builder_prepare_change de tao pending plan. Chi dung app_builder_apply_change sau khi user xac nhan ro rang.",
    graph_first_rule: [
      "1. Goi app_builder_graph_overview de nam skeleton he thong.",
      "2. Goi app_builder_graph_search neu can tim app/table/window/tab/field hien co.",
      "3. Goi app_builder_graph_subgraph de mo vung lien quan.",
      "4. Goi app_builder_node_detail cho node can sua/them nhanh.",
      "5. Goi app_builder_prepare_change de validate va luu pending plan neu da du thong tin.",
      "6. Chi apply sau khi user xac nhan."
    ],
    create_app_branch: {
      order: ["app", "table", "column", "window", "tab", "field", "menu"],
      required_edges: [
        "root -> app",
        "app -> table",
        "table -> column",
        "app -> window",
        "window -> tab",
        "tab -> table",
        "tab -> field",
        "field -> column",
        "app -> menu",
        "menu -> window"
      ],
      required_information: {
        app: ["appname", "optional description"],
        table: ["appid", "tablename", "alias", "tabletype"],
        column: ["tableid or table reference", "columnname", "datatype/columntype", "primary/display/search flags when needed"],
        window: ["appid", "windowname"],
        tab: ["windowid", "tableid", "tabname", "seqno"],
        field: ["tabid", "columnid or columnname", "fieldname/label", "seqno", "controltype/datatype when needed"],
        menu: ["appid", "menuname", "linkwindowid", "seqno"]
      }
    },
    edit_existing_branch: {
      order: ["search target", "subgraph around target", "node detail", "proposed patch plan"],
      rules: [
        "Khong tao trung app/table/window/menu/field neu graph da co node tuong ung.",
        "Neu user noi ten app/table/window mo ho, dung search truoc roi hoi lai neu co nhieu ket qua.",
        "Neu can them field vao window, phai biet tab va column; neu column chua co thi plan can tao column truoc field."
      ]
    },
    proposed_plan_format: {
      intent: "create_app | add_table | add_window | add_tab | add_field | update_node",
      target_node_ids: ["node id neu sua node hien co"],
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
          after: "create_app_1",
          record: { appid: "$create_app_1.appid", tablename: "...", alias: "...", tabletype: "table" }
        },
        {
          id: "create_column_1",
          op: "create_column",
          after: "create_table_1",
          record: { tableid: "$create_table_1.tableid", columnname: "...", datatype: "text" }
        }
      ],
      reference_rule: "Co the dung $operation_id.field de noi output cua buoc truoc vao buoc sau, vi du $create_app_1.appid.",
      delete_rule: "Xoa node chi khi user noi ro. Dung delete_table/delete_column/delete_window/delete_tab/delete_field/delete_menu/delete_domain voi id_value hoac where.",
      validation: ["duplicate check", "required ids", "edge completeness", "payload fields filtered by actual App Builder metadata"]
    }
  };
}

function buildNodeDetail(context: GraphContext, nodeId: string, includeFields: boolean): Record<string, unknown> {
  const source = context.sourceByNodeId.get(nodeId);
  if (!source) return { error: "Node khong co source detail." };

  switch (source.type) {
    case "app": {
      const tables = toRecords(source.record.tables);
      const windows = toRecords(source.record.windows);
      const menus = toRecords(source.record.menus);
      return {
        record: stripChildren(source.record),
        counts: {
          tables: tables.length,
          windows: windows.length,
          menus: menus.length
        },
        tables: tables.map(table => ({
          ...compactRecord(table, ["tableid", "tablename", "alias", "tabletype", "columnkey", "columndisplay"]),
          columns_count: toRecords(table.columns).length
        })),
        windows: windows.map(windowRecord => ({
          ...compactRecord(windowRecord, ["windowid", "windowname", "windowtype", "execname"]),
          tabs_count: toRecords(windowRecord.tabs).length
        })),
        menus: menus.map(menu => compactRecord(menu, ["menuid", "menuname", "translate", "linkwindowid", "parentid", "seqno"]))
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
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return context.nodes
    .map(node => ({ node, score: scoreNode(node, normalizedQuery) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.node.id);
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
