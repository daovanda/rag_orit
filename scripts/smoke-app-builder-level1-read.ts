import { runAppBuilderGraphTool } from "../src/app-builder-graph";
import { assertZilcodeSuccess, callZilcodeJson } from "../src/zilcode";

type SmokeEnv = {
  ZILCODE_BASE: string;
  CHUNKS: {
    put: (key: string, value: string) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    delete: (key: string) => Promise<void>;
  };
};

type SessionLike = {
  base_url: string;
  token: string;
  roleid: number;
  orgid: number;
  userid?: unknown;
  username?: string;
  sitecode?: string;
  user?: Record<string, unknown>;
};

type CheckStatus = "pass" | "partial" | "not_observed" | "fail";

type CheckResult = {
  name: string;
  status: CheckStatus;
  evidence: Record<string, unknown>;
  notes?: string[];
};

const baseUrl = process.env.ZILCODE_BASE || "https://demo.zilcode.com";
const username = process.env.ZILCODE_USERNAME || "admin";
const sitecode = process.env.ZILCODE_SITECODE || "demo";
const password = process.env.ZILCODE_PASSWORD || "12345678";
const roleid = Number(process.env.ZILCODE_ROLEID || 1);
const orgid = Number(process.env.ZILCODE_ORGID || 0);

function makeEnv(): SmokeEnv {
  const kv = new Map<string, string>();
  return {
    ZILCODE_BASE: baseUrl,
    CHUNKS: {
      put: async (key, value) => { kv.set(key, value); },
      get: async key => kv.get(key) ?? null,
      delete: async key => { kv.delete(key); }
    }
  };
}

async function login(env: SmokeEnv): Promise<SessionLike> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(env as never, "rest/token/", {
    method: "POST",
    baseUrl,
    data: [username, sitecode, password]
  });
  const loginResult = assertZilcodeSuccess(envelope) as Record<string, unknown>;
  const token = String(loginResult.token || "");
  if (!token) throw new Error("Login did not return token.");

  await callZilcodeJson(env as never, "rest/token/roleorg", {
    method: "PUT",
    baseUrl,
    token,
    data: [roleid, orgid]
  });

  return {
    base_url: baseUrl,
    token,
    roleid,
    orgid,
    userid: loginResult.userid,
    username,
    sitecode,
    user: loginResult
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function countOf(counts: Record<string, unknown>, key: string): number {
  const value = counts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasAny(counts: Record<string, unknown>, keys: string[]): boolean {
  return keys.some(key => countOf(counts, key) > 0);
}

function missingKeys(counts: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter(key => countOf(counts, key) <= 0);
}

function passIfNoMissing(
  name: string,
  counts: Record<string, unknown>,
  required: string[],
  label: string
): CheckResult {
  const missing = missingKeys(counts, required);
  return {
    name,
    status: missing.length ? "fail" : "pass",
    evidence: {
      [label]: Object.fromEntries(required.map(key => [key, countOf(counts, key)])),
      missing
    }
  };
}

function edgeEvidence(edgeCounts: Record<string, unknown>, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map(key => [key, countOf(edgeCounts, key)]));
}

async function main(): Promise<void> {
  const env = makeEnv();
  const session = await login(env);

  const overview = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_overview", {
    max_records_per_table: "5000",
    max_windows_per_app: "300",
    max_apps: "500"
  });
  if (overview.error) throw new Error(`overview failed: ${JSON.stringify(overview, null, 2)}`);

  const graphCounts = asRecord(overview.graph_counts);
  const nodeCounts = asRecord(graphCounts.node_counts);
  const edgeCounts = asRecord(graphCounts.edge_counts);
  const errors = asRecords(overview.errors);

  const creationSchema = await runAppBuilderGraphTool(env as never, session as never, "app_builder_creation_schema", {
    intent: "level1_evaluation"
  });
  if (creationSchema.error) throw new Error(`creation_schema failed: ${JSON.stringify(creationSchema, null, 2)}`);

  const appSearch = await runAppBuilderGraphTool(env as never, session as never, "app_builder_graph_search", {
    query: "App Builder",
    types: "app",
    limit: 5,
    max_records_per_table: "5000",
    max_windows_per_app: "300"
  });
  const appMatches = asRecords(appSearch.matches);
  const appNodeId = String(appMatches[0]?.id ?? "");
  const appDetail = appNodeId
    ? await runAppBuilderGraphTool(env as never, session as never, "app_builder_node_detail", {
      node_id: appNodeId,
      include_neighbors: true,
      include_fields: true,
      max_records_per_table: "5000",
      max_windows_per_app: "300"
    })
    : { error: "App Builder app node was not found." };

  const checks: CheckResult[] = [];
  checks.push(passIfNoMissing(
    "core_graph_nodes",
    nodeCounts,
    ["root", "app", "table", "column", "window", "tab", "field", "menu"],
    "node_counts"
  ));
  checks.push(passIfNoMissing(
    "core_graph_edges",
    edgeCounts,
    ["app_has_table", "table_has_column", "app_has_window", "window_has_tab", "tab_has_field", "app_has_menu"],
    "edge_counts"
  ));

  const serviceNodeRequired = ["service", "appservice"];
  const serviceEdgeRequired = ["app_uses_service", "app_has_appservice", "appservice_links_service", "service_has_table"];
  const serviceMissingNodes = missingKeys(nodeCounts, serviceNodeRequired);
  const serviceMissingEdges = missingKeys(edgeCounts, serviceEdgeRequired);
  checks.push({
    name: "service_appservice_binding",
    status: serviceMissingNodes.length || serviceMissingEdges.length ? "partial" : "pass",
    evidence: {
      node_counts: Object.fromEntries(serviceNodeRequired.map(key => [key, countOf(nodeCounts, key)])),
      edge_counts: edgeEvidence(edgeCounts, serviceEdgeRequired),
      missing_nodes: serviceMissingNodes,
      missing_edges: serviceMissingEdges
    },
    notes: serviceMissingNodes.length || serviceMissingEdges.length
      ? ["Graph co service/appservice metadata chua day du hoac moi truong khong co binding edge tuong ung."]
      : undefined
  });

  const domainNodeObserved = countOf(nodeCounts, "domain") > 0;
  const domainEdges = ["app_has_domain", "field_uses_domain"];
  const lookupEdges = ["field_links_table", "tab_links_table", "tab_uses_relation_table"];
  const appDomainObserved = countOf(edgeCounts, "app_has_domain") > 0;
  const fieldDomainObserved = countOf(edgeCounts, "field_uses_domain") > 0;
  const lookupEdgeObserved = hasAny(edgeCounts, lookupEdges);
  checks.push({
    name: "domain_lookup_relation_read",
    status: domainNodeObserved && appDomainObserved && fieldDomainObserved && lookupEdgeObserved
      ? "pass"
      : domainNodeObserved || appDomainObserved || fieldDomainObserved || lookupEdgeObserved
        ? "partial"
        : "not_observed",
    evidence: {
      node_counts: { domain: countOf(nodeCounts, "domain") },
      domain_edge_counts: edgeEvidence(edgeCounts, domainEdges),
      lookup_relation_edge_counts: edgeEvidence(edgeCounts, lookupEdges)
    },
    notes: domainNodeObserved && (!fieldDomainObserved || !lookupEdgeObserved)
      ? ["Doc duoc domain node, nhung chua quan sat du field_uses_domain va/hoac lookup relation edge trong graph hien tai."]
      : undefined
  });

  const roleNodeObserved = countOf(nodeCounts, "role") > 0;
  const roleAccessNodeKeys = ["roleapp", "rolemenu", "access"];
  const roleAccessEdgeKeys = ["role_grants_app", "role_has_rolemenu", "rolemenu_grants_menu", "role_has_table_access", "access_controls_table"];
  const roleAccessNodeObserved = hasAny(nodeCounts, roleAccessNodeKeys);
  const roleAccessEdgeObserved = hasAny(edgeCounts, roleAccessEdgeKeys);
  checks.push({
    name: "role_access_read",
    status: roleNodeObserved && roleAccessNodeObserved && roleAccessEdgeObserved
      ? "pass"
      : roleNodeObserved || roleAccessNodeObserved || roleAccessEdgeObserved
        ? "partial"
        : "not_observed",
    evidence: {
      node_counts: {
        role: countOf(nodeCounts, "role"),
        roleapp: countOf(nodeCounts, "roleapp"),
        rolemenu: countOf(nodeCounts, "rolemenu"),
        access: countOf(nodeCounts, "access")
      },
      edge_counts: edgeEvidence(edgeCounts, roleAccessEdgeKeys)
    },
    notes: roleNodeObserved && !roleAccessNodeObserved
      ? ["Doc duoc role, nhung chua quan sat roleapp/rolemenu/access record trong moi truong."]
      : undefined
  });

  const appDetailRecord = asRecord(appDetail);
  const appDetailData = asRecord(appDetailRecord.detail);
  checks.push({
    name: "node_detail_for_app_builder",
    status: appDetailRecord.error ? "fail" : "pass",
    evidence: {
      app_node_id: appNodeId,
      has_error: Boolean(appDetailRecord.error),
      detail_keys: Object.keys(appDetailData),
      neighbor_count: asRecords(appDetailRecord.neighbors).length
    }
  });

  const schemaRecord = asRecord(creationSchema);
  const createBranch = asRecord(schemaRecord.create_app_branch);
  const requiredEdges = Array.isArray(createBranch.required_edges) ? createBranch.required_edges.map(String) : [];
  const roleAccess = asRecord(createBranch.role_access);
  checks.push({
    name: "creation_schema_mentions_advanced_branches",
    status: requiredEdges.some(item => item.includes("appservice"))
      && requiredEdges.some(item => item.includes("role"))
      && Object.keys(roleAccess).length > 0
      ? "pass"
      : "partial",
    evidence: {
      required_edges: requiredEdges,
      role_access: roleAccess
    }
  });

  if (errors.length) {
    checks.push({
      name: "blueprint_errors",
      status: "partial",
      evidence: { errors_count: errors.length, errors: errors.slice(0, 10) },
      notes: ["Graph van tra du lieu, nhung co loi doc metadata can xem them."]
    });
  } else {
    checks.push({
      name: "blueprint_errors",
      status: "pass",
      evidence: { errors_count: 0 }
    });
  }

  const statusRank: Record<CheckStatus, number> = { pass: 0, not_observed: 1, partial: 2, fail: 3 };
  const worst = checks.reduce<CheckStatus>((current, check) =>
    statusRank[check.status] > statusRank[current] ? check.status : current
  , "pass");
  const fullPass = checks.every(check => check.status === "pass");

  console.log(JSON.stringify({
    ok: true,
    level: "level1_graph_read",
    verdict: fullPass ? "full_pass" : worst === "fail" ? "fail" : "partial",
    session: {
      username,
      sitecode,
      roleid,
      orgid
    },
    graph_counts: {
      nodes_count: graphCounts.nodes_count,
      edges_count: graphCounts.edges_count,
      node_counts: nodeCounts,
      edge_counts: edgeCounts
    },
    checks
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
