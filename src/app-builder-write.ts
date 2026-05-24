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
      { field: "tableid", collection: "tables", idKey: "tableid", label: "table" }
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

export const APP_BUILDER_WRITE_TOOL_NAMES = [
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
