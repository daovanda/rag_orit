import type { Env } from "./config";
import { invalidateAppBuilderGraphCache } from "./app-builder-graph";
import * as zipsonModule from "./vendor/zipson.min.js";
import { asRecord, getCaseInsensitiveValue, getNumberArg, getStringArg, toArrayValues, truncateDebugText } from "./utils";
import {
  assertZilcodeSuccess,
  buildZilcodeAppBuilderBlueprint,
  callZilcodeJson,
  type ZilcodeSession
} from "./zilcode";

const PENDING_CHANGE_PREFIX = "app_builder_change:";
const PENDING_CHANGE_TTL_SECONDS = 60 * 30;
const zipson = "default" in zipsonModule ? zipsonModule.default : zipsonModule;

const CACHE_ERD_KEYS = {
  window: ["windowid", "windowname", "windowtype", "appid", "execname", "isopenfind", "translate"],
  tab: ["tabid", "parenttabid", "tabname", "tablevel", "seqno", "layoutcols", "linkchildfield", "linkparentfield", "linktableid", "whereclause", "orderby", "tableid", "windowid", "relatechildfield", "relateparentfield", "relatetableid", "filterfield", "filterclause", "noinsert", "noupdate", "nodelete", "isarchive", "islock", "isautosave", "translate", "noselect", "noexport", "workflowid", "isviewonly", "labelspan"],
  field: ["fieldid", "fieldname", "translate", "hideingrid", "hideinform", "hideinfind", "displaylength", "seqno", "isreadonly", "fieldlength", "vformat", "defaultvalue", "isrequire", "isfrozen", "fieldgroup", "tabid", "columnid", "fieldtype", "linktableid", "domainid", "issearchtonghop", "parentfieldid", "wherefieldname", "placeholder", "calculation", "colspan", "rowspan", "mapcolumn", "displaylogic", "columnname", "tableid", "whereclause", "bindfieldname", "options", "columntype", "linkcolumn"],
  menu: ["menuid", "menuname", "parentid", "seqno", "translate", "issummary", "appid", "windowid", "siteid", "tabid", "menutype", "execname", "icon", "reportid"]
};

const TARGET_COLLECTION: Record<string, string> = {
  app: "applications",
  application: "applications",
  table: "tables",
  column: "columns",
  window: "windows",
  tab: "tabs",
  field: "fields",
  menu: "menus",
  domain: "domains",
  service: "services",
  appservice: "appservices",
  app_service: "appservices",
  cache: "caches",
  roleapp: "roleapps",
  role_app: "roleapps",
  rolemenu: "rolemenus",
  role_menu: "rolemenus",
  access: "accesses",
  archive: "archives"
};

const TARGET_ID_FIELD: Record<string, string> = {
  applications: "appid",
  services: "serviceid",
  appservices: "appserviceid",
  tables: "tableid",
  columns: "columnid",
  windows: "windowid",
  tabs: "tabid",
  fields: "fieldid",
  menus: "menuid",
  domains: "domainid",
  caches: "cacheid",
  roleapps: "roleappid",
  rolemenus: "rolemenuid",
  accesses: "accessid",
  archives: "archiveid"
};

const CREATE_REQUIRED_FIELDS: Record<string, string[]> = {
  applications: ["appname", "seqno", "apptype"],
  services: ["servicename", "servicetype", "siteid"],
  appservices: ["appid", "serviceid", "siteid"],
  tables: ["tablename", "tabletype", "siteid", "serviceid"],
  columns: ["tableid", "columnname", "seqno", "siteid"],
  windows: ["appid", "windowname", "windowtype", "siteid"],
  tabs: ["windowid", "tableid", "tabname", "seqno", "siteid"],
  fields: ["tabid", "columnid", "fieldname", "fieldtype", "seqno", "siteid"],
  menus: ["appid", "menuname", "seqno", "siteid", "menutype"],
  domains: ["domainname"],
  caches: ["appid", "siteid"],
  roleapps: ["roleid", "appid", "siteid"],
  rolemenus: ["roleid", "menuid", "siteid"],
  accesses: ["roleid", "tableid", "siteid"]
};

const LEVEL3_COLLECTIONS = new Set(["applications", "tables", "columns", "windows", "tabs", "fields", "menus"]);

const IMPLICIT_ALLOWED_FIELDS: Record<string, string[]> = {
  services: ["siteid"],
  appservices: ["siteid"],
  tables: ["siteid", "serviceid"],
  columns: ["siteid", "domainid", "linktableid", "linkcolumn", "mapcolumn"],
  windows: ["siteid"],
  tabs: ["siteid"],
  fields: ["siteid"],
  menus: ["siteid", "menutype"],
  domains: ["appid", "siteid", "domainjson", "domaintype"],
  caches: ["siteid"],
  roleapps: ["siteid"],
  rolemenus: ["siteid"],
  accesses: ["siteid"]
};

interface PreparedOperation {
  id: string;
  action: "create" | "update" | "delete";
  target: string;
  collection: string;
  label: string;
  record?: Record<string, unknown>;
  id_value?: string | number;
  where?: string;
}

interface PendingChange {
  plan_id: string;
  intent: string;
  created_at: string;
  user_summary?: string;
  operations: PreparedOperation[];
  warnings: string[];
}

interface ApplyState {
  refs: Record<string, Record<string, unknown>>;
}

interface WriteContext {
  blueprint: Record<string, unknown>;
  collections: Record<string, Record<string, unknown>>;
  recordsByCollection: Record<string, Record<string, unknown>[]>;
  allowedColumnsByCollection: Record<string, Set<string>>;
  session: ZilcodeSession;
}

export function isAppBuilderWriteTool(name: string): boolean {
  return name === "app_builder_prepare_change" || name === "app_builder_apply_change";
}

export async function runAppBuilderWriteTool(
  env: Env,
  session: ZilcodeSession | null,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!session) {
    return { error: "Chưa đăng nhập Zilcode nên không thể tạo/sửa/xóa App Builder." };
  }

  if (toolName === "app_builder_prepare_change") {
    return prepareChange(env, session, args);
  }

  if (toolName === "app_builder_apply_change") {
    return applyChange(env, session, args);
  }

  return { error: `Tool ghi App Builder không được hỗ trợ: ${toolName}` };
}

async function prepareChange(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const context = await loadWriteContext(env, session, args);
  const intent = getStringArg(args, "intent") || "change_app_builder";
  const userSummary = getStringArg(args, "summary") || getStringArg(args, "user_request");
  const warnings: string[] = [];
  const rawOperations = expandRawOperations(context, normalizeRawOperations(getRawOperations(args), warnings), warnings);

  if (!rawOperations.length) {
    return {
      mode: "prepare_change",
      status: "invalid",
      valid: false,
      blocking_errors: [
        "Thiếu operations. Hãy truyền operations gồm các bước create/update/delete app/table/column/window/tab/field/menu/domain."
      ]
    };
  }

  const operations: PreparedOperation[] = [];
  const blockingErrors: string[] = [];

  rawOperations.forEach((rawOperation, index) => {
    try {
      const prepared = prepareOperation(context, rawOperation, index);
      operations.push(prepared.operation);
      warnings.push(...prepared.warnings);
    } catch (error) {
      blockingErrors.push(`Operation ${index + 1}: ${truncateDebugText(error)}`);
    }
  });

  if (blockingErrors.length) {
    return {
      mode: "prepare_change",
      status: "invalid",
      valid: false,
      blocking_errors: blockingErrors,
      warnings
    };
  }

  autoWirePreparedOperations(context, operations, warnings);

  const plan: PendingChange = {
    plan_id: crypto.randomUUID(),
    intent,
    created_at: new Date().toISOString(),
    user_summary: userSummary || undefined,
    operations,
    warnings
  };

  await env.CHUNKS.put(
    `${PENDING_CHANGE_PREFIX}${plan.plan_id}`,
    JSON.stringify(plan),
    { expirationTtl: PENDING_CHANGE_TTL_SECONDS }
  );

  return {
    mode: "prepare_change",
    status: "ready_for_confirmation",
    valid: true,
    requires_confirmation: true,
    plan_id: plan.plan_id,
    expires_in_seconds: PENDING_CHANGE_TTL_SECONDS,
    summary: summarizePlan(plan),
    operations: plan.operations.map(operation => summarizeOperation(operation)),
    warnings
  };
}

async function applyChange(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const planId = getStringArg(args, "plan_id");
  if (!planId) {
    return {
      mode: "apply_change",
      ok: false,
      status: "invalid",
      error: "Thiếu plan_id. Hãy gọi app_builder_prepare_change trước và chỉ apply sau khi user xác nhận."
    };
  }

  const raw = await env.CHUNKS.get(`${PENDING_CHANGE_PREFIX}${planId}`);
  if (!raw) {
    return {
      mode: "apply_change",
      ok: false,
      status: "not_found",
      plan_id: planId,
      error: "Không tìm thấy pending plan hoặc plan đã hết hạn."
    };
  }

  const plan = JSON.parse(raw) as PendingChange;
  const context = await loadWriteContext(env, session, args);
  const operationsToApply = expandPreparedOperationsForApply(context, plan.operations, plan.warnings);
  const results: Record<string, unknown>[] = [];
  const state: ApplyState = { refs: {} };
  let failed = false;
  let firstFailedOperation: Record<string, unknown> | undefined;

  for (const operation of operationsToApply) {
    if (failed) {
      results.push({
        operation_id: operation.id,
        label: operation.label,
        skipped: true,
        reason: "previous_operation_failed",
        blocked_by: firstFailedOperation?.operation_id
      });
      continue;
    }

    let request: Record<string, unknown> | undefined;
    try {
      request = buildOperationRequestAudit(context, operation, state);
      const result = await applyOperation(env, context, operation, state);
      const resolvedRecord = operation.record ? resolveRecordReferences(operation.record, state) : {};
      const reference = {
        ...resolvedRecord,
        ...extractOperationReference(operation, result)
      };
      state.refs[operation.id] = reference;
      results.push({ operation_id: operation.id, ok: true, request, result, reference });
    } catch (error) {
      failed = true;
      const failure = {
        operation_id: operation.id,
        label: operation.label,
        ok: false,
        request,
        error: truncateDebugText(error)
      };
      firstFailedOperation = failure;
      results.push(failure);
    }
  }

  if (!failed) {
    try {
      const cacheDeploy = await deployAffectedWindowCaches(env, context, operationsToApply, state);
      if (cacheDeploy.deployed_count) {
        results.push({ operation_id: "auto_deploy_window_cache", ok: true, result: cacheDeploy });
      }
    } catch (error) {
      failed = true;
      results.push({
        operation_id: "auto_deploy_window_cache",
        ok: false,
        error: truncateDebugText(error)
      });
    }
  }

  let pendingPlanDeleted = false;
  try {
    await env.CHUNKS.delete(`${PENDING_CHANGE_PREFIX}${planId}`);
    pendingPlanDeleted = true;
  } catch {
    pendingPlanDeleted = false;
  }

  if (results.some(result => result.ok === true)) {
    invalidateAppBuilderGraphCache(session);
  }

  const appliedOperations = results
    .filter(result => result.ok === true)
    .map(result => ({
      operation_id: result.operation_id,
      label: result.label,
      reference: result.reference
    }));
  const skippedOperations = results
    .filter(result => result.skipped === true)
    .map(result => ({
      operation_id: result.operation_id,
      label: result.label,
      reason: result.reason,
      blocked_by: result.blocked_by
    }));

  return {
    mode: "apply_change",
    ok: !failed,
    status: failed ? "partial_success" : "success",
    plan_id: planId,
    operation_count: operationsToApply.length,
    applied_count: results.filter(result => result.ok).length,
    failed_count: results.filter(result => result.ok === false).length,
    skipped_count: results.filter(result => result.skipped === true).length,
    applied_operations: appliedOperations,
    failed_operation: firstFailedOperation
      ? {
        operation_id: firstFailedOperation.operation_id,
        label: firstFailedOperation.label,
        error: firstFailedOperation.error,
        request: firstFailedOperation.request
      }
      : undefined,
    skipped_operations: skippedOperations,
    pending_plan_deleted: pendingPlanDeleted,
    can_reapply_same_plan: false,
    results,
    next_step: failed
      ? "Sửa lại plan dựa trên lỗi, đọc lại graph để xem các bước đã ghi, rồi gọi prepare_change mới. Không apply lại plan cũ."
      : "Gọi app_builder_graph_overview/search/detail để verify cấu hình sau khi ghi."
  };
}

function expandPreparedOperationsForApply(
  context: WriteContext,
  operations: PreparedOperation[],
  warnings: string[]
): PreparedOperation[] {
  const expanded: PreparedOperation[] = [];

  for (const operation of operations) {
    if (
      operation.action === "delete"
      && operation.collection === "applications"
      && !hasDeleteAppCascadeOperation(operations, operation.id_value)
    ) {
      const rawOperations = buildDeleteAppCascadeOperations(
        context,
        {
          op: "delete_app",
          id_value: operation.id_value,
          where: operation.where
        },
        warnings
      );

      for (const rawOperation of rawOperations) {
        expanded.push(prepareOperation(context, rawOperation, expanded.length).operation);
      }
      continue;
    }

    expanded.push(operation);
  }

  return expanded;
}

function hasDeleteAppCascadeOperation(operations: PreparedOperation[], appId: unknown): boolean {
  if (!hasUsableValue(appId)) return false;
  const appIdText = String(appId);
  return operations.some(operation =>
    operation.action === "delete"
    && operation.collection === "windows"
    && (
      String(operation.id ?? "").startsWith(`delete_app_${appIdText}_windows`)
      || String(operation.where ?? "").includes(`appid=${appIdText}`)
    )
  );
}

async function loadWriteContext(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<WriteContext> {
  const blueprint = await buildZilcodeAppBuilderBlueprint(env, session, {
    appid: getStringArg(args, "app_builder_appid") || "1",
    mode: "graph",
    include_records: "true",
    include_fields: "false",
    include_raw: "false",
    max_records_per_table: String(getNumberArg(args, "max_records_per_table", 1000, 1, 5000)),
    max_windows_per_app: String(getNumberArg(args, "max_windows_per_app", 50, 1, 300))
  });

  const appBuilderRecords = asRecord(blueprint.app_builder_records) ?? {};
  const collectionsRaw = asRecord(appBuilderRecords.collections) ?? {};
  const collections: Record<string, Record<string, unknown>> = {};
  const recordsByCollection: Record<string, Record<string, unknown>[]> = {};

  for (const [key, value] of Object.entries(collectionsRaw)) {
    const collection = asRecord(value);
    if (!collection) continue;
    collections[key] = collection;
    recordsByCollection[key] = toRecords(collection.records);
  }

  const allowedColumnsByCollection: Record<string, Set<string>> = {};
  const columnRecords = recordsByCollection.columns ?? [];
  for (const [key, collection] of Object.entries(collections)) {
    const sourceTable = asRecord(collection.source_table) ?? {};
    const tableid = String(sourceTable.tableid ?? "");
    const tablename = String(sourceTable.tablename ?? "").toLowerCase();
    const allowed = new Set<string>();

    for (const column of columnRecords) {
      const columnTableId = String(ci(column, "tableid") ?? "");
      const columnTableName = String(ci(column, "tablename") ?? "").toLowerCase();
      const columnName = String(ci(column, "columnname") ?? "").trim();
      if (!columnName) continue;
      if ((tableid && columnTableId === tableid) || (tablename && columnTableName === tablename)) {
        allowed.add(columnName.toLowerCase());
      }
    }

    if (allowed.size === 0) {
      for (const record of recordsByCollection[key] ?? []) {
        for (const recordKey of Object.keys(record)) {
          allowed.add(recordKey.toLowerCase());
        }
      }
    }

    for (const implicitField of IMPLICIT_ALLOWED_FIELDS[key] ?? []) {
      allowed.add(implicitField.toLowerCase());
    }

    allowedColumnsByCollection[key] = allowed;
  }

  return {
    blueprint,
    collections,
    recordsByCollection,
    allowedColumnsByCollection,
    session
  };
}

function prepareOperation(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  index: number
): { operation: PreparedOperation; warnings: string[] } {
  const op = getOperationName(rawOperation);
  const action = getAction(op);
  const target = getTarget(op, rawOperation);
  const collection = TARGET_COLLECTION[target];
  const warnings: string[] = [];

  if (!collection) throw new Error(`Target không hỗ trợ: ${target}`);
  if (!context.collections[collection]) throw new Error(`Không tìm thấy collection metadata: ${collection}`);

  const record = getOperationRecordPayload(target, rawOperation, warnings);
  const preparedRecord = action === "create"
    ? materializeCreateRecord(context, collection, record, warnings)
    : action === "update"
      ? materializeUpdateRecord(context, collection, record, warnings)
      : undefined;

  if (action === "create" && (!preparedRecord || !Object.keys(preparedRecord).length)) {
    throw new Error("Create operation không có record hợp lệ.");
  }
  if (action === "update" && (!preparedRecord || !Object.keys(preparedRecord).length)) {
    throw new Error("Update operation không còn field hợp lệ sau khi lọc metadata.");
  }

  const idField = TARGET_ID_FIELD[collection];
  const whereRecord = asRecord(rawOperation.where)
    ? normalizeRecordAliases(target, asRecord(rawOperation.where) as Record<string, unknown>, warnings)
    : undefined;
  const idValue = rawOperation.id_value
    ?? rawOperation.entity_id
    ?? rawOperation.record_id
    ?? rawOperation[idField]
    ?? record[idField]
    ?? record.id
    ?? whereRecord?.[idField]
    ?? whereRecord?.id
    ?? resolveTargetIdValue(context, collection, rawOperation)
    ?? resolveTargetIdValue(context, collection, { ...rawOperation, ...record });
  const where = getStringFromUnknown(rawOperation.where)
    || (whereRecord && idValue === undefined ? buildWhereFromRecord(context, collection, whereRecord, warnings) : "");

  if ((action === "update" || action === "delete") && (idValue === undefined || idValue === null || idValue === "") && !where) {
    throw new Error("Update/delete cần id_value hoặc where.");
  }

  const operation: PreparedOperation = {
    id: getStringFromUnknown(rawOperation.id) || `${action}_${target}_${index + 1}`,
    action,
    target,
    collection,
    label: `${action} ${target}: ${getOperationLabel(target, preparedRecord ?? record, idValue)}`,
    record: preparedRecord,
    id_value: typeof idValue === "string" || typeof idValue === "number" ? idValue : undefined,
    where
  };

  return { operation, warnings };
}

function materializeUpdateRecord(
  context: WriteContext,
  collection: string,
  rawRecord: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const record = { ...rawRecord };
  stripReferenceOnlyFields(record);
  const filtered = filterRecordByAllowedColumns(context, collection, record, warnings);
  return filtered;
}

function autoWirePreparedOperations(context: WriteContext, operations: PreparedOperation[], warnings: string[]): void {
  const firstCreatedApp = operations.find(operation => operation.action === "create" && operation.collection === "applications");
  if (!firstCreatedApp) return;

  for (const operation of operations) {
    if (operation.action !== "create" || !operation.record) continue;
    if (!["appservices", "windows", "menus", "domains", "caches", "roleapps"].includes(operation.collection)) continue;
    if (!isColumnAllowed(context, operation.collection, "appid")) continue;
    if (operation.record.appid !== undefined) continue;
    operation.record.appid = `$${firstCreatedApp.id}.appid`;
    warnings.push(`${operation.id}: tự động liên kết appid với ${firstCreatedApp.id}.appid.`);
  }
}

function extractOperationReference(operation: PreparedOperation, result: unknown): Record<string, unknown> {
  const idField = TARGET_ID_FIELD[operation.collection];
  const record: Record<string, unknown> = {};

  if (result && typeof result === "object" && !Array.isArray(result)) {
    Object.assign(record, result as Record<string, unknown>);
  } else if (Array.isArray(result) && result[0] && typeof result[0] === "object") {
    Object.assign(record, result[0] as Record<string, unknown>);
  } else if (Array.isArray(result) && result.length === 1) {
    record[idField] = result[0];
  } else if (result !== undefined && result !== null && result !== "") {
    record[idField] = result;
  }

  const maybeId = record[idField] ?? record.id ?? record.ID ?? record.Id;
  if (maybeId !== undefined && maybeId !== null && maybeId !== "") {
    record[idField] = Array.isArray(maybeId) && maybeId.length === 1 ? maybeId[0] : maybeId;
  }
  return record;
}

function resolveRecordReferences(record: Record<string, unknown>, state: ApplyState): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = resolveValueReference(value, state);
  }
  return output;
}

function resolveValueReference(value: unknown, state: ApplyState): unknown {
  if (typeof value !== "string") return value;
  const exact = value.match(/^\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/);
  if (exact) {
    return getReferenceValue(state, exact[1], exact[2]);
  }
  return resolveStringReferences(value, state);
}

function resolveStringReferences(value: unknown, state: ApplyState): string {
  if (typeof value !== "string") return "";
  return value.replace(/\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)/g, (_match, operationId: string, field: string) => {
    const resolved = getReferenceValue(state, operationId, field);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function getReferenceValue(state: ApplyState, operationId: string, field: string): unknown {
  const record = state.refs[operationId];
  if (!record) throw new Error(`Không resolve được reference $${operationId}.${field}; operation trước đó chưa có kết quả.`);
  const value = ci(record, field);
  if (value === undefined || value === null || value === "") {
    throw new Error(`Không resolve được reference $${operationId}.${field}; kết quả không có field này.`);
  }
  return value;
}

function buildOperationRequestAudit(
  context: WriteContext,
  operation: PreparedOperation,
  state: ApplyState
): Record<string, unknown> {
  const collection = context.collections[operation.collection];
  const sourceTable = asRecord(collection.source_table) ?? {};
  const endpoint = String(sourceTable.urledit ?? sourceTable.urlview ?? "");
  const idField = TARGET_ID_FIELD[operation.collection];

  if (operation.action === "create") {
    const record = resolveRecordReferences(operation.record ?? {}, state);
    return {
      method: "POST",
      collection: operation.collection,
      target: operation.target,
      endpoint: addQuery(endpoint, { returnid: "true" }),
      source_table: compactRecord(sourceTable, ["tableid", "tablename", "alias", "urledit", "urlview"]),
      record_keys: Object.keys(record),
      record_preview: compactRecord(record, Object.keys(record))
    };
  }

  if (operation.action === "update") {
    const body = resolveRecordReferences(operation.record ?? {}, state);
    const idValue = resolveValueReference(operation.id_value, state);
    if (idValue !== undefined) body[idField] = idValue;
    const where = resolveStringReferences(operation.where, state);
    return {
      method: "PUT",
      collection: operation.collection,
      target: operation.target,
      endpoint: where ? addQuery(endpoint, { where }) : addQuery(endpoint, { key: idField }),
      source_table: compactRecord(sourceTable, ["tableid", "tablename", "alias", "urledit", "urlview"]),
      id_field: idField,
      id_value: idValue,
      where,
      record_keys: Object.keys(body),
      record_preview: compactRecord(body, Object.keys(body))
    };
  }

  const where = resolveStringReferences(operation.where, state)
    || buildIdWhere(idField, resolveValueReference(operation.id_value, state));
  const hiddenMetadataCleanup = operation.collection === "applications"
    ? buildApplicationDeleteCleanupAudit(operation, state)
    : undefined;
  return {
    method: "DELETE",
    collection: operation.collection,
    target: operation.target,
    endpoint: addQuery(endpoint, { where }),
    source_table: compactRecord(sourceTable, ["tableid", "tablename", "alias", "urledit", "urlview"]),
    id_field: idField,
    id_value: operation.id_value,
    where,
    hidden_metadata_cleanup: hiddenMetadataCleanup
  };
}

async function applyOperation(
  env: Env,
  context: WriteContext,
  operation: PreparedOperation,
  state: ApplyState
): Promise<unknown> {
  const collection = context.collections[operation.collection];
  const sourceTable = asRecord(collection.source_table) ?? {};
  const endpoint = String(sourceTable.urledit ?? sourceTable.urlview ?? "");
  if (!endpoint) throw new Error(`Collection ${operation.collection} không có urledit/urlview.`);

  if (operation.action === "create") {
    const record = resolveRecordReferences(operation.record ?? {}, state);
    const envelope = await callZilcodeJson<unknown>(env, addQuery(endpoint, { returnid: "true" }), {
      method: "POST",
      token: context.session.token,
      baseUrl: context.session.base_url,
      data: [record]
    });
    return assertZilcodeSuccess(envelope);
  }

  if (operation.action === "update") {
    const idField = TARGET_ID_FIELD[operation.collection];
    const body = resolveRecordReferences(operation.record ?? {}, state);
    const idValue = resolveValueReference(operation.id_value, state);
    if (idValue !== undefined) body[idField] = idValue;
    const where = resolveStringReferences(operation.where, state);
    const targetEndpoint = where
      ? addQuery(endpoint, { where })
      : addQuery(endpoint, { key: idField });

    const envelope = await callZilcodeJson<unknown>(env, targetEndpoint, {
      method: "PUT",
      token: context.session.token,
      baseUrl: context.session.base_url,
      data: [body]
    });
    return assertZilcodeSuccess(envelope);
  }

  const where = resolveStringReferences(operation.where, state)
    || buildIdWhere(TARGET_ID_FIELD[operation.collection], resolveValueReference(operation.id_value, state));
  const hiddenMetadataCleanup = operation.collection === "applications"
    ? await cleanupApplicationMetadataBeforeDelete(env, context, operation, state)
    : undefined;
  const envelope = await callZilcodeJson<unknown>(env, addQuery(endpoint, { where }), {
    method: "DELETE",
    token: context.session.token,
    baseUrl: context.session.base_url
  });
  const deleteResult = assertZilcodeSuccess(envelope);
  return hiddenMetadataCleanup
    ? { delete_result: deleteResult, hidden_metadata_cleanup: hiddenMetadataCleanup }
    : deleteResult;
}

async function deployAffectedWindowCaches(
  env: Env,
  context: WriteContext,
  operations: PreparedOperation[],
  state: ApplyState
): Promise<Record<string, unknown>> {
  const windowIds = collectAffectedWindowIds(context, operations, state);
  const deployed: Record<string, unknown>[] = [];

  for (const windowId of windowIds) {
    const result = await deployWindowCache(env, context, windowId);
    if (result.skipped) continue;
    deployed.push(result);
  }

  return {
    deployed_count: deployed.length,
    window_ids: deployed.map(item => item.windowid),
    deployed
  };
}

function collectAffectedWindowIds(
  context: WriteContext,
  operations: PreparedOperation[],
  state: ApplyState
): string[] {
  const output = new Set<string>();

  for (const operation of operations) {
    if (operation.collection === "applications") continue;
    if (operation.collection === "caches") continue;
    if (operation.collection === "windows" && operation.action === "delete") continue;

    const windowId = getAffectedWindowId(context, operation, state);
    if (windowId) output.add(windowId);
  }

  return [...output];
}

function getAffectedWindowId(
  context: WriteContext,
  operation: PreparedOperation,
  state: ApplyState
): string | undefined {
  const record = operation.record ? resolveRecordReferences(operation.record, state) : {};
  const reference = state.refs[operation.id] ?? {};

  if (operation.collection === "windows") {
    return stringId(reference.windowid ?? record.windowid ?? operation.id_value);
  }

  if (operation.collection === "tabs") {
    const tabid = reference.tabid ?? record.tabid ?? operation.id_value;
    return stringId(record.windowid ?? reference.windowid ?? findWindowIdForTab(context, state, tabid));
  }

  if (operation.collection === "fields") {
    const fieldid = reference.fieldid ?? record.fieldid ?? operation.id_value;
    const tabid = record.tabid ?? reference.tabid ?? findTabIdForField(context, state, fieldid);
    return stringId(findWindowIdForTab(context, state, tabid));
  }

  if (operation.collection === "menus") {
    const menuid = reference.menuid ?? record.menuid ?? operation.id_value;
    return stringId(
      record.linkwindowid
      ?? record.windowid
      ?? reference.linkwindowid
      ?? reference.windowid
      ?? findWindowIdForMenu(context, state, menuid)
    );
  }

  return undefined;
}

async function deployWindowCache(
  env: Env,
  context: WriteContext,
  windowId: string
): Promise<Record<string, unknown>> {
  const windowRecord = await fetchFirstDataRecord(env, context, "windows", `windowid=${formatSqlValue(windowId)}`);
  if (!windowRecord) return { windowid: windowId, skipped: true, reason: "window_not_found" };

  const appid = ci(windowRecord, "appid");
  const cache: Record<string, unknown> = {
    window: packRecordByKeys(windowRecord, CACHE_ERD_KEYS.window)
  };

  if (!ci(windowRecord, "execname")) {
    const tabs = await fetchDataRecords(env, context, "tabs", {
      where: `windowid=${formatSqlValue(windowId)}`,
      orderby: "tablevel,seqno",
      limit: 1000
    });
    cache.tabs = tabs.map(tab => packRecordByKeys(tab, CACHE_ERD_KEYS.tab));

    const fields = await fetchDataRecords(env, context, "field_columns", {
      fallbackPath: "rest/applicationjs_nut/dbo/data/nv_field_column",
      where: `windowid=${formatSqlValue(windowId)}`,
      orderby: "tabid,fieldgroup,seqno",
      limit: 5000
    });
    cache.fields = fields.map(field => packRecordByKeys(field, CACHE_ERD_KEYS.field));

    const menus = await fetchDataRecords(env, context, "menus", {
      where: `windowid=${formatSqlValue(windowId)} AND menutype=N'tool'`,
      orderby: "seqno",
      limit: 1000
    });
    cache.menus = menus.map(menu => packRecordByKeys(menu, CACHE_ERD_KEYS.menu));
  }

  const configjson = zipson.stringify(cache);
  const existingCache = await fetchFirstDataRecord(env, context, "caches", `windowid=${formatSqlValue(windowId)}`);
  const cachePayload: Record<string, unknown> = { configjson };
  let action = "update";

  if (existingCache) {
    await writeDataRecords(env, context, "caches", "PUT", [cachePayload], `windowid=${formatSqlValue(windowId)}`);
  } else {
    action = "insert";
    cachePayload.windowid = windowId;
    cachePayload.appid = appid;
    cachePayload.siteid = inferSessionSiteId(context.session)
      ?? ci(windowRecord, "siteid")
      ?? inferExistingValue(context.recordsByCollection.caches ?? [], "siteid")
      ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid");
    await writeDataRecords(env, context, "caches", "POST", [cachePayload], undefined, { returnid: "true" });
  }

  return {
    windowid: windowId,
    appid,
    action,
    configjson_chars: configjson.length,
    counts: {
      tabs: Array.isArray(cache.tabs) ? cache.tabs.length : 0,
      fields: Array.isArray(cache.fields) ? cache.fields.length : 0,
      tool_menus: Array.isArray(cache.menus) ? cache.menus.length : 0
    }
  };
}

async function fetchFirstDataRecord(
  env: Env,
  context: WriteContext,
  collection: string,
  where: string
): Promise<Record<string, unknown> | undefined> {
  return (await fetchDataRecords(env, context, collection, { where, limit: 1 }))[0];
}

async function fetchDataRecords(
  env: Env,
  context: WriteContext,
  collection: string,
  options: {
    where?: string;
    orderby?: string;
    limit?: number;
    fallbackPath?: string;
  }
): Promise<Record<string, unknown>[]> {
  const collectionMeta = context.collections[collection];
  const sourceTable = asRecord(collectionMeta?.source_table) ?? {};
  const endpoint = String(sourceTable.urlview ?? sourceTable.urledit ?? options.fallbackPath ?? "");
  if (!endpoint) return [];

  const envelope = await callZilcodeJson<unknown>(env, addQuery(endpoint, {
    where: options.where,
    orderby: options.orderby,
    limit: options.limit === undefined ? undefined : String(options.limit)
  }), {
    token: context.session.token,
    baseUrl: context.session.base_url,
    headers: options.limit ? {
      Range: `0-${Math.max(0, options.limit - 1)}`,
      Prefer: "count=exact"
    } : undefined
  });

  return toArrayValues(assertZilcodeSuccess(envelope))
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object");
}

async function writeDataRecords(
  env: Env,
  context: WriteContext,
  collection: string,
  method: "POST" | "PUT",
  records: Record<string, unknown>[],
  where?: string,
  query: Record<string, string> = {}
): Promise<unknown> {
  const collectionMeta = context.collections[collection];
  const sourceTable = asRecord(collectionMeta?.source_table) ?? {};
  const endpoint = String(sourceTable.urledit ?? sourceTable.urlview ?? "");
  if (!endpoint) throw new Error(`Collection ${collection} không có endpoint để ghi cache.`);

  const envelope = await callZilcodeJson<unknown>(env, addQuery(endpoint, { ...query, where }), {
    method,
    token: context.session.token,
    baseUrl: context.session.base_url,
    data: records
  });
  return assertZilcodeSuccess(envelope);
}

function packRecordByKeys(record: Record<string, unknown>, keys: string[]): unknown[] {
  return keys.map(key => ci(record, key) ?? null);
}

function findTabIdForField(context: WriteContext, state: ApplyState, fieldid: unknown): unknown {
  if (!hasUsableValue(fieldid)) return undefined;
  const stateField = findRefById(state, "fieldid", fieldid);
  if (stateField && hasUsableValue(stateField.tabid)) return stateField.tabid;
  return ci((context.recordsByCollection.fields ?? []).find(field => sameId(ci(field, "fieldid"), fieldid)) ?? {}, "tabid");
}

function findWindowIdForTab(context: WriteContext, state: ApplyState, tabid: unknown): unknown {
  if (!hasUsableValue(tabid)) return undefined;
  const stateTab = findRefById(state, "tabid", tabid);
  if (stateTab && hasUsableValue(stateTab.windowid)) return stateTab.windowid;
  return ci((context.recordsByCollection.tabs ?? []).find(tab => sameId(ci(tab, "tabid"), tabid)) ?? {}, "windowid");
}

function findWindowIdForMenu(context: WriteContext, state: ApplyState, menuid: unknown): unknown {
  if (!hasUsableValue(menuid)) return undefined;
  const stateMenu = findRefById(state, "menuid", menuid);
  if (stateMenu && (hasUsableValue(stateMenu.linkwindowid) || hasUsableValue(stateMenu.windowid))) {
    return stateMenu.linkwindowid ?? stateMenu.windowid;
  }
  const menu = (context.recordsByCollection.menus ?? []).find(item => sameId(ci(item, "menuid"), menuid));
  return menu ? ci(menu, "linkwindowid") ?? ci(menu, "windowid") : undefined;
}

function findRefById(state: ApplyState, idField: string, idValue: unknown): Record<string, unknown> | undefined {
  return Object.values(state.refs).find(record => sameId(ci(record, idField), idValue));
}

function stringId(value: unknown): string | undefined {
  return hasUsableValue(value) ? String(value) : undefined;
}

function buildApplicationDeleteCleanupAudit(
  operation: PreparedOperation,
  state: ApplyState
): Record<string, unknown> | undefined {
  const appIdText = getNumericAppIdText(resolveDeleteApplicationId(operation, state));
  if (!appIdText) {
    return {
      status: "skipped",
      reason: "Không resolve được appid số từ id_value/where nên không thể cleanup metadata ẩn trước delete_app."
    };
  }

  return {
    status: "will_run_before_delete_app",
    appid: appIdText,
    fixed_order: ["n_cache", "n_field", "n_tab", "n_rolemenu", "n_menu", "n_roleapp", "n_appservice", "n_domain", "n_window"],
    note: "Dùng query endpoint để dọn metadata có thể bị ẩn khỏi data endpoint, vì FK/cache/role/menu/window vẫn chặn xóa n_app."
  };
}

async function cleanupApplicationMetadataBeforeDelete(
  env: Env,
  context: WriteContext,
  operation: PreparedOperation,
  state: ApplyState
): Promise<Record<string, unknown> | undefined> {
  const appIdText = getNumericAppIdText(resolveDeleteApplicationId(operation, state));
  if (!appIdText) return undefined;

  const endpoint = getZilcodeQueryEndpoint(context, "applications");
  const statements = buildDeleteApplicationMetadataStatements(context, appIdText);
  const results: Record<string, unknown>[] = [];

  for (const statement of statements) {
    const envelope = await callZilcodeJson<unknown>(env, endpoint, {
      method: "PUT",
      token: context.session.token,
      baseUrl: context.session.base_url,
      data: { body: statement.sql }
    });
    const result = assertZilcodeSuccess(envelope);
    results.push({
      label: statement.label,
      ok: true,
      result: summarizeCleanupQueryResult(result)
    });
  }

  return {
    appid: appIdText,
    query_endpoint: endpoint,
    statements_count: statements.length,
    results
  };
}

function resolveDeleteApplicationId(operation: PreparedOperation, state: ApplyState): unknown {
  const idValue = resolveValueReference(operation.id_value, state);
  if (hasUsableValue(idValue)) return idValue;
  return extractNumericIdFromSimpleWhere(resolveStringReferences(operation.where, state), "appid");
}

function getNumericAppIdText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : undefined;
}

function extractNumericIdFromSimpleWhere(where: string, field: string): string | undefined {
  const normalizedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const equalsMatch = where.match(new RegExp(`^\\s*${normalizedField}\\s*=\\s*(\\d+)\\s*$`, "i"));
  if (equalsMatch) return equalsMatch[1];
  const inMatch = where.match(new RegExp(`^\\s*${normalizedField}\\s+IN\\s*\\(\\s*(\\d+)\\s*\\)\\s*$`, "i"));
  return inMatch?.[1];
}

function buildDeleteApplicationMetadataStatements(
  context: WriteContext,
  appIdText: string
): Array<{ label: string; sql: string }> {
  const cachesTable = getSqlTableName(context, "caches", "n_cache");
  const fieldsTable = getSqlTableName(context, "fields", "n_field");
  const tabsTable = getSqlTableName(context, "tabs", "n_tab");
  const rolemenusTable = getSqlTableName(context, "rolemenus", "n_rolemenu");
  const menusTable = getSqlTableName(context, "menus", "n_menu");
  const roleappsTable = getSqlTableName(context, "roleapps", "n_roleapp");
  const appservicesTable = getSqlTableName(context, "appservices", "n_appservice");
  const domainsTable = getSqlTableName(context, "domains", "n_domain");
  const windowsTable = getSqlTableName(context, "windows", "n_window");
  const appidColumn = getSqlColumnName("appid");
  const tabidColumn = getSqlColumnName("tabid");
  const menuidColumn = getSqlColumnName("menuid");
  const windowidColumn = getSqlColumnName("windowid");
  const windowSubquery = `SELECT ${windowidColumn} FROM ${windowsTable} WHERE ${appidColumn}=${appIdText}`;
  const tabSubquery = `SELECT ${tabidColumn} FROM ${tabsTable} WHERE ${windowidColumn} IN (${windowSubquery})`;
  const menuClauses: string[] = [];
  const cacheClauses: string[] = [];

  if (isColumnAllowed(context, "menus", "appid")) {
    menuClauses.push(`${appidColumn}=${appIdText}`);
  }
  for (const linkColumn of getMenuWindowLinkColumns(context)) {
    menuClauses.push(`${getSqlColumnName(linkColumn)} IN (${windowSubquery})`);
  }

  if (isColumnAllowed(context, "caches", "appid")) {
    cacheClauses.push(`${appidColumn}=${appIdText}`);
  }
  if (isColumnAllowed(context, "caches", "windowid")) {
    cacheClauses.push(`${windowidColumn} IN (${windowSubquery})`);
  }

  const menuWhere = menuClauses.length ? menuClauses.join(" OR ") : "";
  const menuSubquery = menuWhere ? `SELECT ${menuidColumn} FROM ${menusTable} WHERE ${menuWhere}` : "";
  const statements: Array<{ label: string; sql: string }> = [];

  if (cacheClauses.length) {
    statements.push({
      label: "delete generated cache linked to app/windows",
      sql: `DELETE FROM ${cachesTable} WHERE ${cacheClauses.join(" OR ")}`
    });
  }

  statements.push(
    {
      label: "delete fields of app windows",
      sql: `DELETE FROM ${fieldsTable} WHERE ${tabidColumn} IN (${tabSubquery})`
    },
    {
      label: "delete tabs of app windows",
      sql: `DELETE FROM ${tabsTable} WHERE ${windowidColumn} IN (${windowSubquery})`
    }
  );

  if (menuSubquery) {
    statements.push({
      label: "delete role-menu permissions linked to app menus",
      sql: `DELETE FROM ${rolemenusTable} WHERE ${menuidColumn} IN (${menuSubquery})`
    });
  }

  if (menuClauses.length) {
    statements.push({
      label: "delete menus linked to app/windows",
      sql: `DELETE FROM ${menusTable} WHERE ${menuWhere}`
    });
  }

  if (isColumnAllowed(context, "roleapps", "appid")) {
    statements.push({
      label: "delete role-app permissions linked to app",
      sql: `DELETE FROM ${roleappsTable} WHERE ${appidColumn}=${appIdText}`
    });
  }

  if (isColumnAllowed(context, "appservices", "appid")) {
    statements.push({
      label: "delete app-service links",
      sql: `DELETE FROM ${appservicesTable} WHERE ${appidColumn}=${appIdText}`
    });
  }

  if (isColumnAllowed(context, "domains", "appid")) {
    statements.push({
      label: "delete domains linked to app",
      sql: `DELETE FROM ${domainsTable} WHERE ${appidColumn}=${appIdText}`
    });
  }

  statements.push({
    label: "delete windows of app",
    sql: `DELETE FROM ${windowsTable} WHERE ${appidColumn}=${appIdText}`
  });

  return statements;
}

function getZilcodeQueryEndpoint(context: WriteContext, collection: string): string {
  const collectionMeta = context.collections[collection] ?? context.collections.applications;
  const sourceTable = asRecord(collectionMeta?.source_table) ?? {};
  const endpoint = String(sourceTable.urledit ?? sourceTable.urlview ?? "");
  const match = endpoint.match(/^(.*?rest\/[^/]+\/[^/]+)\/data(?:\/|$)/i);
  return match ? `${match[1]}/query` : "rest/applicationjs_nut/dbo/query";
}

function getSqlTableName(context: WriteContext, collection: string, fallback: string): string {
  const collectionMeta = context.collections[collection];
  const sourceTable = asRecord(collectionMeta?.source_table) ?? {};
  return getSqlIdentifier(String(ci(sourceTable, "tablename") ?? fallback), fallback);
}

function getSqlColumnName(column: string): string {
  return getSqlIdentifier(column, column);
}

function getSqlIdentifier(value: string, fallback: string): string {
  const text = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) ? text : fallback;
}

function summarizeCleanupQueryResult(result: unknown): unknown {
  if (Array.isArray(result)) {
    return { rows: result.length };
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    return compactRecord(record, ["rowsAffected", "affectedRows", "count", "message"]);
  }
  return result ?? null;
}

function getRawOperations(args: Record<string, unknown>): Record<string, unknown>[] {
  const plan = asRecord(args.plan);
  const operations = args.operations ?? plan?.operations ?? args.changes ?? plan?.changes;
  if (Array.isArray(operations)) {
    return operations.filter((operation): operation is Record<string, unknown> =>
      Boolean(operation) && typeof operation === "object" && !Array.isArray(operation)
    );
  }

  if (plan) {
    const structured = buildOperationsFromStructuredPlan(plan);
    if (structured.length) return structured;
  }

  const single = asRecord(args.operation) ?? plan;
  return single ? [single] : [];
}

function normalizeRawOperations(
  rawOperations: Record<string, unknown>[],
  warnings: string[]
): Record<string, unknown>[] {
  const counters: Record<string, number> = {};
  const referenceAliases: Record<string, string> = {};
  const normalized = rawOperations.map(rawOperation => {
    const op = getOperationName(rawOperation);
    const action = getAction(op);
    const target = getTarget(op, rawOperation);
    const canonicalOp = `${action}_${target}`;
    const counterKey = canonicalOp;
    counters[counterKey] = (counters[counterKey] ?? 0) + 1;

    const originalId = getStringFromUnknown(rawOperation.id);
    const oldImplicitId = `${op}_${counters[counterKey]}`;
    const canonicalId = canonicalizeOperationId(originalId || oldImplicitId, canonicalOp, counters[counterKey]);
    referenceAliases[oldImplicitId] = canonicalId;
    if (originalId) referenceAliases[originalId] = canonicalId;

    const explicitRecord = getExplicitOperationRecord(rawOperation);
    const recordSource = explicitRecord ?? stripOperationFields(rawOperation);
    const record = normalizeRecordAliases(target, recordSource, warnings);

    return {
      ...rawOperation,
      id: canonicalId,
      op: canonicalOp,
      record
    };
  });

  return normalized.map(operation => rewriteOperationReferences(operation, referenceAliases));
}

function canonicalizeOperationId(id: string, canonicalOp: string, index: number): string {
  const normalized = id.trim();
  if (!normalized) return `${canonicalOp}_${index}`;
  return normalized
    .replace(/^add_/, "create_")
    .replace(/^edit_/, "update_")
    .replace(/^rename_/, "update_")
    .replace(/^remove_/, "delete_");
}

function normalizeRecordAliases(
  target: string,
  record: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(record)) {
    output[normalizeRecordKey(target, rawKey, warnings)] = value;
  }
  return output;
}

function getOperationRecordPayload(
  target: string,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const explicitRecord = getExplicitOperationRecord(rawOperation);
  return normalizeRecordAliases(
    target,
    explicitRecord ?? stripOperationFields(rawOperation),
    warnings
  );
}

function getExplicitOperationRecord(rawOperation: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(rawOperation.record)
    ?? asRecord(rawOperation.fields)
    ?? asRecord(rawOperation.updates)
    ?? asRecord(rawOperation.set)
    ?? asRecord(rawOperation.values)
    ?? asRecord(rawOperation.data);
}

function normalizeRecordKey(target: string, key: string, warnings: string[]): string {
  const normalized = key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const common: Record<string, string> = {
    app_id: "appid",
    application_id: "appid",
    app_name: "app_name",
    application_name: "application_name",
    service_id: "serviceid",
    service_name: "servicename",
    appservice_id: "appserviceid",
    app_service_id: "appserviceid",
    table_id: "tableid",
    table_name: "tablename",
    column_id: "columnid",
    column_name: "columnname",
    data_type: "datatype",
    column_type: "columntype",
    window_id: "windowid",
    window_name: "windowname",
    tab_id: "tabid",
    tab_name: "tabname",
    field_id: "fieldid",
    field_name: "fieldname",
    menu_id: "menuid",
    menu_name: "menuname",
    domain_id: "domainid",
    domain_name: "domainname",
    cache_id: "cacheid",
    role_id: "roleid",
    roleapp_id: "roleappid",
    role_app_id: "roleappid",
    rolemenu_id: "rolemenuid",
    role_menu_id: "rolemenuid",
    access_id: "accessid",
    archive_id: "archiveid",
    target_window_id: "linkwindowid",
    link_window_id: "linkwindowid",
    parent_menu_id: "parentid",
    parent_tab_id: "parenttabid",
    display_name: "translate",
    label: "translate",
    title: "translate"
  };

  const targetSpecific: Record<string, Record<string, string>> = {
    app: {
      name: "appname",
      app_name: "appname",
      application_name: "appname"
    },
    column: {
      is_primary: "isprimarykey",
      is_primary_key: "isprimarykey",
      primary_key: "isprimarykey",
      is_required: "isrequired",
      required: "isrequired",
      default: "defaultvalue",
      default_value: "defaultvalue"
    },
    field: {
      is_required: "isrequire",
      required: "isrequire",
      readonly: "isreadonly",
      is_readonly: "isreadonly",
      control_type: "controltype",
      field_type: "fieldtype",
      default: "defaultvalue",
      default_value: "defaultvalue"
    },
    table: {
      table_type: "tabletype",
      display_column: "columndisplay",
      key_column: "columnkey",
      code_column: "columncode",
      find_column: "columnfind"
    },
    window: {
      window_type: "windowtype"
    }
  };

  const mapped = targetSpecific[target]?.[normalized] ?? common[normalized] ?? key;
  if (mapped !== key) warnings.push(`Chuẩn hóa field ${key} -> ${mapped}.`);
  return mapped;
}

function rewriteOperationReferences(
  operation: Record<string, unknown>,
  referenceAliases: Record<string, string>
): Record<string, unknown> {
  return rewriteUnknownReferences(operation, referenceAliases) as Record<string, unknown>;
}

function rewriteUnknownReferences(value: unknown, referenceAliases: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$([A-Za-z0-9_-]+)\./g, (match, operationId: string) => {
      const canonical = referenceAliases[operationId];
      return canonical ? `$${canonical}.` : match;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => rewriteUnknownReferences(item, referenceAliases));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = rewriteUnknownReferences(item, referenceAliases);
    }
    return output;
  }

  return value;
}

function expandRawOperations(
  context: WriteContext,
  rawOperations: Record<string, unknown>[],
  warnings: string[]
): Record<string, unknown>[] {
  const expanded: Record<string, unknown>[] = [];

  for (const rawOperation of rawOperations) {
    const op = getOperationName(rawOperation);
    const action = getAction(op);
    const target = getTarget(op, rawOperation);
    const cascade = getBooleanLike(rawOperation.cascade)
      || getBooleanLike(rawOperation.include_children)
      || getBooleanLike(rawOperation.delete_children);

    if (action === "delete" && target === "window" && cascade) {
      expanded.push(...buildDeleteWindowCascadeOperations(context, rawOperation, warnings));
      continue;
    }

    if (action === "delete" && target === "tab" && cascade) {
      expanded.push(...buildDeleteTabCascadeOperations(context, rawOperation, warnings));
      continue;
    }

    if (action === "delete" && target === "column" && cascade) {
      expanded.push(...buildDeleteColumnCascadeOperations(context, rawOperation, warnings));
      continue;
    }

    if (action === "delete" && target === "table" && cascade) {
      expanded.push(...buildDeleteTableCascadeOperations(context, rawOperation, warnings));
      continue;
    }

    if (action === "delete" && target === "app") {
      expanded.push(...buildDeleteAppCascadeOperations(context, rawOperation, warnings));
      continue;
    }

    if (action === "create" && target === "tab" && wantsAutoCreateFields(rawOperation)) {
      expanded.push(...buildCreateTabWithFieldsOperations(context, rawOperation, warnings));
      continue;
    }

    expanded.push(rawOperation);
  }

  return dedupeRawOperations(expanded);
}

function wantsAutoCreateFields(rawOperation: Record<string, unknown>): boolean {
  const record = asRecord(rawOperation.record) ?? rawOperation;
  return getBooleanLike(record.create_fields)
    || getBooleanLike(record.include_fields)
    || getBooleanLike(record.fields_from_table)
    || getBooleanLike(rawOperation.create_fields)
    || getBooleanLike(rawOperation.include_fields);
}

function buildCreateTabWithFieldsOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const record = { ...(asRecord(rawOperation.record) ?? stripOperationFields(rawOperation)) };
  delete record.create_fields;
  delete record.include_fields;
  delete record.fields_from_table;

  const tableRef = record.tableid ?? record.table_ref ?? record.table_name ?? record.table ?? record.tablename;
  if (!hasUsableValue(tableRef)) {
    throw new Error("create_tab create_fields=true can tableid/table_name de lay danh sach column.");
  }

  const appid = record.appid ?? resolveInlineAppReference(context, record);
  const tableid = isReferenceValue(tableRef)
    ? tableRef
    : findUniqueRecordId(context, "tables", String(tableRef), { appid });
  if (!hasUsableValue(tableid)) {
    throw new Error(`Không tìm thấy table để tạo fields từ table: ${String(tableRef)}.`);
  }

  record.tableid = tableid;
  const tabOperationId = getStringFromUnknown(rawOperation.id) || "create_tab_1";
  const operations: Record<string, unknown>[] = [
    {
      ...rawOperation,
      id: tabOperationId,
      op: "create_tab",
      record
    }
  ];

  if (isReferenceValue(tableid)) {
    warnings.push(`${tabOperationId}: tableid là reference nên chưa thể tự bung field theo column hiện có.`);
    return operations;
  }

  const columns = (context.recordsByCollection.columns ?? [])
    .filter(column => sameId(ci(column, "tableid"), tableid))
    .sort((left, right) => Number(ci(left, "seqno") ?? 0) - Number(ci(right, "seqno") ?? 0));

  if (!columns.length) {
    warnings.push(`${tabOperationId}: table ${String(tableid)} chưa có column nào để tự tạo field.`);
    return operations;
  }

  columns.forEach((column, index) => {
    const columnid = ci(column, "columnid");
    const columnname = ci(column, "columnname");
    if (!hasUsableValue(columnid) || !hasUsableValue(columnname)) return;
    operations.push({
      id: `${tabOperationId}_field_${String(columnid)}`,
      op: "create_field",
      record: {
        tabid: `$${tabOperationId}.tabid`,
        columnid,
        fieldname: columnname,
        seqno: index + 1
      }
    });
  });

  warnings.push(`${tabOperationId}: tu tao ${operations.length - 1} field tu cac column cua table ${String(tableid)}.`);
  return operations;
}

function buildDeleteWindowCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const windowId = getDeleteIdValue(rawOperation, "windowid");
  if (windowId === undefined || windowId === null || windowId === "") {
    throw new Error("delete_window cascade thiếu windowid/id_value.");
  }

  const windowIdText = String(windowId);
  const tabs = (context.recordsByCollection.tabs ?? [])
    .filter(tab => sameId(ci(tab, "windowid"), windowIdText));
  const tabIds = new Set(tabs.map(tab => String(ci(tab, "tabid") ?? "")).filter(Boolean));
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field => tabIds.has(String(ci(field, "tabid") ?? "")));
  const menus = (context.recordsByCollection.menus ?? [])
    .filter(menu => sameId(ci(menu, "linkwindowid") ?? ci(menu, "windowid"), windowIdText));
  const menuIds = new Set(menus.map(menu => String(ci(menu, "menuid") ?? "")).filter(Boolean));
  const caches = (context.recordsByCollection.caches ?? [])
    .filter(cache => sameId(ci(cache, "windowid"), windowIdText));
  const rolemenus = (context.recordsByCollection.rolemenus ?? [])
    .filter(rolemenu => menuIds.has(String(ci(rolemenu, "menuid") ?? "")));

  warnings.push(
    `delete_window cascade windowid=${windowIdText}: sẽ xóa ${caches.length} cache, ${fields.length} field, ${tabs.length} tab, ${rolemenus.length} rolemenu, ${menus.length} menu liên kết và window. Không xóa table/column/dữ liệu thật.`
  );

  const operations: Record<string, unknown>[] = [];
  for (const cache of caches) {
    const cacheId = ci(cache, "cacheid");
    if (cacheId === undefined || cacheId === null || cacheId === "") continue;
    operations.push({
      id: `delete_cache_${cacheId}`,
      op: "delete_cache",
      id_value: cacheId
    });
  }

  for (const field of fields) {
    const fieldId = ci(field, "fieldid");
    if (fieldId === undefined || fieldId === null || fieldId === "") continue;
    operations.push({
      id: `delete_field_${fieldId}`,
      op: "delete_field",
      id_value: fieldId
    });
  }

  for (const tab of tabs) {
    const tabId = ci(tab, "tabid");
    if (tabId === undefined || tabId === null || tabId === "") continue;
    operations.push({
      id: `delete_tab_${tabId}`,
      op: "delete_tab",
      id_value: tabId
    });
  }

  for (const rolemenu of rolemenus) {
    const rolemenuId = ci(rolemenu, "rolemenuid");
    if (rolemenuId === undefined || rolemenuId === null || rolemenuId === "") continue;
    operations.push({
      id: `delete_rolemenu_${rolemenuId}`,
      op: "delete_rolemenu",
      id_value: rolemenuId
    });
  }

  for (const menu of menus) {
    const menuId = ci(menu, "menuid");
    if (menuId === undefined || menuId === null || menuId === "") continue;
    operations.push({
      id: `delete_menu_${menuId}`,
      op: "delete_menu",
      id_value: menuId
    });
  }

  operations.push({
    id: `delete_window_${windowIdText}`,
    op: "delete_window",
    id_value: windowId
  });

  const includeRelated = rawOperation.include_related;
  if (Array.isArray(includeRelated)) {
    const unsupported = includeRelated
      .map(item => String(item))
      .filter(item => !["tab", "tabs", "field", "fields", "menu", "menus", "cache", "caches", "rolemenu", "rolemenus"].includes(item.toLowerCase()));
    if (unsupported.length) {
      warnings.push(`Chưa hỗ trợ tự động xóa related metadata ngoài window/tab/field/menu/cache/rolemenu: ${unsupported.join(", ")}.`);
    }
  }

  return operations;
}

function buildDeleteTabCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const tabId = getDeleteIdValue(rawOperation, "tabid");
  if (tabId === undefined || tabId === null || tabId === "") {
    throw new Error("delete_tab cascade thiếu tabid/id_value.");
  }

  const tabIdText = String(tabId);
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field => sameId(ci(field, "tabid"), tabIdText));

  warnings.push(
    `delete_tab cascade tabid=${tabIdText}: sẽ xóa ${fields.length} field liên kết trước khi xóa tab. Không xóa table/column/dữ liệu thật.`
  );

  const operations: Record<string, unknown>[] = [];
  for (const field of fields) {
    const fieldId = ci(field, "fieldid");
    if (fieldId === undefined || fieldId === null || fieldId === "") continue;
    operations.push({
      id: `delete_tab_${tabIdText}_field_${String(fieldId)}`,
      op: "delete_field",
      id_value: fieldId
    });
  }

  operations.push({
    id: `delete_tab_${tabIdText}`,
    op: "delete_tab",
    id_value: tabId
  });

  return operations;
}

function buildDeleteColumnCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const columnId = getDeleteIdValue(rawOperation, "columnid");
  if (columnId === undefined || columnId === null || columnId === "") {
    throw new Error("delete_column cascade thieu columnid/id_value.");
  }

  const columnIdText = String(columnId);
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field => sameId(ci(field, "columnid"), columnIdText));

  warnings.push(
    `delete_column cascade columnid=${columnIdText}: se xoa ${fields.length} field dang dung column truoc khi xoa column. Khong xoa table/du lieu that.`
  );

  const operations: Record<string, unknown>[] = [];
  if (isColumnAllowed(context, "fields", "columnid")) {
    operations.push({
      id: `delete_column_${columnIdText}_fields`,
      op: "delete_field",
      where: buildIdWhere("columnid", columnId)
    });
  }

  operations.push({
    id: `delete_column_${columnIdText}`,
    op: "delete_column",
    id_value: columnId
  });

  return operations;
}

function buildDeleteTableCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const tableId = getDeleteIdValue(rawOperation, "tableid");
  if (tableId === undefined || tableId === null || tableId === "") {
    throw new Error("delete_table cascade thieu tableid/id_value.");
  }

  const tableIdText = String(tableId);
  const tableWhere = buildIdWhere("tableid", tableId);
  const tabClauses = buildAllowedIdClauses(context, "tabs", ["tableid", "linktableid", "relatetableid"], tableId);
  const tabWhere = tabClauses.join(" OR ");
  const tabSubquery = tabWhere ? `SELECT tabid FROM n_tab WHERE ${tabWhere}` : "";
  const columnSubquery = `SELECT columnid FROM n_column WHERE ${tableWhere}`;

  const columns = (context.recordsByCollection.columns ?? [])
    .filter(column => sameId(ci(column, "tableid"), tableIdText));
  const columnIds = new Set(columns.map(column => String(ci(column, "columnid") ?? "")).filter(Boolean));
  const tabs = (context.recordsByCollection.tabs ?? [])
    .filter(tab => tabClauses.some(clause => {
      const [columnName] = clause.split("=");
      return sameId(ci(tab, columnName.trim()), tableIdText);
    }));
  const tabIds = new Set(tabs.map(tab => String(ci(tab, "tabid") ?? "")).filter(Boolean));
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field =>
      columnIds.has(String(ci(field, "columnid") ?? ""))
      || tabIds.has(String(ci(field, "tabid") ?? ""))
    );
  const accesses = (context.recordsByCollection.accesses ?? [])
    .filter(access => sameId(ci(access, "tableid"), tableIdText));
  const archives = (context.recordsByCollection.archives ?? [])
    .filter(archive => sameId(ci(archive, "tableid"), tableIdText));

  warnings.push(
    `delete_table cascade tableid=${tableIdText}: se xoa metadata lien quan (${fields.length} field, ${tabs.length} tab, ${accesses.length} access, ${archives.length} archive, ${columns.length} column) truoc khi xoa table. Khong xoa du lieu vat ly.`
  );

  const operations: Record<string, unknown>[] = [];
  const fieldClauses: string[] = [];
  if (isColumnAllowed(context, "fields", "tabid") && tabSubquery) {
    fieldClauses.push(`tabid IN (${tabSubquery})`);
  }
  if (isColumnAllowed(context, "fields", "columnid")) {
    fieldClauses.push(`columnid IN (${columnSubquery})`);
  }
  if (fieldClauses.length) {
    operations.push({
      id: `delete_table_${tableIdText}_fields`,
      op: "delete_field",
      where: fieldClauses.join(" OR ")
    });
  }

  if (tabWhere) {
    operations.push({
      id: `delete_table_${tableIdText}_tabs`,
      op: "delete_tab",
      where: tabWhere
    });
  }

  if (context.collections.accesses && isColumnAllowed(context, "accesses", "tableid")) {
    operations.push({
      id: `delete_table_${tableIdText}_accesses`,
      op: "delete_access",
      where: tableWhere
    });
  }

  if (context.collections.archives && isColumnAllowed(context, "archives", "tableid")) {
    operations.push({
      id: `delete_table_${tableIdText}_archives`,
      op: "delete_archive",
      where: tableWhere
    });
  }

  if (isColumnAllowed(context, "columns", "tableid")) {
    operations.push({
      id: `delete_table_${tableIdText}_columns`,
      op: "delete_column",
      where: tableWhere
    });
  }

  operations.push({
    id: `delete_table_${tableIdText}`,
    op: "delete_table",
    id_value: tableId
  });

  return operations;
}

function buildAllowedIdClauses(
  context: WriteContext,
  collection: string,
  columns: string[],
  idValue: unknown
): string[] {
  return columns
    .filter(column => isColumnAllowed(context, collection, column))
    .map(column => `${column}=${formatSqlValue(idValue)}`);
}

function buildDeleteAppCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const appId = getDeleteIdValue(rawOperation, "appid");
  if (appId === undefined || appId === null || appId === "") {
    throw new Error("delete_app thiếu appid/id_value.");
  }

  const appIdText = String(appId);
  const appWhere = buildIdWhere("appid", appId);
  const windowSubquery = `SELECT windowid FROM n_window WHERE ${appWhere}`;
  const tabSubquery = `SELECT tabid FROM n_tab WHERE windowid IN (${windowSubquery})`;
  const menuLinkColumns = getMenuWindowLinkColumns(context);
  const menuClauses = [`appid=${formatSqlValue(appId)}`];
  for (const linkColumn of menuLinkColumns) {
    menuClauses.push(`${linkColumn} IN (${windowSubquery})`);
  }

  const windows = (context.recordsByCollection.windows ?? [])
    .filter(window => sameId(ci(window, "appid"), appIdText));
  const windowIds = new Set(windows.map(window => String(ci(window, "windowid") ?? "")).filter(Boolean));
  const tabs = (context.recordsByCollection.tabs ?? [])
    .filter(tab => windowIds.has(String(ci(tab, "windowid") ?? "")));
  const tabIds = new Set(tabs.map(tab => String(ci(tab, "tabid") ?? "")).filter(Boolean));
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field => tabIds.has(String(ci(field, "tabid") ?? "")));
  const menus = (context.recordsByCollection.menus ?? [])
    .filter(menu =>
      sameId(ci(menu, "appid"), appIdText)
      || windowIds.has(String(ci(menu, "linkwindowid") ?? ci(menu, "windowid") ?? ""))
    );
  const menuIds = new Set(menus.map(menu => String(ci(menu, "menuid") ?? "")).filter(Boolean));
  const caches = (context.recordsByCollection.caches ?? [])
    .filter(cache =>
      sameId(ci(cache, "appid"), appIdText)
      || windowIds.has(String(ci(cache, "windowid") ?? ""))
    );
  const rolemenus = (context.recordsByCollection.rolemenus ?? [])
    .filter(rolemenu => menuIds.has(String(ci(rolemenu, "menuid") ?? "")));
  const roleapps = (context.recordsByCollection.roleapps ?? [])
    .filter(roleapp => sameId(ci(roleapp, "appid"), appIdText));
  const appservices = (context.recordsByCollection.appservices ?? [])
    .filter(appservice => sameId(ci(appservice, "appid"), appIdText));
  const domains = (context.recordsByCollection.domains ?? [])
    .filter(domain => sameId(ci(domain, "appid"), appIdText));
  const menuWhere = menuClauses.join(" OR ");
  const menuSubquery = `SELECT menuid FROM n_menu WHERE ${menuWhere}`;

  warnings.push(
    `delete_app cascade appid=${appIdText}: sẽ xóa UI/access metadata liên quan trước app (${caches.length} cache, ${fields.length} field, ${tabs.length} tab, ${rolemenus.length} rolemenu, ${menus.length} menu, ${roleapps.length} roleapp, ${appservices.length} appservice, ${domains.length} domain, ${windows.length} window đã đọc được). Không xóa table/column/dữ liệu thật.`
  );

  return [
    {
      id: `delete_app_${appIdText}_caches`,
      op: "delete_cache",
      where: `appid=${formatSqlValue(appId)} OR windowid IN (${windowSubquery})`
    },
    {
      id: `delete_app_${appIdText}_fields`,
      op: "delete_field",
      where: `tabid IN (${tabSubquery})`
    },
    {
      id: `delete_app_${appIdText}_tabs`,
      op: "delete_tab",
      where: `windowid IN (${windowSubquery})`
    },
    {
      id: `delete_app_${appIdText}_rolemenus`,
      op: "delete_rolemenu",
      where: `menuid IN (${menuSubquery})`
    },
    {
      id: `delete_app_${appIdText}_menus`,
      op: "delete_menu",
      where: menuWhere
    },
    {
      id: `delete_app_${appIdText}_roleapps`,
      op: "delete_roleapp",
      where: appWhere
    },
    {
      id: `delete_app_${appIdText}_appservices`,
      op: "delete_appservice",
      where: appWhere
    },
    {
      id: `delete_app_${appIdText}_domains`,
      op: "delete_domain",
      where: appWhere
    },
    {
      id: `delete_app_${appIdText}_windows`,
      op: "delete_window",
      where: appWhere
    },
    {
      id: `delete_app_${appIdText}`,
      op: "delete_app",
      id_value: appId
    }
  ];
}

function dedupeRawOperations(operations: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const output: Record<string, unknown>[] = [];

  for (const operation of operations) {
    const op = getStringFromUnknown(operation.op ?? operation.action ?? operation.type);
    if (!op.startsWith("delete_") && !op.startsWith("remove_")) {
      output.push(operation);
      continue;
    }

    const idValue = getDeleteIdValue(operation, "");
    const where = getStringFromUnknown(operation.where);
    const key = [
      op,
      getStringFromUnknown(operation.target),
      idValue === undefined || idValue === null ? "" : String(idValue),
      where
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(operation);
  }

  return output;
}

function getDeleteIdValue(record: Record<string, unknown>, fallbackIdField: string): unknown {
  const explicitRecord = asRecord(record.record);
  const whereRecord = asRecord(record.where);
  return record.id_value
    ?? record.entity_id
    ?? record[fallbackIdField]
    ?? record.record_id
    ?? explicitRecord?.id_value
    ?? explicitRecord?.entity_id
    ?? explicitRecord?.record_id
    ?? explicitRecord?.id
    ?? explicitRecord?.[fallbackIdField]
    ?? explicitRecord?.appid
    ?? explicitRecord?.app_id
    ?? explicitRecord?.application_id
    ?? explicitRecord?.windowid
    ?? explicitRecord?.window_id
    ?? explicitRecord?.tabid
    ?? explicitRecord?.tab_id
    ?? explicitRecord?.fieldid
    ?? explicitRecord?.field_id
    ?? explicitRecord?.menuid
    ?? explicitRecord?.menu_id
    ?? explicitRecord?.tableid
    ?? explicitRecord?.table_id
    ?? explicitRecord?.columnid
    ?? explicitRecord?.column_id
    ?? explicitRecord?.domainid
    ?? explicitRecord?.domain_id
    ?? record.appid
    ?? record.app_id
    ?? record.application_id
    ?? record.windowid
    ?? record.window_id
    ?? record.tabid
    ?? record.tab_id
    ?? record.fieldid
    ?? record.field_id
    ?? record.menuid
    ?? record.menu_id
    ?? record.tableid
    ?? record.table_id
    ?? record.columnid
    ?? record.column_id
    ?? record.domainid
    ?? record.domain_id
    ?? whereRecord?.id_value
    ?? whereRecord?.entity_id
    ?? whereRecord?.id
    ?? whereRecord?.[fallbackIdField]
    ?? whereRecord?.appid
    ?? whereRecord?.app_id
    ?? whereRecord?.application_id
    ?? whereRecord?.windowid
    ?? whereRecord?.window_id
    ?? whereRecord?.tabid
    ?? whereRecord?.tab_id
    ?? whereRecord?.fieldid
    ?? whereRecord?.field_id
    ?? whereRecord?.menuid
    ?? whereRecord?.menu_id
    ?? whereRecord?.tableid
    ?? whereRecord?.table_id
    ?? whereRecord?.columnid
    ?? whereRecord?.column_id
    ?? whereRecord?.domainid;
}

function sameId(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || left === "") return false;
  if (right === undefined || right === null || right === "") return false;
  return String(left) === String(right);
}

function sameLookupValue(left: unknown, right: unknown): boolean {
  if (!hasUsableValue(left) || !hasUsableValue(right)) return false;
  return normalizeLookupKey(String(left)) === normalizeLookupKey(String(right));
}

function getBooleanLike(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes", "y", "co", "ok"].includes(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
  );
}

function buildOperationsFromStructuredPlan(plan: Record<string, unknown>): Record<string, unknown>[] {
  const operations: Record<string, unknown>[] = [];
  const appRecord = asRecord(plan.app) ?? getImplicitAppRecord(plan);
  const appOperationId = appRecord ? "create_app_1" : undefined;

  if (appRecord) {
    operations.push({
      id: appOperationId,
      op: "create_app",
      record: appRecord
    });
  }

  const tableRefs = new Map<string, string>();
  const columnRefs = new Map<string, string>();
  const windowRefs = new Map<string, string>();

  toRecords(plan.tables).forEach((table, tableIndex) => {
    const tableId = `create_table_${tableIndex + 1}`;
    const columns = toRecords(table.columns);
    const tableRecord = omitKeys(table, ["columns", "fields", "tabs"]);
    if (appOperationId && tableRecord.appid === undefined) tableRecord.appid = `$${appOperationId}.appid`;
    operations.push({ id: tableId, op: "create_table", record: tableRecord });

    const tableName = normalizeLookupKey(
      getStringFromUnknown(ci(tableRecord, "tablename"))
      || getStringFromUnknown(ci(tableRecord, "table_name"))
      || getStringFromUnknown(ci(tableRecord, "name"))
      || getStringFromUnknown(ci(tableRecord, "alias"))
    );
    if (tableName) tableRefs.set(tableName, tableId);

    columns.forEach((column, columnIndex) => {
      const columnId = `create_column_${tableIndex + 1}_${columnIndex + 1}`;
      const columnRecord = { ...column };
      if (columnRecord.tableid === undefined) columnRecord.tableid = `$${tableId}.tableid`;
      operations.push({ id: columnId, op: "create_column", record: columnRecord });

      const columnName = normalizeLookupKey(
        getStringFromUnknown(ci(columnRecord, "columnname"))
        || getStringFromUnknown(ci(columnRecord, "column_name"))
        || getStringFromUnknown(ci(columnRecord, "name"))
      );
      if (tableName && columnName) columnRefs.set(`${tableName}.${columnName}`, columnId);
      if (columnName && !columnRefs.has(columnName)) columnRefs.set(columnName, columnId);
    });
  });

  toRecords(plan.windows).forEach((windowRecord, windowIndex) => {
    const windowId = `create_window_${windowIndex + 1}`;
    const tabs = toRecords(windowRecord.tabs);
    const record = omitKeys(windowRecord, ["tabs", "fields"]);
    if (appOperationId && record.appid === undefined) record.appid = `$${appOperationId}.appid`;
    operations.push({ id: windowId, op: "create_window", record });

    const windowName = normalizeLookupKey(
      getStringFromUnknown(ci(record, "windowname"))
      || getStringFromUnknown(ci(record, "window_name"))
      || getStringFromUnknown(ci(record, "name"))
    );
    if (windowName) windowRefs.set(windowName, windowId);

    tabs.forEach((tab, tabIndex) => {
      const tabId = `create_tab_${windowIndex + 1}_${tabIndex + 1}`;
      const fields = toRecords(tab.fields);
      const tabRecord = omitKeys(tab, ["fields"]);
      if (tabRecord.windowid === undefined) tabRecord.windowid = `$${windowId}.windowid`;
      const tableRef = findTableOperationRef(tabRecord, tableRefs);
      if (tableRef && tabRecord.tableid === undefined) tabRecord.tableid = `$${tableRef}.tableid`;
      operations.push({ id: tabId, op: "create_tab", record: tabRecord });

      fields.forEach((field, fieldIndex) => {
        const fieldRecord = { ...field };
        if (fieldRecord.tabid === undefined) fieldRecord.tabid = `$${tabId}.tabid`;
        const columnRef = findColumnOperationRef(fieldRecord, tabRecord, tableRefs, columnRefs);
        if (columnRef && fieldRecord.columnid === undefined) fieldRecord.columnid = `$${columnRef}.columnid`;
        operations.push({
          id: `create_field_${windowIndex + 1}_${tabIndex + 1}_${fieldIndex + 1}`,
          op: "create_field",
          record: fieldRecord
        });
      });
    });
  });

  toRecords(plan.menus).forEach((menu, menuIndex) => {
    const record = { ...menu };
    if (appOperationId && record.appid === undefined) record.appid = `$${appOperationId}.appid`;
    if (record.linkwindowid === undefined && record.windowid === undefined) {
      const windowRef = findWindowOperationRef(record, windowRefs);
      if (windowRef) record.linkwindowid = `$${windowRef}.windowid`;
    }
    operations.push({ id: `create_menu_${menuIndex + 1}`, op: "create_menu", record });
  });

  return operations;
}

function getImplicitAppRecord(plan: Record<string, unknown>): Record<string, unknown> | null {
  const appname = plan.appname ?? plan.name;
  if (!appname) return null;

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan)) {
    if (["tables", "windows", "menus", "domains", "operations", "steps"].includes(key)) continue;
    record[key] = value;
  }
  if (!record.appname && record.name) record.appname = record.name;
  return record;
}

function omitKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const blocked = new Set(keys);
  for (const [key, value] of Object.entries(record)) {
    if (!blocked.has(key)) output[key] = value;
  }
  return output;
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function findTableOperationRef(record: Record<string, unknown>, tableRefs: Map<string, string>): string | undefined {
  const candidates = [
    ci(record, "table_ref"),
    ci(record, "table"),
    ci(record, "table_name"),
    ci(record, "tablename"),
    ci(record, "alias")
  ]
    .map(value => normalizeLookupKey(getStringFromUnknown(value)))
    .filter(Boolean);

  for (const candidate of candidates) {
    const ref = tableRefs.get(candidate);
    if (ref) return ref;
  }
  return undefined;
}

function findColumnOperationRef(
  fieldRecord: Record<string, unknown>,
  tabRecord: Record<string, unknown>,
  tableRefs: Map<string, string>,
  columnRefs: Map<string, string>
): string | undefined {
  const columnName = normalizeLookupKey(
    getStringFromUnknown(ci(fieldRecord, "column_ref"))
    || getStringFromUnknown(ci(fieldRecord, "column"))
    || getStringFromUnknown(ci(fieldRecord, "column_name"))
    || getStringFromUnknown(ci(fieldRecord, "columnname"))
    || getStringFromUnknown(ci(fieldRecord, "fieldname"))
    || getStringFromUnknown(ci(fieldRecord, "name"))
  );
  if (!columnName) return undefined;

  const tableRef = findTableOperationRef(tabRecord, tableRefs);
  if (tableRef) {
    for (const [key, value] of tableRefs.entries()) {
      if (value === tableRef) {
        const ref = columnRefs.get(`${key}.${columnName}`);
        if (ref) return ref;
      }
    }
  }
  return columnRefs.get(columnName);
}

function findWindowOperationRef(record: Record<string, unknown>, windowRefs: Map<string, string>): string | undefined {
  const candidates = [
    ci(record, "window_ref"),
    ci(record, "window"),
    ci(record, "window_name"),
    ci(record, "windowname"),
    ci(record, "linkwindow"),
    ci(record, "menuname"),
    ci(record, "name")
  ]
    .map(value => normalizeLookupKey(getStringFromUnknown(value)))
    .filter(Boolean);

  for (const candidate of candidates) {
    const ref = windowRefs.get(candidate);
    if (ref) return ref;
  }
  return undefined;
}

function getOperationName(rawOperation: Record<string, unknown>): string {
  const value = rawOperation.op ?? rawOperation.action ?? rawOperation.type;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Operation thiếu op/action, ví dụ create_app, update_field, delete_menu.");
  }
  const op = value.trim().toLowerCase();
  if (["create", "add", "update", "edit", "rename", "delete", "remove"].includes(op)) {
    const target = getStringFromUnknown(
      rawOperation.target
      ?? rawOperation.entity_type
      ?? rawOperation.target_type
      ?? rawOperation.node_type
    );
    if (target) return `${op}_${normalizeTarget(target)}`;
  }
  return op;
}

function getAction(op: string): "create" | "update" | "delete" {
  if (op.startsWith("create_") || op.startsWith("add_")) return "create";
  if (op.startsWith("update_") || op.startsWith("edit_") || op.startsWith("rename_")) return "update";
  if (op.startsWith("delete_") || op.startsWith("remove_")) return "delete";
  throw new Error(`Action không hỗ trợ: ${op}`);
}

function getTarget(op: string, rawOperation: Record<string, unknown>): string {
  const explicit = getStringFromUnknown(
    rawOperation.target
    ?? rawOperation.entity_type
    ?? rawOperation.target_type
    ?? rawOperation.node_type
  );
  const target = explicit
    ? normalizeTarget(explicit)
    : normalizeTarget(op.replace(/^(create|add|update|edit|rename|delete|remove)_/, ""));
  if (target === "node") {
    const nodeType = getStringFromUnknown(rawOperation.node_type)
      || getStringFromUnknown(rawOperation.node_id).split(":").filter(Boolean)[0];
    if (nodeType) return normalizeTarget(nodeType);
  }
  return target;
}

function normalizeTarget(value: string): string {
  const text = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    app: "app",
    apps: "app",
    application: "app",
    applications: "app",
    table: "table",
    tables: "table",
    column: "column",
    columns: "column",
    window: "window",
    windows: "window",
    tab: "tab",
    tabs: "tab",
    field: "field",
    fields: "field",
    menu: "menu",
    menus: "menu",
    domain: "domain",
    domains: "domain",
    service: "service",
    services: "service",
    appservice: "appservice",
    appservices: "appservice",
    app_service: "appservice",
    app_services: "appservice",
    cache: "cache",
    caches: "cache",
    roleapp: "roleapp",
    roleapps: "roleapp",
    role_app: "roleapp",
    role_apps: "roleapp",
    rolemenu: "rolemenu",
    rolemenus: "rolemenu",
    role_menu: "rolemenu",
    role_menus: "rolemenu",
    access: "access",
    accesses: "access",
    archive: "archive",
    archives: "archive"
  };
  if (aliases[text]) return aliases[text];
  if (text.endsWith("s")) return text.slice(0, -1);
  return text;
}

function stripOperationFields(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if ([
      "op",
      "action",
      "type",
      "target",
      "id",
      "id_value",
      "entity_id",
      "record_id",
      "node_id",
      "node_type",
      "where",
      "record",
      "fields",
      "updates",
      "after",
      "creates_node",
      "cascade",
      "include_related"
    ].includes(key)) continue;
    output[key] = value;
  }
  return output;
}

function materializeCreateRecord(
  context: WriteContext,
  collection: string,
  rawRecord: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...rawRecord };

  if (collection === "applications") {
    if (!record.appname && record.name) record.appname = record.name;
    if (!record.appname) throw new Error("create_app thiếu appname.");
    const apps = context.recordsByCollection.applications ?? [];
    applyDefaultIfAllowed(context, collection, record, "seqno", nextSeq(apps));
    normalizeApplicationType(context, record, warnings);
    applyDefaultIfAllowed(context, collection, record, "siteid", inferSessionSiteId(context.session) ?? inferExistingValue(apps, "siteid"));
  }

  if (collection === "services") {
    if (!record.servicename && record.name) record.servicename = record.name;
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.services ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    applyDefaultIfAllowed(context, collection, record, "seqno", nextSeq(context.recordsByCollection.services ?? []));
    if (!record.servicename) throw new Error("create_service thiếu servicename.");
  }

  if (collection === "appservices") {
    resolveAppReference(context, collection, record, warnings);
    resolveServiceReference(context, record, warnings);
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.appservices ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  if (collection === "tables") {
    if (isColumnAllowed(context, collection, "appid")) {
      resolveAppReference(context, collection, record, warnings);
    } else {
      delete record.appid;
    }
    if (!record.tablename && record.name) record.tablename = record.name;
    if (!record.alias) record.alias = record.tablename;
    if (!record.tabletype) record.tabletype = "table";
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.tables ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    applyDefaultIfAllowed(context, collection, record, "serviceid", inferTableServiceId(context, record));
    applyDefaultIfAllowed(context, collection, record, "seqno", nextSeq(context.recordsByCollection.tables ?? []));
    if (!record.tablename) throw new Error("create_table thiếu tablename.");
  }

  if (collection === "columns") {
    resolveTableReference(context, record, warnings);
    if (!record.columnname && record.name) record.columnname = record.name;
    if (!record.caption && record.label) record.caption = record.label;
    if (!record.datatype && record.columntype) record.datatype = record.columntype;
    if (!record.columntype && record.datatype) record.columntype = record.datatype;
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.columns ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.columns ?? []);
    if (!record.columnname) throw new Error("create_column thiếu columnname.");
  }

  if (collection === "windows") {
    resolveAppReference(context, collection, record, warnings);
    if (!record.windowname && record.name) record.windowname = record.name;
    if (!record.windowtype) record.windowtype = "window";
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.windows ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    applyDefaultIfAllowed(context, collection, record, "seqno", nextSeq(context.recordsByCollection.windows ?? []));
    if (!record.windowname) throw new Error("create_window thiếu windowname.");
  }

  if (collection === "tabs") {
    resolveWindowReference(context, record, warnings);
    resolveTableReference(context, record, warnings);
    if (!record.tabname && record.name) record.tabname = record.name;
    if (record.tablevel === undefined) record.tablevel = record.parenttabid ? 1 : 0;
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.tabs ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.tabs ?? []);
    if (!record.tabname) throw new Error("create_tab thiếu tabname.");
  }

  if (collection === "fields") {
    resolveTabReference(context, record, warnings);
    resolveColumnReference(context, record, warnings);
    const column = record.columnid ? findRecordById(context, "columns", record.columnid) : undefined;
    if (!record.fieldname && record.name) record.fieldname = record.name;
    if (!record.fieldname && record.columnname) record.fieldname = record.columnname;
    if (!record.fieldname && record.columnid) {
      const columnName = column ? ci(column, "columnname") : undefined;
      if (columnName) record.fieldname = columnName;
    }
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "fieldtype",
      record.columntype
        ?? record.datatype
        ?? (column ? ci(column, "columntype") ?? ci(column, "datatype") : undefined)
        ?? "text"
    );
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.fields ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.fields ?? []);
    if (!record.fieldname) throw new Error("create_field thiếu fieldname/columnname.");
  }

  if (collection === "menus") {
    resolveAppReference(context, collection, record, warnings);
    resolveWindowLinkReference(context, record, warnings);
    if (!record.menuname && record.name) record.menuname = record.name;
    if (!record.translate) record.translate = record.menuname;
    applyDefaultIfAllowed(context, collection, record, "menutype", "menu");
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.menus ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.menus ?? []);
    if (!record.menuname) throw new Error("create_menu thiếu menuname.");
  }

  if (collection === "domains") {
    resolveAppReference(context, collection, record, warnings);
    if (!record.domainname && record.name) record.domainname = record.name;
    if (!record.domainname) throw new Error("create_domain thiếu domainname.");
    if (record.values && !record.domainjson) record.domainjson = JSON.stringify(record.values);
    applyDefaultIfAllowed(context, collection, record, "domainjson", "[]");
    applyDefaultIfAllowed(context, collection, record, "domaintype", "list");
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.domains ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  if (collection === "caches") {
    resolveAppReference(context, collection, record, warnings);
    resolveWindowReference(context, record, warnings);
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.caches ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  if (collection === "roleapps") {
    resolveAppReference(context, collection, record, warnings);
    resolveRoleReference(context, record, warnings);
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.roleapps ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  if (collection === "rolemenus") {
    resolveRoleReference(context, record, warnings);
    resolveMenuReference(context, record, warnings);
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.rolemenus ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  if (collection === "accesses") {
    resolveRoleReference(context, record, warnings);
    resolveTableReference(context, record, warnings);
    applyDefaultIfAllowed(
      context,
      collection,
      record,
      "siteid",
      inferSessionSiteId(context.session)
        ?? inferExistingValue(context.recordsByCollection.accesses ?? [], "siteid")
        ?? inferExistingValue(context.recordsByCollection.applications ?? [], "siteid")
    );
  }

  stripReferenceOnlyFields(record);
  const filtered = filterRecordByAllowedColumns(context, collection, record, warnings);
  validateRequiredFields(context, collection, filtered);
  ensureNoDuplicateCreateRecord(context, collection, filtered);
  return filtered;
}

function resolveAppReference(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (record.appid !== undefined && record.appid !== null && record.appid !== "") return;

  const appRef = record.app_ref
    ?? record.app_name
    ?? record.application
    ?? record.application_name
    ?? record.app;

  if (appRef !== undefined && appRef !== null && appRef !== "") {
    const appid = findApplicationId(context, String(appRef));
    if (!appid) {
      throw new Error(`Không tìm thấy app theo tên/id: ${String(appRef)}.`);
    }
    record.appid = appid;
  }

  for (const key of ["app_ref", "app_name", "application", "application_name", "app"]) {
    delete record[key];
  }

  if (record.appid === undefined || record.appid === null || record.appid === "") {
    warnings.push(`${collection}: chưa có appid. Nếu đây là node thuộc app mới, tool sẽ tự nối appid sau prepare nếu plan có create_app.`);
  }
}

function resolveTableReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.tableid)) return;
  const tableRef = record.table_ref ?? record.table_name ?? record.table ?? record.tablename ?? record.alias;
  if (!hasUsableValue(tableRef)) return;

  const appid = record.appid ?? resolveInlineAppReference(context, record);
  const tableid = findUniqueRecordId(context, "tables", String(tableRef), { appid });
  if (!tableid) throw new Error(`Không tìm thấy table theo tên/id: ${String(tableRef)}.`);
  record.tableid = tableid;
  warnings.push(`Resolve table reference ${String(tableRef)} -> tableid=${String(tableid)}.`);
}

function resolveServiceReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.serviceid)) return;
  const serviceRef = record.service_ref ?? record.service_name ?? record.service ?? record.servicename;
  if (!hasUsableValue(serviceRef)) return;

  const serviceid = findUniqueRecordId(context, "services", String(serviceRef));
  if (!serviceid) throw new Error(`Không tìm thấy service theo tên/id: ${String(serviceRef)}.`);
  record.serviceid = serviceid;
  warnings.push(`Resolve service reference ${String(serviceRef)} -> serviceid=${String(serviceid)}.`);
}

function resolveRoleReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.roleid)) return;
  const roleRef = record.role_ref ?? record.role_name ?? record.role ?? record.rolename;
  if (!hasUsableValue(roleRef)) return;

  const roleid = findUniqueRecordId(context, "roles", String(roleRef));
  if (!roleid) throw new Error(`Không tìm thấy role theo tên/id: ${String(roleRef)}.`);
  record.roleid = roleid;
  warnings.push(`Resolve role reference ${String(roleRef)} -> roleid=${String(roleid)}.`);
}

function resolveMenuReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.menuid)) return;
  const menuRef = record.menu_ref ?? record.menu_name ?? record.menu ?? record.menuname;
  if (!hasUsableValue(menuRef)) return;

  const appid = record.appid ?? resolveInlineAppReference(context, record);
  const menuid = findUniqueRecordId(context, "menus", String(menuRef), { appid });
  if (!menuid) throw new Error(`Không tìm thấy menu theo tên/id: ${String(menuRef)}.`);
  record.menuid = menuid;
  warnings.push(`Resolve menu reference ${String(menuRef)} -> menuid=${String(menuid)}.`);
}

function resolveWindowReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.windowid)) return;
  const windowRef = record.window_ref ?? record.window_name ?? record.window ?? record.windowname;
  if (!hasUsableValue(windowRef)) return;

  const appid = record.appid ?? resolveInlineAppReference(context, record);
  const windowid = findUniqueRecordId(context, "windows", String(windowRef), { appid });
  if (!windowid) throw new Error(`Không tìm thấy window theo tên/id: ${String(windowRef)}.`);
  record.windowid = windowid;
  warnings.push(`Resolve window reference ${String(windowRef)} -> windowid=${String(windowid)}.`);
}

function resolveTabReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.tabid)) return;
  const tabRef = record.tab_ref ?? record.tab_name ?? record.tab ?? record.tabname;
  if (!hasUsableValue(tabRef)) return;

  const tabid = findUniqueRecordId(context, "tabs", String(tabRef), {
    windowid: record.windowid,
    tableid: record.tableid
  });
  if (!tabid) throw new Error(`Không tìm thấy tab theo tên/id: ${String(tabRef)}.`);
  record.tabid = tabid;
  warnings.push(`Resolve tab reference ${String(tabRef)} -> tabid=${String(tabid)}.`);
}

function resolveColumnReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.columnid)) return;
  const columnRef = record.column_ref ?? record.column_name ?? record.column ?? record.columnname ?? record.fieldname;
  if (!hasUsableValue(columnRef)) return;

  const columnid = findUniqueRecordId(context, "columns", String(columnRef), {
    tableid: record.tableid
  });
  if (!columnid) throw new Error(`Không tìm thấy column theo tên/id: ${String(columnRef)}.`);
  record.columnid = columnid;
  warnings.push(`Resolve column reference ${String(columnRef)} -> columnid=${String(columnid)}.`);
}

function resolveWindowLinkReference(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (hasUsableValue(record.linkwindowid) || hasUsableValue(record.windowid)) {
    mirrorMenuWindowLinkColumns(context, record);
    return;
  }

  const windowRef = record.linkwindow_ref
    ?? record.link_window
    ?? record.linkwindow
    ?? record.window_ref
    ?? record.window_name
    ?? record.window
    ?? record.windowname;
  if (!hasUsableValue(windowRef)) {
    return;
  }

  const appid = record.appid ?? resolveInlineAppReference(context, record);
  const windowid = findUniqueRecordId(context, "windows", String(windowRef), { appid });
  if (!windowid) throw new Error(`Không tìm thấy window để link menu: ${String(windowRef)}.`);
  setMenuWindowLink(context, record, windowid);
  warnings.push(`Resolve menu window link ${String(windowRef)} -> ${getMenuWindowLinkColumns(context).join("/") || "linkwindowid"}=${String(windowid)}.`);
}

function setMenuWindowLink(context: WriteContext, record: Record<string, unknown>, windowid: unknown): void {
  const columns = getMenuWindowLinkColumns(context);
  if (!columns.length) {
    record.linkwindowid = windowid;
    return;
  }
  for (const column of columns) {
    record[column] = windowid;
  }
}

function mirrorMenuWindowLinkColumns(context: WriteContext, record: Record<string, unknown>): void {
  const value = hasUsableValue(record.linkwindowid) ? record.linkwindowid : record.windowid;
  if (!hasUsableValue(value)) return;
  setMenuWindowLink(context, record, value);
}

function getMenuWindowLinkColumns(context: WriteContext): string[] {
  const columns: string[] = [];
  if (isColumnAllowed(context, "menus", "linkwindowid")) columns.push("linkwindowid");
  if (isColumnAllowed(context, "menus", "windowid")) columns.push("windowid");
  return columns;
}

function findApplicationId(context: WriteContext, value: string): unknown {
  const normalized = normalizeLookupKey(value);
  if (!normalized) return undefined;

  for (const app of context.recordsByCollection.applications ?? []) {
    const candidates = [
      ci(app, "appid"),
      ci(app, "appname"),
      ci(app, "appcode"),
      ci(app, "name")
    ]
      .map(candidate => normalizeLookupKey(String(candidate ?? "")))
      .filter(Boolean);

    if (candidates.includes(normalized)) {
      return ci(app, "appid");
    }
  }

  return undefined;
}

function resolveInlineAppReference(context: WriteContext, record: Record<string, unknown>): unknown {
  const appRef = record.app_ref
    ?? record.app_name
    ?? record.application
    ?? record.application_name
    ?? record.app;
  if (!hasUsableValue(appRef) || isReferenceValue(appRef)) return undefined;
  return findApplicationId(context, String(appRef));
}

function findUniqueRecordId(
  context: WriteContext,
  collection: string,
  value: string,
  filters: Record<string, unknown> = {}
): unknown {
  if (isReferenceValue(value)) return value;
  const normalized = normalizeLookupKey(value);
  if (!normalized) return undefined;

  const records = context.recordsByCollection[collection] ?? [];
  const idField = TARGET_ID_FIELD[collection];
  const matches = records.filter(record => {
    for (const [key, expected] of Object.entries(filters)) {
      if (!hasUsableValue(expected) || isReferenceValue(expected)) continue;
      const actual = ci(record, key);
      if (hasUsableValue(actual) && !sameId(actual, expected)) return false;
    }

    return recordLookupCandidates(collection, record, idField)
      .map(candidate => normalizeLookupKey(String(candidate ?? "")))
      .filter(Boolean)
      .includes(normalized);
  });

  if (matches.length > 1) {
    const preview = matches
      .slice(0, 5)
      .map(record => `${String(ci(record, idField))}:${String(ci(record, "appname") ?? ci(record, "tablename") ?? ci(record, "windowname") ?? ci(record, "tabname") ?? ci(record, "columnname") ?? ci(record, "fieldname") ?? ci(record, "menuname") ?? "")}`)
      .join(", ");
    throw new Error(`Tim thay nhieu ${collection} khop "${value}": ${preview}. Hay chi ro id.`);
  }

  return matches[0] ? ci(matches[0], idField) : undefined;
}

function findRecordById(
  context: WriteContext,
  collection: string,
  idValue: unknown
): Record<string, unknown> | undefined {
  if (!hasUsableValue(idValue) || isReferenceValue(idValue)) return undefined;
  const idField = TARGET_ID_FIELD[collection];
  return (context.recordsByCollection[collection] ?? [])
    .find(record => sameId(ci(record, idField), idValue));
}

function recordLookupCandidates(collection: string, record: Record<string, unknown>, idField: string): unknown[] {
  const common = [
    ci(record, idField),
    ci(record, "name"),
    ci(record, "appname"),
    ci(record, "tablename"),
    ci(record, "alias"),
    ci(record, "columnname"),
    ci(record, "windowname"),
    ci(record, "tabname"),
    ci(record, "fieldname"),
    ci(record, "menuname"),
    ci(record, "domainname"),
    ci(record, "servicename"),
    ci(record, "rolename")
  ];

  if (collection === "columns") {
    common.push(`${String(ci(record, "tablename") ?? "")}.${String(ci(record, "columnname") ?? "")}`);
  }
  if (collection === "fields") {
    common.push(`${String(ci(record, "tabname") ?? "")}.${String(ci(record, "fieldname") ?? "")}`);
  }
  return common;
}

function resolveTargetIdValue(
  context: WriteContext,
  collection: string,
  rawOperation: Record<string, unknown>
): unknown {
  const directNodeId = getStringFromUnknown(rawOperation.node_id);
  const parsedNodeId = parseNodeIdForCollection(collection, directNodeId);
  if (parsedNodeId !== undefined) return parsedNodeId;

  const targetRef = rawOperation.target_ref
    ?? rawOperation.entity_ref
    ?? rawOperation.window_ref
    ?? rawOperation.window_name
    ?? rawOperation.old_name
    ?? rawOperation.name;

  if (targetRef === undefined || targetRef === null || targetRef === "") return undefined;

  const records = context.recordsByCollection[collection] ?? [];
  const idField = TARGET_ID_FIELD[collection];
  const normalizedRef = normalizeLookupKey(String(targetRef));
  const appFilter = rawOperation.appid
    ?? (rawOperation.app_name !== undefined && rawOperation.app_name !== null && rawOperation.app_name !== ""
      ? findApplicationId(context, String(rawOperation.app_name))
      : undefined);

  for (const record of records) {
    if (appFilter !== undefined && appFilter !== null && appFilter !== "") {
      const recordAppId = ci(record, "appid");
      if (recordAppId !== undefined && recordAppId !== null && recordAppId !== "" && !sameId(recordAppId, appFilter)) {
        continue;
      }
    }

    const candidates = [
      ci(record, idField),
      ci(record, "name"),
      ci(record, "appname"),
      ci(record, "tablename"),
      ci(record, "alias"),
      ci(record, "columnname"),
      ci(record, "windowname"),
      ci(record, "tabname"),
      ci(record, "fieldname"),
      ci(record, "menuname"),
      ci(record, "domainname"),
      ci(record, "servicename"),
      ci(record, "rolename")
    ]
      .map(value => normalizeLookupKey(String(value ?? "")))
      .filter(Boolean);

    if (candidates.includes(normalizedRef)) {
      return ci(record, idField);
    }
  }

  return undefined;
}

function parseNodeIdForCollection(collection: string, nodeId: string): string | undefined {
  if (!nodeId) return undefined;
  const parts = nodeId.split(":").filter(Boolean);
  if (!parts.length) return undefined;
  const type = parts[0];

  if (collection === "applications" && type === "app") return parts[1];
  if (collection === "services" && type === "service") return parts[1];
  if (collection === "appservices" && type === "appservice") return parts[2] ?? parts[1];
  if (collection === "windows" && type === "window") return parts[1];
  if (collection === "domains" && type === "domain") return parts[1];
  if (collection === "caches" && type === "cache") return parts[1];
  if (collection === "roleapps" && type === "roleapp") return parts[2] ?? parts[1];
  if (collection === "rolemenus" && type === "rolemenu") return parts[2] ?? parts[1];
  if (collection === "accesses" && type === "access") return parts[2] ?? parts[1];
  if (collection === "archives" && type === "archive") return parts[1];
  if (collection === "tables" && type === "table") return parts[2] ?? parts[1];
  if (collection === "columns" && type === "column") return parts[3] ?? parts[2] ?? parts[1];
  if (collection === "tabs" && type === "tab") return parts[2] ?? parts[1];
  if (collection === "fields" && type === "field") return parts[3] ?? parts[2] ?? parts[1];
  if (collection === "menus" && type === "menu") return parts[2] ?? parts[1];

  return undefined;
}

function filterRecordByAllowedColumns(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const allowed = context.allowedColumnsByCollection[collection];
  if (!allowed || allowed.size === 0) return record;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(key.toLowerCase())) {
      output[key] = value;
    } else {
      warnings.push(`Bỏ qua field không tồn tại trong ${collection}: ${key}`);
    }
  }
  return output;
}

function validateRequiredFields(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>
): void {
  const required = CREATE_REQUIRED_FIELDS[collection] ?? [];
  const missing = required.filter(key => isColumnAllowed(context, collection, key) && !hasUsableValue(record[key]));
  if (missing.length) {
    const label = LEVEL3_COLLECTIONS.has(collection)
      ? "Level 3 create metadata"
      : "Create metadata";
    throw new Error(`${label} ${collection} thiếu field bắt buộc: ${missing.join(", ")}.`);
  }
}

function ensureNoDuplicateCreateRecord(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>
): void {
  const records = context.recordsByCollection[collection] ?? [];
  if (!records.length) return;

  if (collection === "applications") {
    ensureUniqueByKeys(records, record, ["appname"], "app");
  } else if (collection === "tables") {
    ensureUniqueByKeys(records, record, ["tablename"], "table");
  } else if (collection === "columns") {
    ensureUniqueByKeys(records, record, ["tableid", "columnname"], "column");
  } else if (collection === "windows") {
    ensureUniqueByKeys(records, record, ["appid", "windowname"], "window");
  } else if (collection === "tabs") {
    ensureUniqueByKeys(records, record, ["windowid", "tabname"], "tab");
  } else if (collection === "fields") {
    ensureUniqueByKeys(records, record, ["tabid", "columnid"], "field");
  } else if (collection === "menus") {
    ensureUniqueByKeys(records, record, ["appid", "menuname"], "menu");
  } else if (collection === "domains") {
    ensureUniqueByKeys(records, record, ["domainname"], "domain");
  }
}

function ensureUniqueByKeys(
  records: Record<string, unknown>[],
  record: Record<string, unknown>,
  keys: string[],
  label: string
): void {
  const effectiveKeys = keys.filter(key => hasUsableValue(record[key]) && !isReferenceValue(record[key]));
  if (effectiveKeys.length !== keys.length) return;

  const duplicate = records.find(existing =>
    effectiveKeys.every(key => sameLookupValue(ci(existing, key), record[key]))
  );
  if (!duplicate) return;

  const idPreview = ["appid", "serviceid", "appserviceid", "tableid", "columnid", "windowid", "tabid", "fieldid", "menuid", "domainid", "cacheid", "roleappid", "rolemenuid", "accessid", "archiveid"]
    .map(key => ci(duplicate, key))
    .find(hasUsableValue);
  throw new Error(`Đã tồn tại ${label} với ${keys.map(key => `${key}=${String(record[key])}`).join(", ")}${idPreview ? ` (id=${String(idPreview)})` : ""}. Không tạo trùng.`);
}

function stripReferenceOnlyFields(record: Record<string, unknown>): void {
  for (const key of [
    "app_ref", "app_name", "application", "application_name", "app",
    "table_ref", "table_name", "table",
    "service_ref", "service_name", "service",
    "window_ref", "window_name", "window",
    "tab_ref", "tab_name", "tab",
    "column_ref", "column_name", "column",
    "linkwindow_ref", "link_window", "linkwindow",
    "role_ref", "role_name", "role",
    "menu_ref", "menu_name", "menu"
  ]) {
    delete record[key];
  }
}

function applyDefaultIfAllowed(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (record[key] !== undefined || value === undefined || value === null || value === "") return;
  const allowed = context.allowedColumnsByCollection[collection];
  if (!allowed || allowed.size === 0 || allowed.has(key.toLowerCase())) {
    record[key] = value;
  }
}

function isColumnAllowed(context: WriteContext, collection: string, key: string): boolean {
  const allowed = context.allowedColumnsByCollection[collection];
  return !allowed || allowed.size === 0 || allowed.has(key.toLowerCase());
}

function hasUsableValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function isReferenceValue(value: unknown): boolean {
  return typeof value === "string" && /^\$[A-Za-z0-9_-]+\.[A-Za-z0-9_]+$/.test(value.trim());
}

function nextSeq(records: Record<string, unknown>[]): number {
  const max = records.reduce((highest, record) => {
    const value = Number(ci(record, "seqno"));
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);
  return max + 1;
}

function inferExistingValue(records: Record<string, unknown>[], key: string): unknown {
  for (const record of records) {
    const value = ci(record, key);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function inferSessionSiteId(session: ZilcodeSession): unknown {
  const user = asRecord(session.user);
  return user ? ci(user, "siteid") ?? ci(user, "site_id") : undefined;
}

function inferTableServiceId(context: WriteContext, record: Record<string, unknown>): unknown {
  const tabletype = normalizeLookupKey(String(record.tabletype ?? "table"));
  const tables = context.recordsByCollection.tables ?? [];
  const candidates = tables.filter(table => {
    const existingType = normalizeLookupKey(String(ci(table, "tabletype") ?? "table"));
    return existingType === tabletype && hasUsableValue(ci(table, "serviceid"));
  });
  const mode = inferMostCommonValue(candidates, "serviceid");
  if (hasUsableValue(mode)) return mode;
  return inferExistingValue(tables, "serviceid");
}

function inferMostCommonValue(records: Record<string, unknown>[], key: string): unknown {
  const counts = new Map<string, { value: unknown; count: number; firstIndex: number }>();
  records.forEach((record, index) => {
    const value = ci(record, key);
    if (!hasUsableValue(value)) return;
    const normalized = String(value);
    const existing = counts.get(normalized);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(normalized, { value, count: 1, firstIndex: index });
    }
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.firstIndex - right.firstIndex)[0]?.value;
}

function normalizeApplicationType(
  context: WriteContext,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (!isColumnAllowed(context, "applications", "apptype")) return;

  const apps = context.recordsByCollection.applications ?? [];
  const existingTypes = apps
    .map(app => ci(app, "apptype"))
    .filter(hasUsableValue);
  const defaultType = existingTypes.find(type => normalizeLookupKey(String(type)) === "app")
    ?? inferExistingValue(apps, "apptype")
    ?? "app";
  const current = record.apptype;

  if (!hasUsableValue(current)) {
    record.apptype = defaultType;
    return;
  }

  if (typeof current === "number" && Number.isFinite(current)) return;

  if (typeof current === "string") {
    const trimmed = current.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      record.apptype = Number(trimmed);
      return;
    }
  }

  warnings.push(`create_app apptype="${String(current)}" không phải giá trị metadata hợp lệ; dùng default apptype=${String(defaultType)}.`);
  record.apptype = defaultType;
}

function summarizePlan(plan: PendingChange): Record<string, unknown> {
  return {
    intent: plan.intent,
    operations_count: plan.operations.length,
    by_action: countBy(plan.operations, operation => operation.action),
    by_target: countBy(plan.operations, operation => operation.target)
  };
}

function summarizeOperation(operation: PreparedOperation): Record<string, unknown> {
  return {
    id: operation.id,
    action: operation.action,
    target: operation.target,
    label: operation.label,
    id_value: operation.id_value,
    where: operation.where,
    record_keys: operation.record ? Object.keys(operation.record) : undefined
  };
}

function getOperationLabel(target: string, record: Record<string, unknown>, idValue: unknown): string {
  if (target === "app") return String(record.appname ?? idValue ?? target);
  if (target === "table") return String(record.tablename ?? record.alias ?? idValue ?? target);
  if (target === "column") return String(record.columnname ?? idValue ?? target);
  if (target === "window") return String(record.windowname ?? idValue ?? target);
  if (target === "tab") return String(record.tabname ?? idValue ?? target);
  if (target === "field") return String(record.fieldname ?? record.columnname ?? idValue ?? target);
  if (target === "menu") return String(record.menuname ?? idValue ?? target);
  if (target === "domain") return String(record.domainname ?? idValue ?? target);
  return String(
    record.appname
    ?? record.tablename
    ?? record.columnname
    ?? record.windowname
    ?? record.tabname
    ?? record.fieldname
    ?? record.menuname
    ?? record.domainname
    ?? idValue
    ?? target
  );
}

function compactRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = ci(record, key);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function buildIdWhere(idField: string, idValue: unknown): string {
  if (idValue === undefined || idValue === null || idValue === "") {
    throw new Error("Delete thiếu id_value.");
  }
  return `${idField}=${formatSqlValue(idValue)}`;
}

function formatSqlValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean" || /^\d+$/.test(String(value))) {
    return String(value);
  }
  return `N'${String(value).replace(/'/g, "''")}'`;
}

function buildWhereFromRecord(
  context: WriteContext,
  collection: string,
  record: Record<string, unknown>,
  warnings: string[]
): string {
  const filtered = filterRecordByAllowedColumns(context, collection, record, warnings);
  const clauses = Object.entries(filtered)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      return `${key}=${formatSqlValue(value)}`;
    });
  return clauses.join(" AND ");
}

function addQuery(pathOrUrl: string, params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "");
  if (!entries.length) return pathOrUrl;
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${pathOrUrl}${pathOrUrl.includes("?") ? "&" : "?"}${query}`;
}

function toRecords(value: unknown): Record<string, unknown>[] {
  return toArrayValues(value)
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object" && !Array.isArray(record));
}

function ci(record: Record<string, unknown>, key: string): unknown {
  return getCaseInsensitiveValue(record, key);
}

function getStringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((output, item) => {
    const key = keyFn(item);
    output[key] = (output[key] ?? 0) + 1;
    return output;
  }, {});
}
