import type { Env } from "./config";
import { getErrorText } from "./utils";
import {
  assertZilcodeSuccess,
  buildZilcodeAppBuilderBlueprint,
  callZilcodeJson,
  type ZilcodeSession
} from "./zilcode";

type AppBuilderTarget =
  | "application"
  | "table"
  | "column"
  | "window"
  | "tab"
  | "field"
  | "menu"
  | "domain";

type WriteMode = "create" | "update";

interface TargetSpec {
  target: AppBuilderTarget;
  collection: string;
  idKey: string;
  nameKeys: string[];
  duplicateScopeKeys: string[];
  parentRefs: Array<{
    field: string;
    collection: string;
    idKey: string;
    label: string;
    requiredForCreate?: boolean;
  }>;
}

interface ValidationIssue {
  action?: string;
  target?: string;
  field?: string;
  message: string;
}

interface NormalizedAction {
  index: number;
  action: string;
  mode: WriteMode;
  target: AppBuilderTarget;
  record?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  key_value?: string | number;
  where?: string;
}

interface AppBuilderWriteOptions {
  mode: WriteMode;
  target: AppBuilderTarget;
  args: Record<string, unknown>;
}

const TARGET_SPECS: Record<AppBuilderTarget, TargetSpec> = {
  application: {
    target: "application",
    collection: "applications",
    idKey: "appid",
    nameKeys: ["appcode", "appname"],
    duplicateScopeKeys: [],
    parentRefs: []
  },
  table: {
    target: "table",
    collection: "tables",
    idKey: "tableid",
    nameKeys: ["tablename", "alias"],
    duplicateScopeKeys: ["appid"],
    parentRefs: [
      { field: "appid", collection: "applications", idKey: "appid", label: "app", requiredForCreate: true }
    ]
  },
  column: {
    target: "column",
    collection: "columns",
    idKey: "columnid",
    nameKeys: ["columnname"],
    duplicateScopeKeys: ["tableid", "tablename"],
    parentRefs: [
      { field: "tableid", collection: "tables", idKey: "tableid", label: "table", requiredForCreate: true }
    ]
  },
  window: {
    target: "window",
    collection: "windows",
    idKey: "windowid",
    nameKeys: ["windowname"],
    duplicateScopeKeys: ["appid"],
    parentRefs: [
      { field: "appid", collection: "applications", idKey: "appid", label: "app", requiredForCreate: true }
    ]
  },
  tab: {
    target: "tab",
    collection: "tabs",
    idKey: "tabid",
    nameKeys: ["tabname"],
    duplicateScopeKeys: ["windowid"],
    parentRefs: [
      { field: "windowid", collection: "windows", idKey: "windowid", label: "window", requiredForCreate: true },
      { field: "tableid", collection: "tables", idKey: "tableid", label: "table", requiredForCreate: true }
    ]
  },
  field: {
    target: "field",
    collection: "fields",
    idKey: "fieldid",
    nameKeys: ["fieldname", "columnname"],
    duplicateScopeKeys: ["tabid"],
    parentRefs: [
      { field: "tabid", collection: "tabs", idKey: "tabid", label: "tab", requiredForCreate: true },
      { field: "columnid", collection: "columns", idKey: "columnid", label: "column" }
    ]
  },
  menu: {
    target: "menu",
    collection: "menus",
    idKey: "menuid",
    nameKeys: ["menuname"],
    duplicateScopeKeys: ["appid", "parentid"],
    parentRefs: [
      { field: "appid", collection: "applications", idKey: "appid", label: "app", requiredForCreate: true },
      { field: "windowid", collection: "windows", idKey: "windowid", label: "window" }
    ]
  },
  domain: {
    target: "domain",
    collection: "domains",
    idKey: "domainid",
    nameKeys: ["domainname", "name"],
    duplicateScopeKeys: [],
    parentRefs: []
  }
};

const WRITE_FIELD_KEYS: Record<AppBuilderTarget, string[]> = {
  application: [
    "appid", "appname", "appcode", "description", "siteid", "seqno", "active", "icon", "background"
  ],
  table: [
    "tableid", "appid", "tablename", "tabletype", "alias", "description", "columnkey", "columncode",
    "columndisplay", "columnfind", "urlview", "urledit", "serviceid", "servicetype", "isreadonly",
    "isview", "seqno", "active"
  ],
  column: [
    "columnid", "tableid", "tablename", "columnname", "caption", "label", "datatype", "columntype",
    "length", "precision", "scale", "isprimarykey", "isrequired", "isreadonly", "isvisible",
    "defaultvalue", "description", "seqno", "active"
  ],
  window: [
    "windowid", "appid", "windowname", "windowtype", "translate", "description", "execname",
    "configjson", "layoutjson", "isopenfind", "seqno", "active"
  ],
  tab: [
    "tabid", "windowid", "tabname", "translate", "parenttabid", "tablevel", "seqno", "tableid",
    "linktableid", "linkchildfield", "linkparentfield", "relatetableid", "relatechildfield",
    "relateparentfield", "workflowid", "isviewonly", "noinsert", "noupdate", "nodelete", "noselect",
    "noexport", "active"
  ],
  field: [
    "fieldid", "fieldname", "columnid", "columnname", "tableid", "tabid", "caption", "label",
    "translate", "datatype", "fieldtype", "columntype", "controltype", "domainid", "defaultvalue",
    "isrequired", "isreadonly", "isvisible", "isprimarykey", "width", "height", "seqno", "active"
  ],
  menu: [
    "menuid", "menuname", "translate", "parentid", "seqno", "linktype", "linkwindowid",
    "windowid", "appid", "execname", "icon", "reportid", "active"
  ],
  domain: [
    "domainid", "domainname", "name", "description", "domainjson", "datatype", "controltype",
    "iseditable", "seqno", "active"
  ]
};

export const APP_BUILDER_WRITE_TOOL_NAMES = [
  "app_builder_prepare_plan",
  "app_builder_apply_plan",
  "app_builder_validate_plan",
  "app_builder_create_app",
  "app_builder_update_app",
  "app_builder_create_table",
  "app_builder_update_table",
  "app_builder_create_column",
  "app_builder_update_column",
  "app_builder_create_window",
  "app_builder_update_window",
  "app_builder_create_tab",
  "app_builder_update_tab",
  "app_builder_create_field",
  "app_builder_update_field",
  "app_builder_create_menu",
  "app_builder_update_menu",
  "app_builder_create_domain",
  "app_builder_update_domain"
] as const;

export function getWriteToolRoute(name: string): AppBuilderWriteOptions["mode"] | null {
  if (name.startsWith("app_builder_create_")) return "create";
  if (name.startsWith("app_builder_update_")) return "update";
  return null;
}

export function getWriteToolTarget(name: string): AppBuilderTarget | null {
  const raw = name
    .replace(/^app_builder_create_/, "")
    .replace(/^app_builder_update_/, "");
  if (raw === "app") return "application";
  return isTarget(raw) ? raw : null;
}

export async function validateAppBuilderPlan(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const blueprint = await getValidationBlueprint(env, session);
  const actions = normalizePlanActions(args);
  const blockingErrors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!actions.length) {
    blockingErrors.push({
      message: "Plan không có steps/actions hợp lệ. Hãy truyền plan.steps hoặc actions là mảng thao tác."
    });
  }

  for (const action of actions) {
    validateAction(action, blueprint, blockingErrors, warnings);
  }

  return {
    valid: blockingErrors.length === 0,
    requires_confirmation: true,
    message: blockingErrors.length
      ? "Plan chưa đủ an toàn để ghi. Cần sửa các lỗi blocking trước."
      : "Plan hợp lệ ở mức kiểm tra cấu trúc/đụng độ hiện có. Cần trình bày cho người dùng xác nhận trước khi gọi write tool.",
    blocking_errors: blockingErrors,
    warnings,
    normalized_plan: {
      intent: typeof args.intent === "string" ? args.intent : undefined,
      actions
    },
    next_step: blockingErrors.length
      ? "Sửa plan hoặc hỏi lại người dùng để bổ sung thông tin."
      : "Trình bày plan ngắn gọn cho người dùng và chỉ gọi create/update tool khi người dùng xác nhận rõ ràng.",
    blueprint_snapshot: buildBlueprintSnapshot(blueprint)
  };
}

export async function writeAppBuilderRecord(
  env: Env,
  session: ZilcodeSession,
  options: AppBuilderWriteOptions
): Promise<Record<string, unknown>> {
  const spec = TARGET_SPECS[options.target];
  const confirmed = getBooleanArg(options.args, "confirmed", false);
  if (!confirmed) {
    return {
      ok: false,
      blocked: true,
      reason: "Write tool bị chặn vì thiếu confirmed=true.",
      required_confirmation: "Agent phải trình bày plan cho người dùng và chỉ truyền confirmed=true khi người dùng xác nhận rõ ràng."
    };
  }

  const record = getObjectArg(options.args, options.mode === "create" ? "record" : "patch");
  if (!record) {
    return {
      ok: false,
      blocked: true,
      reason: options.mode === "create"
        ? "Thiếu record cần tạo."
        : "Thiếu patch cần cập nhật."
    };
  }

  const blueprint = await getValidationBlueprint(env, session);
  const validationAction: NormalizedAction = {
    index: 0,
    action: `${options.mode}_${options.target}`,
    mode: options.mode,
    target: options.target,
    record: options.mode === "create" ? record : undefined,
    patch: options.mode === "update" ? record : undefined,
    key_value: getPrimitiveArg(options.args, "key_value") ?? getPrimitiveArg(options.args, spec.idKey),
    where: getStringArg(options.args, "where")
  };
  const blockingErrors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  validateAction(validationAction, blueprint, blockingErrors, warnings);
  if (blockingErrors.length) {
    return {
      ok: false,
      blocked: true,
      reason: "Write tool bị chặn vì validate không đạt.",
      blocking_errors: blockingErrors,
      warnings
    };
  }

  const source = getSourceTable(blueprint, spec.collection);
  if (!source?.urlview) {
    return {
      ok: false,
      blocked: true,
      reason: `Không tìm thấy endpoint urlview cho collection ${spec.collection} trong AppBuilderBlueprint.`
    };
  }

  const endpoint = options.mode === "create"
    ? addQueryParams(stripQuery(String(source.urlview)), { returnid: "true" })
    : buildUpdateEndpoint(String(source.urlview), validationAction);
  const payloadRecord = options.mode === "create"
    ? applyCreateDefaults(options.target, record, session)
    : record;
  const envelope = await callZilcodeJson<unknown>(env, endpoint, {
    method: options.mode === "create" ? "POST" : "PUT",
    token: session.token,
    baseUrl: session.base_url,
    data: [payloadRecord]
  });
  const result = assertZilcodeSuccess(envelope);

  return {
    ok: true,
    mode: options.mode,
    target: options.target,
    endpoint,
    result,
    warnings,
    verify_next: {
      tool: "zilcode_get_app_builder_blueprint",
      arguments: {
        mode: "graph",
        include_records: "true"
      },
      instruction: "Sau khi ghi, agent phải đọc lại blueprint để xác minh record/quan hệ đã xuất hiện đúng."
    }
  };
}

function isTarget(value: string): value is AppBuilderTarget {
  return Object.prototype.hasOwnProperty.call(TARGET_SPECS, value);
}

function getStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

function getBooleanArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const value = args[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function getObjectArg(args: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const value = args[name];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getArrayArg(args: Record<string, unknown>, name: string): unknown[] {
  const value = args[name];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getPrimitiveArg(args: Record<string, unknown>, name: string): string | number | undefined {
  const value = args[name];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

async function getValidationBlueprint(env: Env, session: ZilcodeSession): Promise<Record<string, unknown>> {
  return buildZilcodeAppBuilderBlueprint(env, session, {
    mode: "graph",
    include_records: "true",
    include_fields: "false",
    max_records_per_table: "2000"
  });
}

function normalizePlanActions(args: Record<string, unknown>): NormalizedAction[] {
  const plan = getObjectArg(args, "plan");
  const rawActions = getArrayArg(args, "actions");
  const steps = rawActions.length
    ? rawActions
    : Array.isArray(plan?.steps)
      ? plan.steps
      : [];

  return steps
    .map((step, index): NormalizedAction | null => {
      if (!step || typeof step !== "object") return null;
      const data = step as Record<string, unknown>;
      const action = String(data.action ?? data.type ?? "").trim();
      const mode = action.startsWith("update_") ? "update" : "create";
      const target = inferActionTarget(action, data);
      if (!target) return null;
      const record = getObjectArg(data, "record") ?? getObjectArg(data, "data");
      const patch = getObjectArg(data, "patch") ?? record;

      return {
        index,
        action,
        mode,
        target,
        record: mode === "create" ? record ?? undefined : undefined,
        patch: mode === "update" ? patch ?? undefined : undefined,
        key_value: getPrimitiveArg(data, "key_value")
          ?? getPrimitiveArg(data, "id")
          ?? getPrimitiveArg(data, TARGET_SPECS[target].idKey),
        where: getStringArg(data, "where")
      };
    })
    .filter((action): action is NormalizedAction => Boolean(action));
}

function inferActionTarget(action: string, data: Record<string, unknown>): AppBuilderTarget | null {
  const normalized = action.toLowerCase();
  const directTarget = String(data.target ?? "").toLowerCase();
  if (directTarget === "app") return "application";
  if (isTarget(directTarget)) return directTarget;

  if (normalized.includes("application") || normalized.endsWith("_app")) return "application";
  for (const target of Object.keys(TARGET_SPECS) as AppBuilderTarget[]) {
    if (normalized.includes(target)) return target;
  }
  return null;
}

function validateAction(
  action: NormalizedAction,
  blueprint: Record<string, unknown>,
  blockingErrors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const spec = TARGET_SPECS[action.target];
  const payload = action.mode === "create" ? action.record : action.patch;

  if (!payload || Object.keys(payload).length === 0) {
    blockingErrors.push({
      action: action.action,
      target: action.target,
      message: action.mode === "create" ? "Thiếu record cần tạo." : "Thiếu patch cần cập nhật."
    });
    return;
  }

  if (action.mode === "update" && !action.key_value && !action.where) {
    blockingErrors.push({
      action: action.action,
      target: action.target,
      message: `Update ${action.target} phải có key_value (${spec.idKey}) hoặc where rõ ràng.`
    });
  }

  if (action.mode === "update" && action.key_value && !findRecord(blueprint, spec.collection, spec.idKey, action.key_value)) {
    blockingErrors.push({
      action: action.action,
      target: action.target,
      field: spec.idKey,
      message: `Không tìm thấy ${action.target} có ${spec.idKey}=${action.key_value}.`
    });
  }

  for (const parent of spec.parentRefs) {
    const value = getCaseInsensitiveValue(payload, parent.field);
    if (action.mode === "create" && parent.requiredForCreate && isBlank(value)) {
      blockingErrors.push({
        action: action.action,
        target: action.target,
        field: parent.field,
        message: `Thiếu ${parent.field}; cần biết ${parent.label} cha trước khi tạo ${action.target}.`
      });
      continue;
    }

    if (!isBlank(value) && !findRecord(blueprint, parent.collection, parent.idKey, value)) {
      blockingErrors.push({
        action: action.action,
        target: action.target,
        field: parent.field,
        message: `Không tìm thấy ${parent.label} có ${parent.idKey}=${String(value)} trong App Builder hiện tại.`
      });
    }
  }

  if (action.mode === "create") {
    for (const nameKey of spec.nameKeys) {
      const value = getCaseInsensitiveValue(payload, nameKey);
      if (isBlank(value)) continue;
      const duplicate = findDuplicateByName(blueprint, spec, nameKey, value, payload);
      if (duplicate) {
        blockingErrors.push({
          action: action.action,
          target: action.target,
          field: nameKey,
          message: `${action.target} đã tồn tại ${nameKey}=${String(value)} trong cùng phạm vi.`
        });
      }
    }
  }

  if (action.target === "field" && action.mode === "create") {
    const columnid = getCaseInsensitiveValue(payload, "columnid");
    const columnname = getCaseInsensitiveValue(payload, "columnname");
    if (isBlank(columnid) && isBlank(columnname)) {
      warnings.push({
        action: action.action,
        target: action.target,
        message: "Field chưa có columnid/columnname. Chỉ nên tiếp tục nếu đây là field tính toán hoặc field đặc biệt."
      });
    }
  }
}

function getCaseInsensitiveValue(record: Record<string, unknown>, key: string): unknown {
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function getRecords(blueprint: Record<string, unknown>, collection: string): Record<string, unknown>[] {
  const appBuilderRecords = asRecord(blueprint.app_builder_records);
  const collections = asRecord(appBuilderRecords?.collections);
  const group = asRecord(collections?.[collection]);
  const records = group?.records;
  return Array.isArray(records)
    ? records.filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object")
    : [];
}

function getSourceTable(blueprint: Record<string, unknown>, collection: string): Record<string, unknown> | null {
  const appBuilderRecords = asRecord(blueprint.app_builder_records);
  const collections = asRecord(appBuilderRecords?.collections);
  const group = asRecord(collections?.[collection]);
  return asRecord(group?.source_table);
}

function findRecord(
  blueprint: Record<string, unknown>,
  collection: string,
  key: string,
  value: unknown
): Record<string, unknown> | undefined {
  if (isBlank(value)) return undefined;
  return getRecords(blueprint, collection).find(record =>
    String(getCaseInsensitiveValue(record, key) ?? "") === String(value)
  );
}

function findDuplicateByName(
  blueprint: Record<string, unknown>,
  spec: TargetSpec,
  nameKey: string,
  value: unknown,
  payload: Record<string, unknown>
): Record<string, unknown> | undefined {
  return getRecords(blueprint, spec.collection).find(record => {
    const current = getCaseInsensitiveValue(record, nameKey);
    if (String(current ?? "").toLowerCase() !== String(value).toLowerCase()) return false;
    return spec.duplicateScopeKeys.every(scopeKey => {
      const scopeValue = getCaseInsensitiveValue(payload, scopeKey);
      if (isBlank(scopeValue)) return true;
      return String(getCaseInsensitiveValue(record, scopeKey) ?? "") === String(scopeValue);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stripQuery(pathOrUrl: string): string {
  return pathOrUrl.split("?")[0];
}

function addQueryParams(pathOrUrl: string, params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "");
  if (!entries.length) return pathOrUrl;
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${pathOrUrl}${pathOrUrl.includes("?") ? "&" : "?"}${query}`;
}

function buildUpdateEndpoint(urlview: string, action: NormalizedAction): string {
  const base = stripQuery(urlview);
  if (action.key_value !== undefined && action.key_value !== "") {
    return addQueryParams(base, { key: action.key_value });
  }
  if (action.where) return addQueryParams(base, { where: action.where });
  throw new Error("Update endpoint cần key_value hoặc where.");
}

function applyCreateDefaults(
  target: AppBuilderTarget,
  record: Record<string, unknown>,
  session: ZilcodeSession
): Record<string, unknown> {
  const output = { ...record };
  if (target === "application") {
    if (output.active === undefined) output.active = true;
    if (output.siteid === undefined) {
      const siteid = getCaseInsensitiveValue(session.user, "siteid");
      if (siteid !== undefined) output.siteid = siteid;
    }
  }
  return output;
}

function buildBlueprintSnapshot(blueprint: Record<string, unknown>): Record<string, unknown> {
  const appBuilderRecords = asRecord(blueprint.app_builder_records);
  const inventory = asRecord(appBuilderRecords?.inventory);
  return {
    apps_count: inventory?.apps_count,
    relationships: appBuilderRecords?.relationships,
    collections: Object.fromEntries(
      Object.entries(asRecord(appBuilderRecords?.collections) ?? {}).map(([key, value]) => [
        key,
        {
          records_count: asRecord(value)?.records_count,
          source_table: asRecord(value)?.source_table
        }
      ])
    )
  };
}

export function summarizeWriteError(error: unknown): Record<string, unknown> {
  return {
    ok: false,
    error: getErrorText(error)
  };
}

// ─── Plan orchestration ─────────────────────────────────────────────────────

type PlanStatus = "valid" | "invalid" | "need_user_input";

interface PreparedOperation {
  id: string;
  op: string;
  mode: WriteMode;
  target: AppBuilderTarget;
  record?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  key_value?: string | number;
  where?: string;
  label: string;
}

interface PendingPlan {
  plan_id: string;
  session_id: string;
  status: "pending_confirmation";
  intent?: string;
  summary: string;
  operations: PreparedOperation[];
  warnings: ValidationIssue[];
  created_at: string;
  expires_at: string;
}

const APP_BUILDER_PLAN_PREFIX = "app_builder_plan:";
const APP_BUILDER_CURRENT_PLAN_PREFIX = "app_builder_current_plan:";
const DEFAULT_PLAN_TTL_SECONDS = 60 * 30;

export async function prepareAppBuilderPlan(
  env: Env,
  session: ZilcodeSession,
  sessionId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const blueprint = await getValidationBlueprint(env, session);
  const operations = buildPreparedOperations(args, blueprint);
  const blockingErrors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!operations.length) {
    blockingErrors.push({
      message: "Không tạo được operation hợp lệ từ plan. Hãy truyền plan.operations, plan.steps hoặc plan có app/tables/windows/menus rõ ràng."
    });
  }

  for (const operation of operations) {
    validatePreparedOperation(operation, blueprint, operations, blockingErrors, warnings);
  }

  const status: PlanStatus = blockingErrors.length
    ? "invalid"
    : operations.some(operation => hasUnresolvedReference(operation.record) || hasUnresolvedReference(operation.patch))
      ? "need_user_input"
      : "valid";

  if (status !== "valid") {
    return {
      status,
      valid: false,
      requires_confirmation: false,
      blocking_errors: blockingErrors,
      warnings,
      normalized_plan: { operations },
      next_step: status === "need_user_input"
        ? "Hỏi lại người dùng hoặc đọc thêm blueprint để resolve phần còn thiếu."
        : "Sửa plan trước khi xin xác nhận."
    };
  }

  const now = Date.now();
  const planId = crypto.randomUUID();
  const pendingPlan: PendingPlan = {
    plan_id: planId,
    session_id: sessionId,
    status: "pending_confirmation",
    intent: typeof args.intent === "string" ? args.intent : undefined,
    summary: buildPlanSummary(operations),
    operations,
    warnings,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + DEFAULT_PLAN_TTL_SECONDS * 1000).toISOString()
  };

  await getPlanStore(env).put(
    getPlanKey(sessionId, planId),
    JSON.stringify(pendingPlan),
    { expirationTtl: DEFAULT_PLAN_TTL_SECONDS }
  );
  await getPlanStore(env).put(
    getCurrentPlanKey(sessionId),
    planId,
    { expirationTtl: DEFAULT_PLAN_TTL_SECONDS }
  );

  return {
    status: "valid",
    valid: true,
    requires_confirmation: true,
    plan_id: planId,
    summary: pendingPlan.summary,
    warnings,
    normalized_plan: {
      operations
    },
    next_step: "Trình bày summary cho người dùng xác nhận. Khi người dùng đồng ý, gọi app_builder_apply_plan với plan_id này và confirmed=true."
  };
}

export async function applyAppBuilderPlan(
  env: Env,
  session: ZilcodeSession,
  sessionId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let planId = getStringArg(args, "plan_id");
  const confirmed = getBooleanArg(args, "confirmed", false);

  if (!planId) {
    planId = await getPlanStore(env).get(getCurrentPlanKey(sessionId)) ?? "";
  }

  if (!planId) {
    return { ok: false, blocked: true, reason: "Thiếu plan_id và không tìm thấy pending plan hiện tại của phiên." };
  }

  if (!confirmed) {
    return {
      ok: false,
      blocked: true,
      reason: "Thiếu confirmed=true. Chỉ apply plan sau khi người dùng xác nhận rõ ràng."
    };
  }

  const rawPlan = await getPlanStore(env).get(getPlanKey(sessionId, planId));
  if (!rawPlan) {
    return {
      ok: false,
      blocked: true,
      reason: "Không tìm thấy pending plan hoặc plan đã hết hạn."
    };
  }

  const pendingPlan = JSON.parse(rawPlan) as PendingPlan;
  const idMap: Record<string, string | number> = {};
  const applied: Record<string, unknown>[] = [];
  const failed: Record<string, unknown>[] = [];

  for (const operation of pendingPlan.operations) {
    try {
      const resolvedOperation = resolveOperationReferences(operation, idMap);
      const result = await writeAppBuilderRecord(env, session, {
        mode: resolvedOperation.mode,
        target: resolvedOperation.target,
        args: resolvedOperation.mode === "create"
          ? { record: resolvedOperation.record, confirmed: true }
          : {
            patch: resolvedOperation.patch,
            key_value: resolvedOperation.key_value,
            where: resolvedOperation.where,
            confirmed: true
          }
      });

      if (!result.ok) {
        failed.push({
          operation: operation.id,
          label: operation.label,
          result
        });
        break;
      }

      const createdId = await resolveWrittenRecordId(env, session, resolvedOperation, result);
      if (createdId !== undefined) idMap[operation.id] = createdId;

      applied.push({
        operation: operation.id,
        label: operation.label,
        target: operation.target,
        mode: operation.mode,
        id: createdId,
        result
      });
    } catch (error) {
      failed.push({
        operation: operation.id,
        label: operation.label,
        error: getErrorText(error)
      });
      break;
    }
  }

  const verification = await buildZilcodeAppBuilderBlueprint(env, session, {
    mode: "graph",
    include_records: "true",
    include_fields: "false",
    max_records_per_table: "2000"
  });

  if (!failed.length) {
    await getPlanStore(env).delete(getPlanKey(sessionId, planId));
    await getPlanStore(env).delete(getCurrentPlanKey(sessionId));
  }

  return {
    ok: failed.length === 0,
    status: failed.length ? "partial_success" : "completed",
    plan_id: planId,
    applied_count: applied.length,
    failed_count: failed.length,
    applied,
    failed,
    id_map: idMap,
    verification: {
      apps_count: verification.apps_count,
      overview: verification.overview,
      note: "Đã đọc lại AppBuilderBlueprint sau khi apply để xác minh trạng thái mới."
    }
  };
}

function getPlanStore(env: Env): KVNamespace {
  return env.ZILCODE_SESSIONS ?? env.CHUNKS;
}

function getPlanKey(sessionId: string, planId: string): string {
  return `${APP_BUILDER_PLAN_PREFIX}${sessionId}:${planId}`;
}

function getCurrentPlanKey(sessionId: string): string {
  return `${APP_BUILDER_CURRENT_PLAN_PREFIX}${sessionId}`;
}

function buildPreparedOperations(
  args: Record<string, unknown>,
  blueprint: Record<string, unknown>
): PreparedOperation[] {
  const plan = getObjectArg(args, "plan") ?? {};
  const explicitOperations = getArrayArg(plan, "operations").length
    ? getArrayArg(plan, "operations")
    : getArrayArg(args, "operations");
  const explicitSteps = getArrayArg(plan, "steps").length
    ? getArrayArg(plan, "steps")
    : getArrayArg(args, "actions");
  const operations = explicitOperations.length
    ? explicitOperations
    : explicitSteps;

  if (operations.length) {
    const normalized = operations
      .map((item, index) => normalizePreparedOperation(item, index, blueprint))
      .filter((item): item is PreparedOperation => Boolean(item));
    return linkPreparedOperationReferences(normalized, blueprint);
  }

  return linkPreparedOperationReferences(buildOperationsFromStructuredPlan(plan, blueprint), blueprint);
}

function linkPreparedOperationReferences(
  operations: PreparedOperation[],
  blueprint: Record<string, unknown>
): PreparedOperation[] {
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    const payload = operation.mode === "create" ? operation.record : operation.patch;
    if (!payload) continue;

    if (operation.mode === "update" && operation.key_value === undefined && !operation.where) {
      operation.key_value = resolveUpdateKeyValue(operation.target, payload, blueprint);
    }

    if (operation.target === "table") {
      payload.appid ??= resolvePreparedParentRef(operations, index, "application", payload, ["appname", "app_name"]);
    }

    if (operation.target === "column") {
      payload.tableid ??= resolvePreparedParentRef(operations, index, "table", payload, ["tablename", "table_name"]);
      payload.tablename ??= payload.table_name;
    }

    if (operation.target === "window") {
      payload.appid ??= resolvePreparedParentRef(operations, index, "application", payload, ["appname", "app_name"]);
    }

    if (operation.target === "tab") {
      payload.windowid ??= resolvePreparedParentRef(operations, index, "window", payload, ["windowname", "window_name"]);
      payload.tableid ??= resolvePreparedParentRef(operations, index, "table", payload, ["tablename", "table_name"]);
    }

    if (operation.target === "field") {
      payload.tabid ??= resolvePreparedParentRef(operations, index, "tab", payload, ["tabname", "tab_name"]);
      payload.columnid ??= resolvePreparedParentRef(operations, index, "column", payload, ["columnname", "column_name", "name"]);
      payload.columnname ??= payload.column_name ?? payload.name;
      payload.fieldname ??= payload.name ?? payload.columnname;
    }

    if (operation.target === "menu") {
      payload.appid ??= resolvePreparedParentRef(operations, index, "application", payload, ["appname", "app_name"]);
      payload.windowid ??= payload.linkwindowid ?? resolvePreparedParentRef(operations, index, "window", payload, ["windowname", "window_name"]);
      payload.linkwindowid ??= payload.windowid;
    }
  }

  return operations;
}

function resolvePreparedParentRef(
  operations: PreparedOperation[],
  beforeIndex: number,
  target: AppBuilderTarget,
  childPayload: Record<string, unknown>,
  childNameKeys: string[]
): string | number | undefined {
  const requestedName = childNameKeys
    .map(key => getCaseInsensitiveValue(childPayload, key))
    .find(value => !isBlank(value));

  for (let index = beforeIndex - 1; index >= 0; index--) {
    const candidate = operations[index];
    if (candidate.target !== target || candidate.mode !== "create" || !candidate.record) continue;
    if (requestedName !== undefined && !recordNameMatches(candidate.record, target, requestedName)) continue;
    return ref(candidate.id, TARGET_SPECS[target].idKey);
  }

  return undefined;
}

function recordNameMatches(record: Record<string, unknown>, target: AppBuilderTarget, value: unknown): boolean {
  const expected = String(value).toLowerCase();
  return TARGET_SPECS[target].nameKeys.some(key =>
    String(getCaseInsensitiveValue(record, key) ?? "").toLowerCase() === expected
  );
}

function buildOperationsFromStructuredPlan(
  plan: Record<string, unknown>,
  blueprint: Record<string, unknown>
): PreparedOperation[] {
  const operations: PreparedOperation[] = [];
  const app = getObjectArg(plan, "app") ?? getObjectArg(getObjectArg(plan, "target") ?? {}, "app");
  const existingAppId = app ? resolveAppId(blueprint, app) : undefined;
  const appName = app ? stringValue(app.appname ?? app.name ?? app.app_name) : "";
  const appCode = app ? stringValue(app.appcode ?? app.code) || slugify(appName) : "";
  let appRef = existingAppId;

  if (app && !existingAppId) {
    const op = makePreparedOperation("create_application", "application", {
      appname: appName,
      appcode: appCode,
      description: app.description
    }, operations.length);
    operations.push(op);
    appRef = ref(op.id, TARGET_SPECS.application.idKey);
  }

  for (const tableValue of getArrayArg(plan, "tables")) {
    const table = asRecord(tableValue);
    if (!table) continue;
    const tableName = normalizeDbName(stringValue(table.tablename ?? table.name ?? table.table_name));
    const tableOp = makePreparedOperation("create_table", "table", {
      appid: appRef,
      tablename: tableName,
      alias: table.alias ?? table.label ?? table.description ?? tableName,
      tabletype: table.tabletype ?? "table",
      columnkey: table.primary_key ?? table.columnkey
    }, operations.length);
    operations.push(tableOp);
    const tableRef = ref(tableOp.id, TARGET_SPECS.table.idKey);

    for (const columnValue of getArrayArg(table, "columns")) {
      const column = asRecord(columnValue);
      if (!column) continue;
      operations.push(makePreparedOperation("create_column", "column", {
        tableid: tableRef,
        tablename: tableName,
        columnname: normalizeDbName(stringValue(column.columnname ?? column.name ?? column.column_name)),
        caption: column.caption ?? column.label,
        label: column.label ?? column.caption,
        datatype: normalizeDatatype(column.datatype ?? column.type),
        columntype: column.columntype ?? normalizeDatatype(column.datatype ?? column.type),
        isprimarykey: column.isprimarykey ?? column.is_primary ?? column.primary_key,
        isrequired: column.isrequired ?? column.is_required,
        defaultvalue: column.defaultvalue ?? column.default,
        seqno: column.seqno
      }, operations.length));
    }
  }

  for (const windowValue of getArrayArg(plan, "windows")) {
    const windowRecord = asRecord(windowValue);
    if (!windowRecord) continue;
    const windowOp = makePreparedOperation("create_window", "window", {
      appid: appRef,
      windowname: windowRecord.windowname ?? windowRecord.name,
      windowtype: windowRecord.windowtype ?? windowRecord.type ?? "window",
      translate: windowRecord.translate ?? windowRecord.label
    }, operations.length);
    operations.push(windowOp);
    const windowRef = ref(windowOp.id, TARGET_SPECS.window.idKey);

    for (const tabValue of getArrayArg(windowRecord, "tabs")) {
      const tab = asRecord(tabValue);
      if (!tab) continue;
      const tabName = tab.tabname ?? tab.name ?? tab.label;
      const tableName = tab.tablename ?? tab.table_name ?? tab.table;
      const tabOp = makePreparedOperation("create_tab", "tab", {
        windowid: windowRef,
        table_name: tableName,
        tabname: tabName,
        translate: tab.translate ?? tab.label ?? tabName,
        parenttabid: tab.parenttabid,
        tablevel: tab.tablevel ?? tab.level ?? 0,
        seqno: tab.seqno ?? tab.order
      }, operations.length);
      operations.push(tabOp);
      const tabRef = ref(tabOp.id, TARGET_SPECS.tab.idKey);

      for (const fieldValue of getArrayArg(tab, "fields")) {
        const field = asRecord(fieldValue);
        if (!field) continue;
        const fieldName = field.fieldname ?? field.name ?? field.columnname ?? field.column_name;
        operations.push(makePreparedOperation("create_field", "field", {
          tabid: tabRef,
          table_name: tableName,
          column_name: field.columnname ?? field.column_name ?? field.name,
          fieldname: fieldName,
          translate: field.translate ?? field.label ?? field.caption ?? fieldName,
          caption: field.caption ?? field.label,
          label: field.label ?? field.caption,
          fieldtype: field.fieldtype ?? field.field_type,
          datatype: normalizeDatatype(field.datatype ?? field.type),
          domainid: field.domainid,
          isrequired: field.isrequired ?? field.is_required,
          isreadonly: field.isreadonly ?? field.is_readonly,
          isvisible: field.isvisible ?? field.is_visible,
          seqno: field.seqno ?? field.order
        }, operations.length));
      }
    }
  }

  for (const menuValue of getArrayArg(plan, "menus")) {
    const menu = asRecord(menuValue);
    if (!menu) continue;
    operations.push(makePreparedOperation("create_menu", "menu", {
      appid: appRef,
      menuname: menu.menuname ?? menu.name,
      translate: menu.translate ?? menu.label ?? menu.menuname ?? menu.name,
      icon: menu.icon,
      windowid: menu.windowid,
      window_name: menu.windowname ?? menu.window_name
    }, operations.length));
  }

  return operations;
}

function normalizePreparedOperation(
  value: unknown,
  index: number,
  blueprint: Record<string, unknown>
): PreparedOperation | null {
  const data = asRecord(value);
  if (!data) return null;

  const action = String(data.action ?? data.op ?? data.type ?? "").trim();
  const target = inferActionTarget(action, data);
  if (!target) return null;

  const mode: WriteMode = action.startsWith("update_") || action.startsWith("edit_") ? "update" : "create";
  const sourceRecord = mode === "create"
    ? getObjectArg(data, "record") ?? getObjectArg(data, "data") ?? data
    : getObjectArg(data, "patch") ?? getObjectArg(data, "data") ?? data;
  const mapped = mapRecordForTarget(target, sourceRecord, blueprint);

  return {
    id: stringValue(data.id) || `${mode}_${target}_${index + 1}`,
    op: action || `${mode}_${target}`,
    mode,
    target,
    record: mode === "create" ? mapped : undefined,
    patch: mode === "update" ? mapped : undefined,
    key_value: getPrimitiveArg(data, "key_value")
      ?? getPrimitiveArg(data, "id_value")
      ?? getPrimitiveArg(data, TARGET_SPECS[target].idKey),
    where: getStringArg(data, "where"),
    label: buildOperationLabel(mode, target, mapped)
  };
}

function makePreparedOperation(
  op: string,
  target: AppBuilderTarget,
  record: Record<string, unknown>,
  index: number
): PreparedOperation {
  return {
    id: `${op}_${index + 1}`,
    op,
    mode: "create",
    target,
    record,
    label: buildOperationLabel("create", target, record)
  };
}

function mapRecordForTarget(
  target: AppBuilderTarget,
  record: Record<string, unknown>,
  blueprint: Record<string, unknown>
): Record<string, unknown> {
  if (target === "application") {
    const appname = stringValue(record.appname ?? record.name ?? record.app_name);
    return removeBlankValues({
      ...record,
      appname,
      appcode: stringValue(record.appcode ?? record.code) || slugify(appname),
      description: record.description,
      active: record.active ?? true
    });
  }

  if (target === "table") {
    const appid = record.appid ?? resolveAppId(blueprint, record);
    const tablename = normalizeDbName(stringValue(record.tablename ?? record.name ?? record.table_name));
    return removeBlankValues({
      ...record,
      appid,
      tablename,
      alias: record.alias ?? record.label ?? record.description ?? tablename,
      tabletype: record.tabletype ?? record.type ?? "table",
      columnkey: record.columnkey ?? record.primary_key,
      isreadonly: record.isreadonly ?? false,
      isview: record.isview ?? false
    });
  }

  if (target === "column") {
    const tableid = record.tableid ?? resolveTableId(blueprint, record);
    const columnname = normalizeDbName(stringValue(record.columnname ?? record.name ?? record.column_name));
    const datatype = normalizeDatatype(record.datatype ?? record.type);
    return removeBlankValues({
      ...record,
      tableid,
      columnname,
      caption: record.caption ?? record.label,
      label: record.label ?? record.caption,
      datatype,
      columntype: record.columntype ?? datatype,
      isprimarykey: record.isprimarykey ?? record.is_primary ?? record.primary_key,
      isrequired: record.isrequired ?? record.is_required,
      defaultvalue: record.defaultvalue ?? record.default
    });
  }

  if (target === "window") {
    const appid = record.appid ?? resolveAppId(blueprint, record);
    return removeBlankValues({
      ...record,
      appid,
      windowname: record.windowname ?? record.name,
      windowtype: record.windowtype ?? record.type ?? "window",
      translate: record.translate ?? record.label
    });
  }

  if (target === "tab") {
    return removeBlankValues({
      ...record,
      windowid: record.windowid,
      tableid: record.tableid ?? resolveTableId(blueprint, record),
      tabname: record.tabname ?? record.name,
      tablevel: record.tablevel ?? 0,
      seqno: record.seqno ?? record.order
    });
  }

  if (target === "field") {
    return removeBlankValues({
      ...record,
      tabid: record.tabid,
      columnid: record.columnid ?? resolveColumnId(blueprint, record),
      fieldname: record.fieldname ?? record.name ?? record.columnname,
      columnname: record.columnname ?? record.name,
      translate: record.translate ?? record.label,
      fieldtype: record.fieldtype ?? record.field_type,
      seqno: record.seqno ?? record.order
    });
  }

  if (target === "menu") {
    const appid = record.appid ?? resolveAppId(blueprint, record);
    return removeBlankValues({
      ...record,
      appid,
      menuname: record.menuname ?? record.name,
      translate: record.translate ?? record.label ?? record.menuname ?? record.name,
      windowid: record.windowid ?? record.linkwindowid
    });
  }

  return removeBlankValues({
    ...record,
    domainname: record.domainname ?? record.name,
    name: record.name ?? record.domainname
  });
}

function validatePreparedOperation(
  operation: PreparedOperation,
  blueprint: Record<string, unknown>,
  operations: PreparedOperation[],
  blockingErrors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const spec = TARGET_SPECS[operation.target];
  const payload = operation.mode === "create" ? operation.record : operation.patch;

  if (!payload || Object.keys(payload).length === 0) {
    blockingErrors.push({ action: operation.op, target: operation.target, message: "Operation thiếu payload." });
    return;
  }

  for (const key of spec.nameKeys) {
    if (operation.mode === "create" && isBlank(getCaseInsensitiveValue(payload, key))) {
      warnings.push({
        action: operation.op,
        target: operation.target,
        field: key,
        message: `Thiếu ${key}; executor vẫn có thể ghi nếu bảng Zilcode cho phép, nhưng nên bổ sung để dễ verify.`
      });
    }
  }

  for (const parent of spec.parentRefs) {
    const value = getCaseInsensitiveValue(payload, parent.field);
    if (operation.mode === "create" && parent.requiredForCreate && isBlank(value)) {
      blockingErrors.push({
        action: operation.op,
        target: operation.target,
        field: parent.field,
        message: `Thiếu ${parent.field}; cần resolve ${parent.label} trước khi tạo ${operation.target}.`
      });
      continue;
    }

    if (isPlanRef(value)) continue;
    if (!isBlank(value) && !findRecord(blueprint, parent.collection, parent.idKey, value)) {
      blockingErrors.push({
        action: operation.op,
        target: operation.target,
        field: parent.field,
        message: `Không tìm thấy ${parent.label} có ${parent.idKey}=${String(value)} trong blueprint hiện tại.`
      });
    }
  }

  if (operation.mode === "create") {
    validateCreateDuplicate(operation, blueprint, operations, blockingErrors);
  }

  if (operation.mode === "update" && !operation.key_value && !operation.where) {
    blockingErrors.push({
      action: operation.op,
      target: operation.target,
      message: `Update ${operation.target} cần key_value hoặc where.`
    });
  }
}

function validateCreateDuplicate(
  operation: PreparedOperation,
  blueprint: Record<string, unknown>,
  operations: PreparedOperation[],
  blockingErrors: ValidationIssue[]
): void {
  const spec = TARGET_SPECS[operation.target];
  const payload = operation.record ?? {};
  for (const nameKey of spec.nameKeys) {
    const value = getCaseInsensitiveValue(payload, nameKey);
    if (isBlank(value)) continue;

    const duplicate = findDuplicateByName(blueprint, spec, nameKey, value, payload);
    if (duplicate) {
      blockingErrors.push({
        action: operation.op,
        target: operation.target,
        field: nameKey,
        message: `${operation.target} đã tồn tại ${nameKey}=${String(value)}.`
      });
    }

    const duplicateInPlan = operations.some(other =>
      other !== operation
      && other.target === operation.target
      && other.mode === "create"
      && String(getCaseInsensitiveValue(other.record ?? {}, nameKey) ?? "").toLowerCase() === String(value).toLowerCase()
      && sameDuplicateScope(spec, payload, other.record ?? {})
    );
    if (duplicateInPlan) {
      blockingErrors.push({
        action: operation.op,
        target: operation.target,
        field: nameKey,
        message: `Plan có nhiều operation tạo trùng ${operation.target} với ${nameKey}=${String(value)}.`
      });
    }
  }
}

function sameDuplicateScope(
  spec: TargetSpec,
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  return spec.duplicateScopeKeys.every(scopeKey => {
    const leftValue = getCaseInsensitiveValue(left, scopeKey);
    const rightValue = getCaseInsensitiveValue(right, scopeKey);
    if (isBlank(leftValue) || isBlank(rightValue)) return true;
    return String(leftValue) === String(rightValue);
  });
}

function resolveOperationReferences(
  operation: PreparedOperation,
  idMap: Record<string, string | number>
): PreparedOperation {
  const record = operation.record
    ? sanitizePayloadForWrite(operation.target, resolveValueReferences(operation.record, idMap) as Record<string, unknown>)
    : undefined;
  const patch = operation.patch
    ? sanitizePayloadForWrite(operation.target, resolveValueReferences(operation.patch, idMap) as Record<string, unknown>)
    : undefined;

  return {
    ...operation,
    record,
    patch,
    key_value: resolveValueReferences(operation.key_value, idMap) as string | number | undefined
  };
}

function sanitizePayloadForWrite(
  target: AppBuilderTarget,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const allowed = new Set(WRITE_FIELD_KEYS[target].map(key => key.toLowerCase()));
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) =>
      allowed.has(key.toLowerCase()) && value !== undefined && value !== null && value !== ""
    )
  );
}

function resolveValueReferences(value: unknown, idMap: Record<string, string | number>): unknown {
  if (typeof value === "string" && isPlanRef(value)) {
    const key = value.slice(1).split(".")[0];
    return idMap[key] ?? value;
  }
  if (Array.isArray(value)) return value.map(item => resolveValueReferences(item, idMap));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveValueReferences(item, idMap)])
    );
  }
  return value;
}

function hasUnresolvedReference(value: unknown): boolean {
  if (isPlanRef(value)) return false;
  if (Array.isArray(value)) return value.some(hasUnresolvedReference);
  if (value && typeof value === "object") return Object.values(value).some(hasUnresolvedReference);
  return false;
}

async function resolveWrittenRecordId(
  env: Env,
  session: ZilcodeSession,
  operation: PreparedOperation,
  result: Record<string, unknown>
): Promise<string | number | undefined> {
  const spec = TARGET_SPECS[operation.target];
  const direct = extractId(result.result, spec.idKey);
  if (direct !== undefined) return direct;

  const blueprint = await getValidationBlueprint(env, session);
  const payload = operation.record ?? operation.patch ?? {};
  for (const key of spec.nameKeys) {
    const value = getCaseInsensitiveValue(payload, key);
    if (isBlank(value)) continue;
    const record = findDuplicateByName(blueprint, spec, key, value, payload);
    const id = record ? getCaseInsensitiveValue(record, spec.idKey) : undefined;
    if (typeof id === "string" || typeof id === "number") return id;
  }

  return undefined;
}

function extractId(value: unknown, idKey: string): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractId(item, idKey);
      if (id !== undefined) return id;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const id = getCaseInsensitiveValue(record, idKey) ?? getCaseInsensitiveValue(record, "id") ?? getCaseInsensitiveValue(record, "returnid");
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return undefined;
}

function resolveUpdateKeyValue(
  target: AppBuilderTarget,
  payload: Record<string, unknown>,
  blueprint: Record<string, unknown>
): string | number | undefined {
  const spec = TARGET_SPECS[target];
  const explicit = getCaseInsensitiveValue(payload, spec.idKey) ?? getCaseInsensitiveValue(payload, "id");
  if (typeof explicit === "string" || typeof explicit === "number") return explicit;

  if (target === "application") return resolveAppId(blueprint, payload);
  if (target === "table") return resolveTableId(blueprint, payload);
  if (target === "column") return resolveColumnId(blueprint, payload);

  const lookupName = stringValue(
    payload.current_name
    ?? payload.target_name
    ?? payload.window_name
    ?? payload.tab_name
    ?? payload.field_name
    ?? payload.menu_name
    ?? payload.domain_name
    ?? payload.name
    ?? spec.nameKeys.map(key => getCaseInsensitiveValue(payload, key)).find(value => !isBlank(value))
  );
  if (!lookupName) return undefined;

  const record = getRecords(blueprint, spec.collection).find(candidate => {
    const sameName = spec.nameKeys.some(key =>
      String(getCaseInsensitiveValue(candidate, key) ?? "").toLowerCase() === lookupName.toLowerCase()
    );
    if (!sameName) return false;
    return spec.duplicateScopeKeys.every(scopeKey => {
      const scopeValue = getCaseInsensitiveValue(payload, scopeKey);
      if (isBlank(scopeValue)) return true;
      return String(getCaseInsensitiveValue(candidate, scopeKey) ?? "") === String(scopeValue);
    });
  });

  const id = record ? getCaseInsensitiveValue(record, spec.idKey) : undefined;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function resolveAppId(blueprint: Record<string, unknown>, record: Record<string, unknown>): string | number | undefined {
  const value = record.appid ?? record.app_id;
  if (typeof value === "string" || typeof value === "number") return value;
  const name = stringValue(record.appname ?? record.app_name ?? record.name);
  if (!name) return undefined;
  return findByAnyField(blueprint, "applications", ["appname", "appcode"], name)?.appid as string | number | undefined;
}

function resolveTableId(blueprint: Record<string, unknown>, record: Record<string, unknown>): string | number | undefined {
  const value = record.tableid ?? record.table_id;
  if (typeof value === "string" || typeof value === "number") return value;
  const name = stringValue(record.tablename ?? record.table_name ?? record.name);
  if (!name) return undefined;
  const appid = record.appid ?? resolveAppId(blueprint, record);
  return getRecords(blueprint, "tables").find(table => {
    const sameName = ["tablename", "alias"].some(key =>
      String(getCaseInsensitiveValue(table, key) ?? "").toLowerCase() === name.toLowerCase()
    );
    const sameApp = isBlank(appid) || String(getCaseInsensitiveValue(table, "appid") ?? "") === String(appid);
    return sameName && sameApp;
  })?.tableid as string | number | undefined;
}

function resolveColumnId(blueprint: Record<string, unknown>, record: Record<string, unknown>): string | number | undefined {
  const value = record.columnid ?? record.column_id;
  if (typeof value === "string" || typeof value === "number") return value;
  const name = stringValue(record.columnname ?? record.column_name ?? record.name);
  if (!name) return undefined;
  const tableid = record.tableid ?? resolveTableId(blueprint, record);
  return getRecords(blueprint, "columns").find(column => {
    const sameName = String(getCaseInsensitiveValue(column, "columnname") ?? "").toLowerCase() === name.toLowerCase();
    const sameTable = isBlank(tableid) || String(getCaseInsensitiveValue(column, "tableid") ?? "") === String(tableid);
    return sameName && sameTable;
  })?.columnid as string | number | undefined;
}

function findByAnyField(
  blueprint: Record<string, unknown>,
  collection: string,
  fields: string[],
  value: string
): Record<string, unknown> | undefined {
  return getRecords(blueprint, collection).find(record =>
    fields.some(field => String(getCaseInsensitiveValue(record, field) ?? "").toLowerCase() === value.toLowerCase())
  );
}

function ref(operationId: string, idKey: string): string {
  return `$${operationId}.${idKey}`;
}

function isPlanRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("$");
}

function buildOperationLabel(mode: WriteMode, target: AppBuilderTarget, record: Record<string, unknown>): string {
  const spec = TARGET_SPECS[target];
  const label = spec.nameKeys
    .map(key => getCaseInsensitiveValue(record, key))
    .find(value => !isBlank(value));
  return `${mode} ${target}${label ? `: ${String(label)}` : ""}`;
}

function buildPlanSummary(operations: PreparedOperation[]): string {
  const lines = operations.map((operation, index) => `${index + 1}. ${operation.label}`);
  return lines.join("\n");
}

function removeBlankValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || `app_${Date.now()}`;
}

function normalizeDbName(value: string): string {
  return slugify(value);
}

function normalizeDatatype(value: unknown): string {
  const text = stringValue(value).toLowerCase();
  if (!text) return "varchar";
  if (["string", "text", "varchar"].includes(text)) return text === "string" ? "varchar" : text;
  if (["number", "int", "integer"].includes(text)) return "int";
  if (["decimal", "money", "currency"].includes(text)) return "decimal";
  if (["date", "datetime", "time", "boolean", "bit"].includes(text)) return text;
  return text;
}
