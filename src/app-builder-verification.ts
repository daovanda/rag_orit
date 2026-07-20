import type { Env } from "./config";
import { invalidateAppBuilderGraphCache, runAppBuilderGraphTool } from "./app-builder-graph";
import { asRecord, getCaseInsensitiveValue, toArrayValues, truncateDebugText } from "./utils";
import { assertZilcodeSuccess, callZilcodeJson, type ZilcodeSession } from "./zilcode";

export type VerificationStatus = "passed" | "failed" | "inconclusive";

export interface ExpectedWriteOperation {
  operation_id: string;
  action: "create" | "update" | "delete";
  target: string;
  collection: string;
  label?: string;
  phase?: string;
  depends_on?: string[];
  id_field?: string;
  id_value?: unknown;
  where?: string;
  record?: Record<string, unknown>;
  reference?: Record<string, unknown>;
}

export interface FieldMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface OperationVerificationResult {
  operation_id: string;
  target: string;
  action: ExpectedWriteOperation["action"];
  phase?: string;
  status: VerificationStatus;
  observed_state: "present" | "absent" | "unknown";
  node_id?: string;
  expected_record?: Record<string, unknown>;
  actual_record?: Record<string, unknown>;
  reference?: Record<string, unknown>;
  mismatches: FieldMismatch[];
  relations_checked: string[];
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface CacheVerificationResult {
  windowid: string;
  status: VerificationStatus;
  error?: string;
}

export interface AppBuilderVerificationReport {
  ok: boolean;
  status: "verified" | "verification_failed" | "partial_failure_verified";
  error?: string;
  operation_results: OperationVerificationResult[];
  cache_results: CacheVerificationResult[];
  verified_operations: Record<string, Record<string, unknown>>;
  unverified_operation_ids: string[];
  failed_operation_ids: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    inconclusive: number;
    caches_checked: number;
  };
}

export interface AppBuilderVerificationDependencies {
  graph_tool?: typeof runAppBuilderGraphTool;
  read_window_cache?: (windowId: string) => Promise<unknown>;
}

const GRAPH_TYPE_BY_TARGET: Record<string, string> = {
  application: "app",
  app: "app",
  app_service: "appservice",
  role_app: "roleapp",
  role_menu: "rolemenu"
};

const NAME_FIELD_BY_TARGET: Record<string, string> = {
  app: "appname",
  application: "appname",
  service: "servicename",
  table: "tablename",
  column: "columnname",
  window: "windowname",
  tab: "tabname",
  field: "fieldname",
  menu: "menuname",
  domain: "domainname"
};

const RELATION_FIELDS = new Set([
  "appid", "serviceid", "tableid", "columnid", "windowid", "tabid", "menuid", "roleid",
  "domainid", "linktableid", "linkcolumn", "mapcolumn", "parenttabid", "parentfieldid",
  "linkparentfield", "linkchildfield", "relatetableid", "relateparentfield", "relatechildfield",
  "linkwindowid", "reportid", "workflowid"
]);

export async function verifyAppBuilderWriteResult(
  env: Env,
  session: ZilcodeSession,
  writeResult: Record<string, unknown>,
  dependencies: AppBuilderVerificationDependencies = {}
): Promise<AppBuilderVerificationReport> {
  const graphTool = dependencies.graph_tool ?? runAppBuilderGraphTool;
  const operations = parseExpectedWriteOperations(writeResult.expected_operations);
  invalidateAppBuilderGraphCache(session);

  const operationResults: OperationVerificationResult[] = [];
  for (const operation of operations) {
    operationResults.push(await verifyOperation(env, session, operation, graphTool));
  }

  const cacheResults: CacheVerificationResult[] = [];
  for (const windowId of collectCacheWindowIds(writeResult)) {
    try {
      if (dependencies.read_window_cache) {
        await dependencies.read_window_cache(windowId);
      } else {
        const envelope = await callZilcodeJson<unknown>(env, `rest/token/cache/${encodeURIComponent(windowId)}`, {
          token: session.token,
          baseUrl: session.base_url
        });
        assertZilcodeSuccess(envelope);
      }
      cacheResults.push({ windowid: windowId, status: "passed" });
    } catch (error) {
      cacheResults.push({ windowid: windowId, status: "failed", error: truncateDebugText(error) });
    }
  }
  for (const failure of collectCacheFailures(writeResult)) {
    if (!cacheResults.some(result => result.windowid === failure.windowid)) {
      cacheResults.push(failure);
    }
  }

  const verifiedOperations: Record<string, Record<string, unknown>> = {};
  for (const result of operationResults) {
    if (result.status !== "passed") continue;
    verifiedOperations[result.operation_id] = result.reference ?? result.actual_record ?? {};
  }

  const failed = operationResults.filter(result => result.status === "failed");
  const inconclusive = operationResults.filter(result => result.status === "inconclusive");
  const cacheFailed = cacheResults.some(result => result.status !== "passed");
  const applyFailed = writeResult.ok !== true;
  const expectedOperationsMissing = operations.length === 0;
  const ok = !expectedOperationsMissing
    && !applyFailed
    && failed.length === 0
    && inconclusive.length === 0
    && !cacheFailed;

  return {
    ok,
    status: ok
      ? "verified"
      : applyFailed
        ? "partial_failure_verified"
        : "verification_failed",
    error: expectedOperationsMissing
      ? "Apply result không có expected_operations nên không thể chứng minh postcondition."
      : undefined,
    operation_results: operationResults,
    cache_results: cacheResults,
    verified_operations: verifiedOperations,
    unverified_operation_ids: operationResults
      .filter(result => result.status !== "passed")
      .map(result => result.operation_id),
    failed_operation_ids: failed.map(result => result.operation_id),
    summary: {
      total: operationResults.length,
      passed: operationResults.filter(result => result.status === "passed").length,
      failed: failed.length,
      inconclusive: inconclusive.length,
      caches_checked: cacheResults.length
    }
  };
}

async function verifyOperation(
  env: Env,
  session: ZilcodeSession,
  operation: ExpectedWriteOperation,
  graphTool: typeof runAppBuilderGraphTool
): Promise<OperationVerificationResult> {
  const query = verificationQuery(operation);
  if (!query) {
    return baseResult(operation, "inconclusive", "unknown", {
      error: "Không có ID hoặc natural key để xác định target sau apply."
    });
  }

  try {
    const graphType = GRAPH_TYPE_BY_TARGET[operation.target] ?? operation.target;
    const search = await graphTool(env, session, "app_builder_graph_search", {
      query,
      types: graphType,
      limit: "30",
      max_records_per_table: "5000"
    });
    if (search.error) {
      return baseResult(operation, "inconclusive", "unknown", { error: String(search.error) });
    }

    const match = findExactMatch(toArrayValues(search.matches), operation, graphType);
    if (!match) {
      const completeness = asRecord(search.read_completeness);
      if (completeness?.authoritative !== true) {
        return baseResult(operation, "inconclusive", "unknown", {
          error: "Không thể chứng minh entity không tồn tại vì nguồn graph không đầy đủ hoặc bị giới hạn.",
          evidence: {
            query,
            graph_type: graphType,
            matches_count: Number(search.matches_count ?? 0),
            read_completeness: completeness,
            graph_quality: search.graph_quality,
            errors: search.errors
          }
        });
      }
      return operation.action === "delete"
        ? baseResult(operation, "passed", "absent", {
          evidence: {
            query,
            graph_type: graphType,
            matches_count: Number(search.matches_count ?? 0),
            read_completeness: completeness
          }
        })
        : baseResult(operation, "failed", "absent", {
          error: "Không tìm thấy entity sau apply.",
          evidence: { query, graph_type: graphType, matches_count: Number(search.matches_count ?? 0) }
        });
    }

    const node = asRecord(match) ?? {};
    const nodeId = String(node.id ?? "");
    if (operation.action === "delete") {
      return baseResult(operation, "failed", "present", {
        node_id: nodeId,
        error: "Entity vẫn tồn tại sau thao tác delete.",
        evidence: { query, matched_node: compactEvidenceNode(node) }
      });
    }

    const detail = await graphTool(env, session, "app_builder_node_detail", {
      node_id: nodeId,
      include_neighbors: "true",
      include_fields: "true",
      max_records_per_table: "5000"
    });
    if (detail.error) {
      return baseResult(operation, "inconclusive", "present", {
        node_id: nodeId,
        error: String(detail.error),
        evidence: { query, matched_node: compactEvidenceNode(node) }
      });
    }

    const actualRecord = asRecord(asRecord(detail.detail)?.record) ?? asRecord(node.summary) ?? {};
    const expectedRecord = operation.record ?? {};
    const mismatches = compareExpectedRecord(expectedRecord, actualRecord);
    const relationsChecked = Object.keys(expectedRecord).filter(field => RELATION_FIELDS.has(field.toLowerCase()));
    const reference = {
      ...actualRecord,
      ...(operation.reference ?? {})
    };

    return baseResult(operation, mismatches.length ? "failed" : "passed", "present", {
      node_id: nodeId,
      expected_record: expectedRecord,
      actual_record: actualRecord,
      reference,
      mismatches,
      relations_checked: relationsChecked,
      evidence: {
        query,
        matched_node: compactEvidenceNode(node),
        verified_relations_count: toArrayValues(asRecord(detail.answer_facts)?.verified_relations).length
      },
      error: mismatches.length ? "Entity tồn tại nhưng chưa đạt postcondition mong đợi." : undefined
    });
  } catch (error) {
    return baseResult(operation, "inconclusive", "unknown", { error: truncateDebugText(error) });
  }
}

export function compareExpectedRecord(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue === undefined || isSpecificationOnlyField(field)) continue;
    const actualValue = getCaseInsensitiveValue(actual, field);
    if (!sameMetadataValue(expectedValue, actualValue)) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }
  return mismatches;
}

function verificationQuery(operation: ExpectedWriteOperation): string {
  const idField = operation.id_field ?? "id";
  const referenceId = getCaseInsensitiveValue(operation.reference ?? {}, idField);
  if (hasValue(referenceId)) return String(referenceId);
  if (hasValue(operation.id_value)) return String(operation.id_value);
  const nameField = NAME_FIELD_BY_TARGET[operation.target];
  const name = nameField ? getCaseInsensitiveValue(operation.record ?? {}, nameField) : undefined;
  return hasValue(name) ? String(name) : String(operation.label ?? "").trim();
}

function findExactMatch(
  matches: unknown[],
  operation: ExpectedWriteOperation,
  graphType: string
): Record<string, unknown> | undefined {
  const idField = operation.id_field ?? "id";
  const expectedId = getCaseInsensitiveValue(operation.reference ?? {}, idField) ?? operation.id_value;
  const nameField = NAME_FIELD_BY_TARGET[operation.target];
  const expectedName = nameField ? getCaseInsensitiveValue(operation.record ?? {}, nameField) : undefined;

  return matches
    .map(asRecord)
    .filter((match): match is Record<string, unknown> => Boolean(match))
    .filter(match => String(match.type ?? "") === graphType)
    .find(match => {
      const summary = asRecord(match.summary) ?? {};
      const candidateId = getCaseInsensitiveValue(summary, idField);
      if (hasValue(expectedId) && sameMetadataValue(expectedId, candidateId)) return true;
      if (hasValue(expectedId) && nodeIdContains(String(match.id ?? ""), expectedId)) return true;
      const candidateName = nameField
        ? getCaseInsensitiveValue(summary, nameField) ?? match.label
        : match.label;
      return hasValue(expectedName) && sameMetadataValue(expectedName, candidateName);
    });
}

function baseResult(
  operation: ExpectedWriteOperation,
  status: VerificationStatus,
  observedState: OperationVerificationResult["observed_state"],
  extra: Partial<OperationVerificationResult> = {}
): OperationVerificationResult {
  return {
    operation_id: operation.operation_id,
    target: operation.target,
    action: operation.action,
    phase: operation.phase,
    status,
    observed_state: observedState,
    expected_record: operation.record,
    reference: operation.reference,
    mismatches: [],
    relations_checked: [],
    ...extra
  };
}

export function parseExpectedWriteOperations(value: unknown): ExpectedWriteOperation[] {
  return toArrayValues(value)
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter(record => typeof record.operation_id === "string")
    .map(record => ({
      operation_id: String(record.operation_id),
      action: normalizeAction(record.action),
      target: String(record.target ?? ""),
      collection: String(record.collection ?? ""),
      label: typeof record.label === "string" ? record.label : undefined,
      phase: typeof record.phase === "string" ? record.phase : undefined,
      depends_on: toArrayValues(record.depends_on).map(String),
      id_field: typeof record.id_field === "string" ? record.id_field : undefined,
      id_value: record.id_value,
      where: typeof record.where === "string" ? record.where : undefined,
      record: asRecord(record.record) ?? undefined,
      reference: asRecord(record.reference) ?? undefined
    }));
}

function normalizeAction(value: unknown): ExpectedWriteOperation["action"] {
  return value === "update" || value === "delete" ? value : "create";
}

function collectCacheWindowIds(writeResult: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const result of toArrayValues(writeResult.results)) {
    const record = asRecord(result);
    if (!record || record.operation_id !== "auto_deploy_window_cache") continue;
    const payload = asRecord(record.result);
    for (const value of toArrayValues(payload?.window_ids)) {
      if (hasValue(value)) ids.add(String(value));
    }
  }
  return [...ids];
}

function collectCacheFailures(writeResult: Record<string, unknown>): CacheVerificationResult[] {
  const output: CacheVerificationResult[] = [];
  for (const result of toArrayValues(writeResult.results)) {
    const record = asRecord(result);
    if (!record || record.operation_id !== "auto_deploy_window_cache" || record.ok !== false) continue;
    const windowIds = toArrayValues(record.expected_window_ids);
    if (!windowIds.length) {
      output.push({
        windowid: "unknown",
        status: "failed",
        error: String(record.error ?? "Cache deployment failed without target evidence.")
      });
      continue;
    }
    windowIds.forEach(windowId => output.push({
      windowid: String(windowId),
      status: "failed",
      error: String(record.error ?? "Cache deployment failed.")
    }));
  }
  return output;
}

function sameMetadataValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left === null || left === undefined || left === "")
      && (right === null || right === undefined || right === "");
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    return normalizeBoolean(left) === normalizeBoolean(right);
  }
  if (isNumeric(left) && isNumeric(right)) return Number(left) === Number(right);
  return String(left).trim().normalize("NFC") === String(right).trim().normalize("NFC");
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 1 || ["true", "1", "yes", "y"].includes(String(value).toLowerCase());
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
}

function isSpecificationOnlyField(field: string): boolean {
  const normalized = field.toLowerCase();
  return normalized.endsWith("_ref")
    || ["action", "ref", "key", "name", "table", "column", "window", "menu", "domain", "parent", "fields", "tabs", "columns"].includes(normalized);
}

function nodeIdContains(nodeId: string, id: unknown): boolean {
  return nodeId.split(":").some(part => decodeURIComponent(part) === String(id));
}

function compactEvidenceNode(node: Record<string, unknown>): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    summary: node.summary
  };
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
