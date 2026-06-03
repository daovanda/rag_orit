import type { Env } from "./config";
import { asRecord, getCaseInsensitiveValue, getNumberArg, getStringArg, toArrayValues, truncateDebugText } from "./utils";
import {
  assertZilcodeSuccess,
  buildZilcodeAppBuilderBlueprint,
  callZilcodeJson,
  type ZilcodeSession
} from "./zilcode";

const PENDING_CHANGE_PREFIX = "app_builder_change:";
const PENDING_CHANGE_TTL_SECONDS = 60 * 30;

const TARGET_COLLECTION: Record<string, string> = {
  app: "applications",
  application: "applications",
  table: "tables",
  column: "columns",
  window: "windows",
  tab: "tabs",
  field: "fields",
  menu: "menus",
  domain: "domains"
};

const TARGET_ID_FIELD: Record<string, string> = {
  applications: "appid",
  tables: "tableid",
  columns: "columnid",
  windows: "windowid",
  tabs: "tabid",
  fields: "fieldid",
  menus: "menuid",
  domains: "domainid"
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
    return { error: "Chua dang nhap Zilcode nen khong the tao/sua/xoa App Builder." };
  }

  if (toolName === "app_builder_prepare_change") {
    return prepareChange(env, session, args);
  }

  if (toolName === "app_builder_apply_change") {
    return applyChange(env, session, args);
  }

  return { error: `Unsupported App Builder write tool: ${toolName}` };
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
        "Thieu operations. Hay truyen operations gom cac buoc create/update/delete app/table/column/window/tab/field/menu/domain."
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

  autoWirePreparedOperations(operations, warnings);

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
      error: "Thieu plan_id. Hay goi app_builder_prepare_change truoc va chi apply sau khi user xac nhan."
    };
  }

  const raw = await env.CHUNKS.get(`${PENDING_CHANGE_PREFIX}${planId}`);
  if (!raw) {
    return {
      mode: "apply_change",
      ok: false,
      status: "not_found",
      plan_id: planId,
      error: "Khong tim thay pending plan hoac plan da het han."
    };
  }

  const plan = JSON.parse(raw) as PendingChange;
  const context = await loadWriteContext(env, session, args);
  const results: Record<string, unknown>[] = [];
  const state: ApplyState = { refs: {} };
  let failed = false;

  for (const operation of plan.operations) {
    if (failed) {
      results.push({ operation_id: operation.id, skipped: true });
      continue;
    }

    try {
      const result = await applyOperation(env, context, operation, state);
      const reference = extractOperationReference(operation, result);
      state.refs[operation.id] = reference;
      results.push({ operation_id: operation.id, ok: true, result, reference });
    } catch (error) {
      failed = true;
      results.push({
        operation_id: operation.id,
        ok: false,
        error: truncateDebugText(error)
      });
    }
  }

  if (!failed) {
    await env.CHUNKS.delete(`${PENDING_CHANGE_PREFIX}${planId}`);
  }

  return {
    mode: "apply_change",
    ok: !failed,
    status: failed ? "partial_success" : "success",
    plan_id: planId,
    applied_count: results.filter(result => result.ok).length,
    failed_count: results.filter(result => result.ok === false).length,
    results,
    next_step: failed
      ? "Sua lai plan dua tren loi va prepare_change lai. Cac buoc sau loi da bi skip."
      : "Goi app_builder_graph_overview/search/detail de verify cau hinh sau khi ghi."
  };
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

  if (!collection) throw new Error(`Target khong ho tro: ${target}`);
  if (!context.collections[collection]) throw new Error(`Khong tim thay collection metadata: ${collection}`);

  const record = normalizeRecordAliases(
    target,
    asRecord(rawOperation.record) ?? stripOperationFields(rawOperation),
    warnings
  );
  const preparedRecord = action === "create"
    ? materializeCreateRecord(context, collection, record, warnings)
    : action === "update"
      ? filterRecordByAllowedColumns(context, collection, record, warnings)
      : undefined;

  if (action === "create" && (!preparedRecord || !Object.keys(preparedRecord).length)) {
    throw new Error("Create operation khong co record hop le.");
  }

  const idValue = rawOperation.id_value
    ?? rawOperation.entity_id
    ?? rawOperation[`${TARGET_ID_FIELD[collection]}`]
    ?? resolveTargetIdValue(context, collection, rawOperation)
    ?? rawOperation.id;
  const where = getStringFromUnknown(rawOperation.where);

  if ((action === "update" || action === "delete") && (idValue === undefined || idValue === null || idValue === "") && !where) {
    throw new Error("Update/delete can id_value hoac where.");
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

function autoWirePreparedOperations(operations: PreparedOperation[], warnings: string[]): void {
  const firstCreatedApp = operations.find(operation => operation.action === "create" && operation.collection === "applications");
  if (!firstCreatedApp) return;

  for (const operation of operations) {
    if (operation.action !== "create" || !operation.record) continue;
    if (!["tables", "windows", "menus"].includes(operation.collection)) continue;
    if (operation.record.appid !== undefined) continue;
    operation.record.appid = `$${firstCreatedApp.id}.appid`;
    warnings.push(`${operation.id}: tu dong lien ket appid voi ${firstCreatedApp.id}.appid.`);
  }
}

function extractOperationReference(operation: PreparedOperation, result: unknown): Record<string, unknown> {
  const idField = TARGET_ID_FIELD[operation.collection];
  const record: Record<string, unknown> = {};

  if (result && typeof result === "object" && !Array.isArray(result)) {
    Object.assign(record, result as Record<string, unknown>);
  } else if (Array.isArray(result) && result[0] && typeof result[0] === "object") {
    Object.assign(record, result[0] as Record<string, unknown>);
  } else if (result !== undefined && result !== null && result !== "") {
    record[idField] = result;
  }

  const maybeId = record[idField] ?? record.id ?? record.ID ?? record.Id;
  if (maybeId !== undefined && maybeId !== null && maybeId !== "") record[idField] = maybeId;
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
  if (!record) throw new Error(`Khong resolve duoc reference $${operationId}.${field}; operation truoc do chua co ket qua.`);
  const value = ci(record, field);
  if (value === undefined || value === null || value === "") {
    throw new Error(`Khong resolve duoc reference $${operationId}.${field}; ket qua khong co field nay.`);
  }
  return value;
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
  if (!endpoint) throw new Error(`Collection ${operation.collection} khong co urledit/urlview.`);

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
  const envelope = await callZilcodeJson<unknown>(env, addQuery(endpoint, { where }), {
    method: "DELETE",
    token: context.session.token,
    baseUrl: context.session.base_url
  });
  return assertZilcodeSuccess(envelope);
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

    const record = asRecord(rawOperation.record)
      ? normalizeRecordAliases(target, asRecord(rawOperation.record) as Record<string, unknown>, warnings)
      : undefined;

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
    target_window_id: "linkwindowid",
    link_window_id: "linkwindowid",
    parent_menu_id: "parentid",
    parent_tab_id: "parenttabid",
    display_name: "translate",
    label: "translate",
    title: "translate"
  };

  const targetSpecific: Record<string, Record<string, string>> = {
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
  if (mapped !== key) warnings.push(`Chuan hoa field ${key} -> ${mapped}.`);
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

    expanded.push(rawOperation);
  }

  return dedupeRawOperations(expanded);
}

function buildDeleteWindowCascadeOperations(
  context: WriteContext,
  rawOperation: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown>[] {
  const windowId = getDeleteIdValue(rawOperation, "windowid");
  if (windowId === undefined || windowId === null || windowId === "") {
    throw new Error("delete_window cascade thieu windowid/id_value.");
  }

  const windowIdText = String(windowId);
  const tabs = (context.recordsByCollection.tabs ?? [])
    .filter(tab => sameId(ci(tab, "windowid"), windowIdText));
  const tabIds = new Set(tabs.map(tab => String(ci(tab, "tabid") ?? "")).filter(Boolean));
  const fields = (context.recordsByCollection.fields ?? [])
    .filter(field => tabIds.has(String(ci(field, "tabid") ?? "")));
  const menus = (context.recordsByCollection.menus ?? [])
    .filter(menu => sameId(ci(menu, "linkwindowid") ?? ci(menu, "windowid"), windowIdText));

  warnings.push(
    `delete_window cascade windowid=${windowIdText}: se xoa ${fields.length} field, ${tabs.length} tab, ${menus.length} menu lien ket va window. Khong xoa table/column/du lieu that.`
  );

  const operations: Record<string, unknown>[] = [];
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
      .filter(item => !["tab", "tabs", "field", "fields", "menu", "menus"].includes(item.toLowerCase()));
    if (unsupported.length) {
      warnings.push(`Chua ho tro tu dong xoa related metadata ngoai window/tab/field/menu: ${unsupported.join(", ")}.`);
    }
  }

  return operations;
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
  return record.id_value
    ?? record.entity_id
    ?? record.id
    ?? record[fallbackIdField]
    ?? record.windowid
    ?? record.tabid
    ?? record.fieldid
    ?? record.menuid
    ?? record.tableid
    ?? record.columnid
    ?? record.domainid;
}

function sameId(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || left === "") return false;
  if (right === undefined || right === null || right === "") return false;
  return String(left) === String(right);
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
    throw new Error("Operation thieu op/action, vi du create_app, update_field, delete_menu.");
  }
  const op = value.trim().toLowerCase();
  if (["create", "add", "update", "edit", "rename", "delete", "remove"].includes(op)) {
    const target = getStringFromUnknown(rawOperation.target ?? rawOperation.entity_type ?? rawOperation.target_type);
    if (target) return `${op}_${normalizeTarget(target)}`;
  }
  return op;
}

function getAction(op: string): "create" | "update" | "delete" {
  if (op.startsWith("create_") || op.startsWith("add_")) return "create";
  if (op.startsWith("update_") || op.startsWith("edit_") || op.startsWith("rename_")) return "update";
  if (op.startsWith("delete_") || op.startsWith("remove_")) return "delete";
  throw new Error(`Action khong ho tro: ${op}`);
}

function getTarget(op: string, rawOperation: Record<string, unknown>): string {
  const explicit = getStringFromUnknown(rawOperation.target ?? rawOperation.entity_type ?? rawOperation.target_type);
  if (explicit) return normalizeTarget(explicit);
  return normalizeTarget(op.replace(/^(create|add|update|edit|rename|delete|remove)_/, ""));
}

function normalizeTarget(value: string): string {
  const text = value.trim().toLowerCase();
  if (text === "application") return "app";
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
      "where",
      "record",
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
    if (!record.appname) throw new Error("create_app thieu appname.");
    const apps = context.recordsByCollection.applications ?? [];
    applyDefaultIfAllowed(context, collection, record, "seqno", nextSeq(apps));
    applyDefaultIfAllowed(context, collection, record, "apptype", inferExistingValue(apps, "apptype") ?? 0);
    applyDefaultIfAllowed(context, collection, record, "siteid", inferSessionSiteId(context.session) ?? inferExistingValue(apps, "siteid"));
  }

  if (collection === "tables") {
    resolveAppReference(context, collection, record, warnings);
    if (!record.tablename && record.name) record.tablename = record.name;
    if (!record.alias) record.alias = record.tablename;
    if (!record.tabletype) record.tabletype = "table";
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.tables ?? []);
    if (!record.tablename) throw new Error("create_table thieu tablename.");
    if (!record.appid) warnings.push("create_table chua co appid; neu operation phu thuoc app moi, apply tool hien chua resolve bien tam.");
  }

  if (collection === "columns") {
    if (!record.columnname && record.name) record.columnname = record.name;
    if (!record.caption && record.label) record.caption = record.label;
    if (!record.datatype && record.columntype) record.datatype = record.columntype;
    if (!record.columntype && record.datatype) record.columntype = record.datatype;
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.columns ?? []);
    if (!record.columnname) throw new Error("create_column thieu columnname.");
  }

  if (collection === "windows") {
    resolveAppReference(context, collection, record, warnings);
    if (!record.windowname && record.name) record.windowname = record.name;
    if (!record.windowtype) record.windowtype = "window";
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.windows ?? []);
    if (!record.windowname) throw new Error("create_window thieu windowname.");
  }

  if (collection === "tabs") {
    if (!record.tabname && record.name) record.tabname = record.name;
    if (record.tablevel === undefined) record.tablevel = record.parenttabid ? 1 : 0;
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.tabs ?? []);
    if (!record.tabname) throw new Error("create_tab thieu tabname.");
  }

  if (collection === "fields") {
    if (!record.fieldname && record.name) record.fieldname = record.name;
    if (!record.fieldname && record.columnname) record.fieldname = record.columnname;
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.fields ?? []);
    if (!record.fieldname) throw new Error("create_field thieu fieldname/columnname.");
  }

  if (collection === "menus") {
    resolveAppReference(context, collection, record, warnings);
    if (!record.menuname && record.name) record.menuname = record.name;
    if (!record.translate) record.translate = record.menuname;
    if (!record.seqno) record.seqno = nextSeq(context.recordsByCollection.menus ?? []);
    if (!record.menuname) throw new Error("create_menu thieu menuname.");
  }

  if (collection === "domains") {
    if (!record.domainname && record.name) record.domainname = record.name;
    if (!record.domainname) throw new Error("create_domain thieu domainname.");
    if (record.values && !record.domainjson) record.domainjson = JSON.stringify(record.values);
  }

  return filterRecordByAllowedColumns(context, collection, record, warnings);
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
      throw new Error(`Khong tim thay app theo ten/id: ${String(appRef)}.`);
    }
    record.appid = appid;
  }

  for (const key of ["app_ref", "app_name", "application", "application_name", "app"]) {
    delete record[key];
  }

  if (record.appid === undefined || record.appid === null || record.appid === "") {
    warnings.push(`${collection}: chua co appid. Neu day la node thuoc app moi, tool se tu noi appid sau prepare neu plan co create_app.`);
  }
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
      ci(record, "domainname")
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
  if (collection === "windows" && type === "window") return parts[1];
  if (collection === "domains" && type === "domain") return parts[1];
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
      warnings.push(`Bo qua field khong ton tai trong ${collection}: ${key}`);
    }
  }
  return output;
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
  return ci(session.user, "siteid") ?? ci(session.user, "site_id");
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

function buildIdWhere(idField: string, idValue: unknown): string {
  if (idValue === undefined || idValue === null || idValue === "") {
    throw new Error("Delete thieu id_value.");
  }
  if (typeof idValue === "number" || /^\d+$/.test(String(idValue))) {
    return `${idField}=${idValue}`;
  }
  return `${idField}=N'${String(idValue).replace(/'/g, "''")}'`;
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
