import * as zipsonModule from "./vendor/zipson.min.js";
import { CORS, DEFAULT_SESSION_TTL_SECONDS, DEFAULT_ZILCODE_BASE, ZILCODE_SESSION_PREFIX, type Env } from "./config";
import { getErrorText, getStringArg, truncateDebugText } from "./utils";

export interface ZilcodeSession {
  token: string;
  base_url?: string;
  user: Record<string, unknown>;
  roles?: unknown;
  orgs?: unknown;
  roleid?: string | number;
  orgid?: string | number;
  access?: Record<string, unknown>;
  apps?: unknown;
  notifies?: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface ZilcodeSessionState {
  id: string;
  session: ZilcodeSession;
}

export interface ZilcodeApiEnvelope<T = unknown> {
  success?: boolean;
  result?: T;
  error?: unknown;
}


export function getZilcodeBase(env: Env, baseOverride?: string): string {
  return (baseOverride || env.ZILCODE_BASE || DEFAULT_ZILCODE_BASE).replace(/\/+$/, "");
}

function normalizeZilcodeBaseInput(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ZILCODE_BASE không hợp lệ. Hãy nhập URL đầy đủ, ví dụ https://demo.zilcode.com");
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("ZILCODE_BASE phai dung https, tru localhost/127.0.0.1 khi test local.");
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "zilcode.vn"
    || hostname.endsWith(".zilcode.vn")
    || hostname === "zilcode.com"
    || hostname.endsWith(".zilcode.com");

  if (!allowed) {
    throw new Error("ZILCODE_BASE chỉ được phép là domain Zilcode, localhost hoặc 127.0.0.1.");
  }

  return `${url.protocol}//${url.host}`;
}

function getSessionTtlSeconds(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_SESSION_TTL_SECONDS;
}

function getZilcodeSessionStore(env: Env): KVNamespace {
  return env.ZILCODE_SESSIONS ?? env.CHUNKS;
}

function getSessionKvKey(sessionId: string): string {
  return `${ZILCODE_SESSION_PREFIX}${sessionId}`;
}

function getSessionIdFromRequest(request: Request): string {
  const header = request.headers.get("X-Zilcode-Session");
  if (header?.trim()) return header.trim();

  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)ragorit_zilcode_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function stripSensitiveUserFields(user: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...user };
  delete clone.token;
  delete clone.password;
  delete clone.pin;
  return clone;
}

function toArrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

export async function loadZilcodeSession(
  request: Request,
  env: Env
): Promise<ZilcodeSessionState | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const raw = await getZilcodeSessionStore(env).get(getSessionKvKey(sessionId));
  if (!raw) return null;

  const session = JSON.parse(raw) as ZilcodeSession;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await getZilcodeSessionStore(env).delete(getSessionKvKey(sessionId));
    return null;
  }

  return { id: sessionId, session };
}

async function saveZilcodeSession(
  env: Env,
  sessionId: string,
  session: ZilcodeSession
): Promise<void> {
  await getZilcodeSessionStore(env).put(
    getSessionKvKey(sessionId),
    JSON.stringify(session),
    { expirationTtl: getSessionTtlSeconds(env) }
  );
}

async function deleteZilcodeSession(env: Env, sessionId: string): Promise<void> {
  if (!sessionId) return;
  await getZilcodeSessionStore(env).delete(getSessionKvKey(sessionId));
}

function publicSessionPayload(state: ZilcodeSessionState): Record<string, unknown> {
  const session = state.session;
  return {
    session_id: state.id,
    base_url: session.base_url,
    user: stripSensitiveUserFields(session.user),
    roles: session.roles,
    orgs: session.orgs,
    roleid: session.roleid,
    role_name: getSelectedRoleName(session),
    orgid: session.orgid,
    org_name: getSelectedOrgName(session),
    has_role_org: Boolean(session.roleid),
    apps: session.apps,
    access: session.access,
    expires_at: session.expires_at
  };
}

export function resolveZilcodeUrl(env: Env, pathOrUrl: string, baseOverride?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${getZilcodeBase(env, baseOverride)}/${pathOrUrl.replace(/^\/+/, "")}`;
}

export async function callZilcodeJson<T = unknown>(
  env: Env,
  pathOrUrl: string,
  options: {
    method?: string;
    token?: string;
    data?: unknown;
    baseUrl?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<ZilcodeApiEnvelope<T>> {
  const headers = new Headers({
    "Content-Type": "application/json;charset=UTF-8"
  });

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value);
  }

  const endpoint = resolveZilcodeUrl(env, pathOrUrl, options.baseUrl);
  const response = await fetch(endpoint, {
    method: options.method ?? "GET",
    headers,
    body: options.data === undefined ? undefined : JSON.stringify(options.data)
  });

  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { result: text };
  }

  if (!response.ok) {
    throw new Error(`Zilcode API lỗi ${response.status} tại ${endpoint}: ${getErrorText(data)}`);
  }

  return data as ZilcodeApiEnvelope<T>;
}

export function assertZilcodeSuccess<T>(envelope: ZilcodeApiEnvelope<T>): T {
  if (envelope.success === false) {
    throw new Error(`Zilcode API trả lỗi: ${getErrorText(envelope.result ?? envelope.error)}`);
  }

  return envelope.result as T;
}

async function fetchZilcodeAppMetadata(
  env: Env,
  session: ZilcodeSession,
  appid: string
): Promise<Record<string, unknown>> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    `rest/token/app/${encodeURIComponent(appid)}`,
    { token: session.token, baseUrl: session.base_url }
  );
  return assertZilcodeSuccess(envelope);
}

export function noZilcodeSessionResult(): { content: string } {
  return {
    content: JSON.stringify({
      error: "Chưa đăng nhập Zilcode trong chatbot. Hãy đăng nhập bằng form Zilcode ở giao diện chat trước khi dùng tool đọc dữ liệu Zilcode."
    }, null, 2)
  };
}

// ─── Zilcode auth handlers ──────────────────────────────────────────────────

function getRecordId(record: unknown, keys: string[]): string | number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const data = record as Record<string, unknown>;
  const entries = Object.entries(data);
  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return undefined;
}

const ROLE_ID_KEYS = ["id", "roleid", "role_id"];
const ORG_ID_KEYS = ["id", "orgid", "org_id", "organizationid", "organization_id"];
const APP_ID_KEYS = ["appid", "app_id", "applicationid", "application_id", "id"];
const ROLE_LABEL_KEYS = ["rolename", "role_name", "name", "text", "label", "displayname", "description", "rolecode", "code"];
const ORG_LABEL_KEYS = ["orgname", "org_name", "organizationname", "organization_name", "name", "text", "label", "displayname", "description", "orgcode", "code"];
const APP_LABEL_KEYS = ["appname", "app_name", "applicationname", "application_name", "name", "title", "text", "label", "displayname", "description", "appcode", "code"];

function getRecordLabel(record: unknown, keys: string[], fallback?: string): string | undefined {
  if (!record || typeof record !== "object") return fallback;
  const entries = Object.entries(record as Record<string, unknown>);

  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function findRecordById(records: unknown, id: unknown, keys: string[]): unknown | undefined {
  if (id === undefined || id === null || id === "") return undefined;
  const normalizedId = String(id);
  return toArrayValues(records).find(record => String(getRecordId(record, keys) ?? "") === normalizedId);
}

function getSelectedRoleName(session: ZilcodeSession): string | undefined {
  const role = findRecordById(session.roles, session.roleid, ROLE_ID_KEYS);
  return getRecordLabel(role, ROLE_LABEL_KEYS, session.roleid === undefined ? undefined : String(session.roleid));
}

function getSelectedOrgName(session: ZilcodeSession): string | undefined {
  if (session.orgid === undefined || session.orgid === null || String(session.orgid) === "0") {
    return "Không chọn tổ chức";
  }

  const org = findRecordById(session.orgs, session.orgid, ORG_ID_KEYS);
  return getRecordLabel(org, ORG_LABEL_KEYS, String(session.orgid));
}

function toKeyedValues(value: unknown): Array<{ key?: string; value: unknown }> {
  if (Array.isArray(value)) return value.map(item => ({ value: item }));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({ key, value: item }));
  }
  return [];
}

function listSessionApplicationSummaries(session: ZilcodeSession): Record<string, unknown>[] {
  const summaries: Array<Record<string, unknown> | null> = toKeyedValues(session.apps)
    .map(({ key, value }) => {
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const appid = String(getRecordId(record, APP_ID_KEYS) ?? key ?? "");
        if (!appid) return null;
        return {
          appid,
          app_name: getRecordLabel(record, APP_LABEL_KEYS, appid),
          app_code: getRecordLabel(record, ["appcode", "app_code", "code"], undefined),
          raw: record
        };
      }

      const appid = String(value ?? key ?? "");
      if (!appid) return null;
      return { appid, app_name: appid, raw: value };
    });

  return summaries.filter((item): item is Record<string, unknown> => item !== null);
}

const WINDOW_ID_KEYS = ["linkwindowid", "link_window_id", "windowid", "window_id", "winid"];
const WINDOW_LABEL_KEYS = ["windowname", "window_name", "menuname", "menu_name", "name", "title", "text", "label", "displayname", "translate", "description"];
const TAB_LABEL_KEYS = ["tabname", "tab_name", "name", "title", "text", "label", "displayname", "description"];
const FIELD_LABEL_KEYS = ["fieldname", "field_name", "columnname", "column_name", "name", "title", "text", "label", "displayname", "description"];
const ZILCODE_ERD = {
  window: ["windowid", "windowname", "windowtype", "appid", "execname", "isopenfind", "translate"],
  tab: ["tabid", "parenttabid", "tabname", "tablevel", "seqno", "layoutcols", "linkchildfield", "linkparentfield", "linktableid", "whereclause", "orderby", "tableid", "windowid", "relatechildfield", "relateparentfield", "relatetableid", "filterfield", "filterclause", "noinsert", "noupdate", "nodelete", "isarchive", "islock", "isautosave", "translate", "noselect", "noexport", "workflowid", "isviewonly", "labelspan"],
  field: ["fieldid", "fieldname", "translate", "hideingrid", "hideinform", "hideinfind", "displaylength", "seqno", "isreadonly", "fieldlength", "vformat", "defaultvalue", "isrequire", "isfrozen", "fieldgroup", "tabid", "columnid", "fieldtype", "linktableid", "domainid", "issearchtonghop", "parentfieldid", "wherefieldname", "placeholder", "calculation", "colspan", "rowspan", "mapcolumn", "displaylogic", "columnname", "tableid", "whereclause", "bindfieldname", "options", "columntype", "linkcolumn"],
  menu: ["menuid", "menuname", "parentid", "seqno", "translate", "issummary", "appid", "windowid", "siteid", "tabid", "menutype", "execname", "icon", "reportid"]
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getCaseInsensitiveValue(record: Record<string, unknown>, key: string): unknown {
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

function pickRecordFields(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = getCaseInsensitiveValue(record, key);
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  }
  return output;
}

function mapZilcodeArrayRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (!Array.isArray(value)) return asRecord(value);
  const record: Record<string, unknown> = {};

  for (let i = 0; i < keys.length; i++) {
    const item = value[i];
    if (item !== undefined && item !== null && item !== "") {
      record[keys[i]] = item;
    }
  }

  return record;
}

interface ZipsonRuntime {
  parse(input: string): unknown;
  stringify(value: unknown): string;
}

function getZipsonRuntime(): ZipsonRuntime {
  const moduleRuntime = zipsonModule as unknown as Partial<ZipsonRuntime> | undefined;
  const defaultRuntime = (zipsonModule as unknown as { default?: Partial<ZipsonRuntime> }).default;
  const globalRuntime = (globalThis as unknown as { zipson?: ZipsonRuntime }).zipson;
  const runtime = typeof moduleRuntime?.parse === "function"
    ? moduleRuntime as ZipsonRuntime
    : typeof defaultRuntime?.parse === "function"
      ? defaultRuntime as ZipsonRuntime
    : globalRuntime;

  if (!runtime || typeof runtime.parse !== "function") {
    throw new Error("Zipson parser chưa được nạp trong Worker runtime.");
  }
  return runtime;
}

function decodeZilcodeCachePayload(value: unknown): { value: unknown | null; format?: string; error?: string } {
  if (value === undefined || value === null || value === "") return { value: null, error: "empty" };
  if (typeof value === "object") return { value, format: "object" };
  if (typeof value !== "string") return { value: null, error: `unsupported_${typeof value}` };

  const text = value.trim();
  if (!text) return { value: null, error: "empty_string" };

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      const nested = decodeZilcodeCachePayload(parsed);
      return nested.value !== null
        ? { ...nested, format: `json_string:${nested.format ?? "unknown"}` }
        : { value: parsed, format: "json_string" };
    }
    return { value: parsed, format: "json" };
  } catch {
    // Window cache in Zilcode is normally zipson, not plain JSON.
  }

  try {
    return { value: getZipsonRuntime().parse(text), format: "zipson" };
  } catch (error) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) {
        const parsed = decodeZilcodeCachePayload(decoded);
        if (parsed.value !== null) {
          return { ...parsed, format: `uri:${parsed.format ?? "unknown"}` };
        }
      }
    } catch {
      // Ignore malformed URI escape sequences.
    }

    return { value: null, error: getErrorText(error) };
  }
}

function normalizeZilcodeWindowConfig(
  rawConfig: unknown,
  tableById: Map<string, Record<string, unknown>>
): Record<string, unknown> | null {
  const config = asRecord(rawConfig);
  if (!config) return null;

  const windowRecord = mapZilcodeArrayRecord(config.window, ZILCODE_ERD.window);
  const tabRecords = Array.isArray(config.tabs)
    ? config.tabs
      .map(tab => mapZilcodeArrayRecord(tab, ZILCODE_ERD.tab))
      .filter((tab): tab is Record<string, unknown> => Boolean(tab))
    : [];
  const fieldRecords = Array.isArray(config.fields)
    ? config.fields
      .map(field => mapZilcodeArrayRecord(field, ZILCODE_ERD.field))
      .filter((field): field is Record<string, unknown> => Boolean(field))
    : [];
  const menuRecords = Array.isArray(config.menus)
    ? config.menus
      .map(menu => mapZilcodeArrayRecord(menu, ZILCODE_ERD.menu))
      .filter((menu): menu is Record<string, unknown> => Boolean(menu))
    : [];
  const tabById = new Map<string, Record<string, unknown>>();

  for (const tab of tabRecords) {
    const tableId = String(tab.tableid ?? tab.linktableid ?? "");
    const linkedTable = tableId ? tableById.get(tableId) : undefined;
    if (linkedTable) {
      tab.linked_table = {
        tableid: linkedTable.tableid,
        tablename: linkedTable.tablename,
        alias: linkedTable.alias,
        columnkey: linkedTable.columnkey,
        columndisplay: linkedTable.columndisplay
      };
    }

    if (tab.tabid !== undefined && tab.tabid !== null) {
      tabById.set(String(tab.tabid), tab);
    }
  }

  for (const field of fieldRecords) {
    const tabid = String(field.tabid ?? "");
    const tab = tabid ? tabById.get(tabid) : undefined;
    if (tab && !tab.tableid && field.tableid) tab.tableid = field.tableid;
  }

  return {
    window: windowRecord ? [windowRecord] : [],
    tabs: tabRecords,
    fields: fieldRecords,
    menus: menuRecords
  };
}

export function getOptionalBooleanArg(
  args: Record<string, unknown>,
  name: string,
  fallback: boolean
): boolean {
  const value = args[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

export function getLimitArg(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  max: number
): number {
  const value = args[name];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.round(parsed)));
}

type BlueprintMode = "graph" | "subgraph" | "detail";

export function getBlueprintMode(args: Record<string, unknown>): BlueprintMode {
  const mode = getStringArg(args, "mode").toLowerCase();
  if (mode === "subgraph" || mode === "detail") return mode;
  return "graph";
}

export function getNodeIdsArg(args: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const single = getStringArg(args, "node_id");
  if (single) ids.add(single);

  const raw = args.node_ids;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) ids.add(item.trim());
    }
  } else if (typeof raw === "string") {
    for (const item of raw.split(",")) {
      if (item.trim()) ids.add(item.trim());
    }
  }

  return [...ids];
}

function getFirstConfigArray(
  roots: unknown[],
  names: string[]
): Record<string, unknown>[] {
  for (const root of roots) {
    const record = asRecord(root);
    if (!record) continue;

    for (const name of names) {
      const value = getCaseInsensitiveValue(record, name);
      const valueRecord = asRecord(value);
      const items = Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : valueRecord
          ? Object.values(valueRecord).some(item => Boolean(item) && typeof item === "object")
            ? Object.values(valueRecord).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            : [valueRecord]
          : [];
      if (items.length) return items;
    }
  }

  return [];
}

function summarizeBlueprintTable(
  table: Record<string, unknown>,
  app: Record<string, unknown>
): Record<string, unknown> {
  return {
    appid: app.appid,
    app_name: app.app_name,
    ...pickRecordFields(table, [
      "tableid",
      "tablename",
      "tabletype",
      "alias",
      "description",
      "columnkey",
      "columncode",
      "columndisplay",
      "columnfind",
      "urlview",
      "urledit",
      "serviceid",
      "servicetype",
      "isreadonly",
      "isview"
    ])
  };
}

function summarizeBlueprintMenu(menu: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(menu, [
    "menuid",
    "menuname",
    "translate",
    "parentid",
    "seqno",
    "linktype",
    "linkwindowid",
    "windowid",
    "appid",
    "execname",
    "icon"
  ]);
}

function summarizeBlueprintDomain(domain: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(domain, [
    "domainid",
    "domainname",
    "name",
    "description",
    "domainjson",
    "datatype",
    "controltype"
  ]);
}

function summarizeBlueprintRelation(relation: Record<string, unknown>): Record<string, unknown> {
  return pickRecordFields(relation, [
    "relateid",
    "relatename",
    "parenttableid",
    "childtableid",
    "parentfield",
    "childfield",
    "relatetype",
    "description"
  ]);
}

function extractWindowIdsFromAppMetadata(metadata: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const candidates = [
    ...toArrayValues(metadata.menus),
    ...toArrayValues(metadata.windows),
    ...toArrayValues(metadata.window)
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = getRecordId(candidate, WINDOW_ID_KEYS);
    if (id !== undefined && id !== null && String(id).trim()) {
      ids.add(String(id).trim());
    }
  }

  return [...ids];
}

async function fetchZilcodeWindowCache(
  env: Env,
  session: ZilcodeSession,
  windowid: string
): Promise<Record<string, unknown>> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    `rest/token/cache/${encodeURIComponent(windowid)}`,
    { token: session.token, baseUrl: session.base_url }
  );
  return assertZilcodeSuccess(envelope) as Record<string, unknown>;
}

function summarizeBlueprintTab(
  tab: Record<string, unknown>,
  tableById: Map<string, Record<string, unknown>>
): Record<string, unknown> {
  const tableId = String(
    getRecordId(tab, ["tableid", "table_id", "linktableid", "link_table_id"]) ?? ""
  );
  const linkedTable = tableId ? tableById.get(tableId) : undefined;

  return {
    ...pickRecordFields(tab, [
      "tabid",
      "tabname",
      "parenttabid",
      "tablevel",
      "tableid",
      "linktableid",
      "linkchildfield",
      "linkparentfield",
      "relatetableid",
      "relatechildfield",
      "relateparentfield",
      "workflowid",
      "isviewonly",
      "noinsert",
      "noupdate",
      "nodelete",
      "noselect",
      "noexport",
      "seqno"
    ]),
    label: getRecordLabel(tab, TAB_LABEL_KEYS, tableId || undefined),
    linked_table: linkedTable ? {
      tableid: linkedTable.tableid,
      tablename: linkedTable.tablename,
      alias: linkedTable.alias,
      columnkey: linkedTable.columnkey,
      columndisplay: linkedTable.columndisplay
    } : undefined
  };
}

function summarizeBlueprintField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pickRecordFields(field, [
      "fieldid",
      "fieldname",
      "columnname",
      "tablename",
      "tableid",
      "tabid",
      "caption",
      "label",
      "datatype",
      "controltype",
      "fieldtype",
      "columntype",
      "domainid",
      "defaultvalue",
      "isrequired",
      "isrequire",
      "isreadonly",
      "isvisible",
      "hideingrid",
      "hideinform",
      "hideinfind",
      "isprimarykey",
      "seqno"
    ]),
    label: getRecordLabel(field, FIELD_LABEL_KEYS, undefined)
  };
}

function buildTabRelations(tabs: Record<string, unknown>[]): Record<string, unknown> {
  const parentChild = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      parenttabid: tab.parenttabid,
      linktableid: tab.linktableid ?? tab.tableid,
      linkchildfield: tab.linkchildfield,
      linkparentfield: tab.linkparentfield
    }))
    .filter(item => item.parenttabid || item.linkchildfield || item.linkparentfield);

  const manyToMany = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      relatetableid: tab.relatetableid,
      relatechildfield: tab.relatechildfield,
      relateparentfield: tab.relateparentfield
    }))
    .filter(item => item.relatetableid || item.relatechildfield || item.relateparentfield);

  const tabTable = tabs
    .map(tab => ({
      tabid: tab.tabid,
      tabname: tab.tabname ?? tab.label,
      tableid: tab.tableid ?? tab.linktableid,
      linked_table: tab.linked_table
    }))
    .filter(item => item.tableid || item.linked_table);

  return {
    tab_table: tabTable,
    parent_child: parentChild,
    many_to_many: manyToMany
  };
}

function summarizeWindowBlueprint(
  windowid: string,
  cache: Record<string, unknown>,
  tableById: Map<string, Record<string, unknown>>,
  includeFields: boolean,
  includeRaw: boolean
): Record<string, unknown> {
  const decodedConfig = decodeZilcodeCachePayload(cache.configjson);
  const decodedLayout = decodeZilcodeCachePayload(cache.layoutjson);
  const parsedConfig = decodedConfig.value;
  const parsedLayout = decodedLayout.value;
  const normalizedConfig = normalizeZilcodeWindowConfig(parsedConfig, tableById);
  const roots = [
    normalizedConfig,
    parsedConfig,
    asRecord(parsedConfig)?.data,
    asRecord(parsedConfig)?.result,
    parsedLayout,
    asRecord(parsedLayout)?.data,
    asRecord(parsedLayout)?.result,
    cache
  ];
  const windowRecords = getFirstConfigArray(roots, ["window", "windows", "win"]);
  const tabs = getFirstConfigArray(roots, ["tabs", "tab", "windowtabs", "wintabs"])
    .map(tab => summarizeBlueprintTab(tab, tableById));
  const fields = includeFields
    ? getFirstConfigArray(roots, ["fields", "field", "columns", "controls"])
      .map(summarizeBlueprintField)
    : [];
  const menuTools = getFirstConfigArray(roots, ["menutools", "menu_tools", "tools", "menus"])
    .map(tool => pickRecordFields(tool, ["id", "name", "text", "label", "command", "execname", "seqno"]));

  return {
    windowid,
    parsed_config: Boolean(normalizedConfig || parsedConfig),
    config_format: decodedConfig.format,
    layout_format: decodedLayout.format,
    label: getRecordLabel(windowRecords[0] ?? cache, WINDOW_LABEL_KEYS, windowid),
    window: windowRecords[0] ? pickRecordFields(windowRecords[0], [
      "windowid",
      "windowname",
      "title",
      "description",
      "defaulttabid",
      "width",
      "height"
    ]) : undefined,
    tabs_count: tabs.length,
    tabs,
    fields_count: fields.length,
    fields: includeFields ? fields : undefined,
    menu_tools_count: menuTools.length,
    menu_tools: menuTools.length ? menuTools : undefined,
    relations: buildTabRelations(tabs),
    raw: includeRaw ? {
      cache,
      parsed_config: parsedConfig,
      parsed_layout: parsedLayout
    } : undefined,
    warning: normalizedConfig || parsedConfig
      ? undefined
      : `Không parse được configjson. Lỗi: ${decodedConfig.error ?? "unknown"}`
  };
}

interface SystemGraphNode {
  id: string;
  type: string;
  label: string;
  appid?: string;
  counts?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  detail_available?: boolean;
}

interface SystemGraphEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

interface SystemGraph {
  nodes: SystemGraphNode[];
  edges: SystemGraphEdge[];
  node_counts: Record<string, number>;
  edge_count: number;
}

function graphIdPart(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim() || fallback;
  return text.replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 96) || fallback;
}

function graphNodeId(type: string, ...parts: unknown[]): string {
  return [type, ...parts.map((part, index) => graphIdPart(part, `node${index}`))].join(":");
}

function addGraphNode(nodes: Map<string, SystemGraphNode>, node: SystemGraphNode): void {
  const current = nodes.get(node.id);
  nodes.set(node.id, current ? { ...current, ...node, summary: { ...current.summary, ...node.summary } } : node);
}

function addGraphEdge(edges: Map<string, SystemGraphEdge>, edge: SystemGraphEdge): void {
  if (!edge.from || !edge.to || edge.from === edge.to) return;
  edges.set(`${edge.from}|${edge.type}|${edge.to}`, edge);
}

function rememberGraphLookup(map: Map<string, string>, appid: string, value: unknown, nodeId: string): void {
  if (value === undefined || value === null || value === "") return;
  map.set(`${appid}:${String(value)}`, nodeId);
}

function lookupGraphNode(map: Map<string, string>, appid: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return map.get(`${appid}:${String(value)}`);
}

function compactGraphSummary(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const key of keys) {
    const value = getCaseInsensitiveValue(record, key);
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") {
      summary[key] = value.length > 140 ? `${value.slice(0, 140)}...` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    }
  }

  const domainJson = getCaseInsensitiveValue(record, "domainjson");
  if (typeof domainJson === "string" && domainJson) {
    summary.domainjson_chars = domainJson.length;
  }

  return summary;
}

function finalizeSystemGraph(nodes: Map<string, SystemGraphNode>, edges: Map<string, SystemGraphEdge>): SystemGraph {
  const nodeList = [...nodes.values()];
  const nodeCounts: Record<string, number> = {};
  for (const node of nodeList) {
    nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
  }

  return {
    nodes: nodeList,
    edges: [...edges.values()],
    node_counts: nodeCounts,
    edge_count: edges.size
  };
}

function buildSystemGraphFromBlueprint(
  sessionSummary: Record<string, unknown>,
  appBlueprints: Record<string, unknown>[]
): SystemGraph {
  const nodes = new Map<string, SystemGraphNode>();
  const edges = new Map<string, SystemGraphEdge>();
  const tableLookup = new Map<string, string>();
  const domainLookup = new Map<string, string>();
  const tabLookup = new Map<string, string>();
  const sessionNodeId = "session:current";

  addGraphNode(nodes, {
    id: sessionNodeId,
    type: "session",
    label: "Phiên đăng nhập hiện tại",
    summary: {
      base_url: sessionSummary.base_url,
      roleid: sessionSummary.roleid,
      role_name: sessionSummary.role_name,
      orgid: sessionSummary.orgid,
      org_name: sessionSummary.org_name
    }
  });

  for (const app of appBlueprints) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;
    const appNodeId = graphNodeId("app", appid);

    addGraphNode(nodes, {
      id: appNodeId,
      type: "app",
      label: String(app.app_name ?? app.app_code ?? appid),
      appid,
      counts: asRecord(app.counts) ?? undefined,
      summary: {
        appid,
        app_name: app.app_name,
        app_code: app.app_code
      },
      detail_available: true
    });
    addGraphEdge(edges, { from: sessionNodeId, to: appNodeId, type: "session_has_app" });

    const tables = toArrayValues(app.tables).filter((table): table is Record<string, unknown> => Boolean(table) && typeof table === "object");
    tables.forEach((table, index) => {
      const tableKey = table.tableid ?? table.tablename ?? table.alias ?? index;
      const tableNodeId = graphNodeId("table", appid, tableKey);
      rememberGraphLookup(tableLookup, appid, table.tableid, tableNodeId);
      rememberGraphLookup(tableLookup, appid, table.tablename, tableNodeId);
      rememberGraphLookup(tableLookup, appid, table.alias, tableNodeId);

      addGraphNode(nodes, {
        id: tableNodeId,
        type: "table",
        label: String(table.alias ?? table.tablename ?? table.tableid ?? tableKey),
        appid,
        summary: compactGraphSummary(table, [
          "tableid",
          "tablename",
          "tabletype",
          "alias",
          "columnkey",
          "columncode",
          "columndisplay",
          "isreadonly",
          "isview"
        ]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: tableNodeId, type: "app_has_table" });
    });

    const domains = toArrayValues(app.domains).filter((domain): domain is Record<string, unknown> => Boolean(domain) && typeof domain === "object");
    domains.forEach((domain, index) => {
      const domainKey = domain.domainid ?? domain.domainname ?? domain.name ?? index;
      const domainNodeId = graphNodeId("domain", appid, domainKey);
      rememberGraphLookup(domainLookup, appid, domain.domainid, domainNodeId);
      rememberGraphLookup(domainLookup, appid, domain.domainname, domainNodeId);
      rememberGraphLookup(domainLookup, appid, domain.name, domainNodeId);

      addGraphNode(nodes, {
        id: domainNodeId,
        type: "domain",
        label: String(domain.name ?? domain.domainname ?? domain.domainid ?? domainKey),
        appid,
        summary: compactGraphSummary(domain, ["domainid", "domainname", "name", "description", "datatype", "controltype"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: domainNodeId, type: "app_has_domain" });
    });

    const menus = toArrayValues(app.menus).filter((menu): menu is Record<string, unknown> => Boolean(menu) && typeof menu === "object");
    menus.forEach((menu, index) => {
      const menuKey = menu.menuid ?? menu.menuname ?? menu.translate ?? index;
      const menuNodeId = graphNodeId("menu", appid, menuKey);
      const windowId = menu.linkwindowid ?? menu.windowid;

      addGraphNode(nodes, {
        id: menuNodeId,
        type: "menu",
        label: String(menu.translate ?? menu.menuname ?? menu.menuid ?? menuKey),
        appid,
        summary: compactGraphSummary(menu, ["menuid", "menuname", "translate", "parentid", "seqno", "linktype", "linkwindowid", "windowid"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: menuNodeId, type: "app_has_menu" });

      if (windowId !== undefined && windowId !== null && windowId !== "") {
        const windowNodeId = graphNodeId("window", windowId);
        addGraphNode(nodes, {
          id: windowNodeId,
          type: "window",
          label: String(windowId),
          appid,
          summary: { windowid: windowId },
          detail_available: true
        });
        addGraphEdge(edges, { from: menuNodeId, to: windowNodeId, type: "menu_links_window" });
      }
    });

    const relates = toArrayValues(app.relates).filter((relation): relation is Record<string, unknown> => Boolean(relation) && typeof relation === "object");
    relates.forEach((relation, index) => {
      const relationKey = relation.relateid ?? relation.relatename ?? index;
      const relationNodeId = graphNodeId("relation", appid, relationKey);

      addGraphNode(nodes, {
        id: relationNodeId,
        type: "relation",
        label: String(relation.relatename ?? relation.relateid ?? relationKey),
        appid,
        summary: compactGraphSummary(relation, ["relateid", "relatename", "parenttableid", "childtableid", "parentfield", "childfield", "relatetype", "description"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: relationNodeId, type: "app_has_relation" });

      const parentTableNodeId = lookupGraphNode(tableLookup, appid, relation.parenttableid);
      const childTableNodeId = lookupGraphNode(tableLookup, appid, relation.childtableid);
      if (parentTableNodeId) addGraphEdge(edges, { from: relationNodeId, to: parentTableNodeId, type: "relation_parent_table" });
      if (childTableNodeId) addGraphEdge(edges, { from: relationNodeId, to: childTableNodeId, type: "relation_child_table" });
    });

    const windows = toArrayValues(app.windows).filter((window): window is Record<string, unknown> => Boolean(window) && typeof window === "object");
    for (const window of windows) {
      const windowid = String(window.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      addGraphNode(nodes, {
        id: windowNodeId,
        type: "window",
        label: String(window.label ?? windowid),
        appid,
        counts: {
          tabs: window.tabs_count,
          fields: window.fields_count,
          menu_tools: window.menu_tools_count
        },
        summary: compactGraphSummary(window, ["windowid", "label", "parsed_config", "warning"]),
        detail_available: true
      });
      addGraphEdge(edges, { from: appNodeId, to: windowNodeId, type: "app_has_window" });

      const tabs = toArrayValues(window.tabs).filter((tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === "object");
      tabs.forEach((tab, index) => {
        const tabKey = tab.tabid ?? tab.tabname ?? tab.label ?? index;
        const tabNodeId = graphNodeId("tab", windowid, tabKey);
        rememberGraphLookup(tabLookup, windowid, tab.tabid, tabNodeId);

        addGraphNode(nodes, {
          id: tabNodeId,
          type: "tab",
          label: String(tab.label ?? tab.tabname ?? tab.tabid ?? tabKey),
          appid,
          summary: compactGraphSummary(tab, [
            "tabid",
            "tabname",
            "label",
            "parenttabid",
            "tablevel",
            "tableid",
            "linktableid",
            "linkchildfield",
            "linkparentfield",
            "relatetableid",
            "relatechildfield",
            "relateparentfield",
            "workflowid",
            "isviewonly",
            "noinsert",
            "noupdate",
            "nodelete",
            "noselect",
            "noexport",
            "seqno"
          ]),
          detail_available: true
        });
        addGraphEdge(edges, { from: windowNodeId, to: tabNodeId, type: "window_has_tab" });

        const tableId = tab.tableid ?? tab.linktableid ?? asRecord(tab.linked_table)?.tableid;
        const tableNodeId = lookupGraphNode(tableLookup, appid, tableId);
        if (tableNodeId) {
          addGraphEdge(edges, {
            from: tabNodeId,
            to: tableNodeId,
            type: "tab_uses_table",
            metadata: compactGraphSummary(tab, ["linkchildfield", "linkparentfield"])
          });
        }
      });

      tabs.forEach(tab => {
        const tabKey = tab.tabid ?? tab.tabname ?? tab.label;
        const tabNodeId = tabKey === undefined ? undefined : graphNodeId("tab", windowid, tabKey);
        const parentNodeId = lookupGraphNode(tabLookup, windowid, tab.parenttabid);
        if (tabNodeId && parentNodeId) {
          addGraphEdge(edges, {
            from: parentNodeId,
            to: tabNodeId,
            type: "tab_parent_child",
            metadata: compactGraphSummary(tab, ["linkchildfield", "linkparentfield"])
          });
        }

        const relationTableNodeId = lookupGraphNode(tableLookup, appid, tab.relatetableid);
        if (tabNodeId && relationTableNodeId) {
          addGraphEdge(edges, {
            from: tabNodeId,
            to: relationTableNodeId,
            type: "tab_many_to_many_table",
            metadata: compactGraphSummary(tab, ["relatechildfield", "relateparentfield"])
          });
        }
      });

      const fields = toArrayValues(window.fields).filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === "object");
      fields.forEach((field, index) => {
        const fieldKey = field.fieldid ?? field.columnname ?? field.fieldname ?? index;
        const fieldNodeId = graphNodeId("field", windowid, fieldKey);
        const fieldTabNodeId = lookupGraphNode(tabLookup, windowid, field.tabid);

        addGraphNode(nodes, {
          id: fieldNodeId,
          type: "field",
          label: String(field.label ?? field.caption ?? field.columnname ?? field.fieldname ?? fieldKey),
          appid,
          summary: compactGraphSummary(field, [
            "fieldid",
            "fieldname",
            "columnname",
            "tablename",
            "tableid",
            "tabid",
            "caption",
            "label",
            "datatype",
            "controltype",
            "fieldtype",
            "columntype",
            "domainid",
            "defaultvalue",
            "isrequired",
            "isrequire",
            "isreadonly",
            "isvisible",
            "hideingrid",
            "hideinform",
            "hideinfind",
            "isprimarykey",
            "seqno"
          ]),
          detail_available: true
        });
        addGraphEdge(edges, { from: fieldTabNodeId ?? windowNodeId, to: fieldNodeId, type: fieldTabNodeId ? "tab_has_field" : "window_has_field" });

        const domainNodeId = lookupGraphNode(domainLookup, appid, field.domainid);
        if (domainNodeId) addGraphEdge(edges, { from: fieldNodeId, to: domainNodeId, type: "field_uses_domain" });
      });
    }

    const windowErrors = toArrayValues(app.window_errors).filter((error): error is Record<string, unknown> => Boolean(error) && typeof error === "object");
    for (const error of windowErrors) {
      const windowid = String(error.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      addGraphNode(nodes, {
        id: windowNodeId,
        type: "window",
        label: windowid,
        appid,
        summary: { windowid, error: error.error },
        detail_available: false
      });
      addGraphEdge(edges, { from: appNodeId, to: windowNodeId, type: "app_has_window_error" });
    }
  }

  return finalizeSystemGraph(nodes, edges);
}

function filterGraphByNeighborhood(graph: SystemGraph, nodeIds: string[], depth: number): SystemGraph {
  if (nodeIds.length === 0) return graph;

  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  const queue = nodeIds
    .filter(id => graph.nodes.some(node => node.id === id))
    .map(id => ({ id, level: 0 }));

  for (const item of queue) visited.add(item.id);

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.level >= depth) continue;
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, level: current.level + 1 });
    }
  }

  const nodes = graph.nodes.filter(node => visited.has(node.id));
  const edges = graph.edges.filter(edge => visited.has(edge.from) && visited.has(edge.to));
  return finalizeSystemGraph(new Map(nodes.map(node => [node.id, node])), new Map(edges.map(edge => [`${edge.from}|${edge.type}|${edge.to}`, edge])));
}

function cleanDetailRecord(record: Record<string, unknown>, includeFields: boolean): Record<string, unknown> {
  const detail: Record<string, unknown> = { ...record };
  delete detail.raw_metadata;
  delete detail.raw;

  if (!includeFields && Array.isArray(detail.windows)) {
    detail.windows = detail.windows
      .filter((window): window is Record<string, unknown> => Boolean(window) && typeof window === "object")
      .map(window => {
        const copy: Record<string, unknown> = { ...window };
        delete copy.fields;
        delete copy.raw;
        return copy;
      });
  }

  return detail;
}

function collectBlueprintDetails(
  appBlueprints: Record<string, unknown>[],
  nodeIds: string[],
  includeFields: boolean
): Record<string, unknown>[] {
  const selected = new Set(nodeIds);
  if (selected.size === 0) return [];

  const details: Record<string, unknown>[] = [];

  for (const app of appBlueprints) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;
    const appNodeId = graphNodeId("app", appid);
    if (selected.has(appNodeId)) {
      details.push({ node_id: appNodeId, type: "app", data: cleanDetailRecord(app, includeFields) });
    }

    for (const [index, table] of toArrayValues(app.tables).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const tableNodeId = graphNodeId("table", appid, table.tableid ?? table.tablename ?? table.alias ?? index);
      if (selected.has(tableNodeId)) details.push({ node_id: tableNodeId, type: "table", data: table });
    }

    for (const [index, menu] of toArrayValues(app.menus).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const menuNodeId = graphNodeId("menu", appid, menu.menuid ?? menu.menuname ?? menu.translate ?? index);
      if (selected.has(menuNodeId)) details.push({ node_id: menuNodeId, type: "menu", data: menu });
    }

    for (const [index, domain] of toArrayValues(app.domains).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const domainNodeId = graphNodeId("domain", appid, domain.domainid ?? domain.domainname ?? domain.name ?? index);
      if (selected.has(domainNodeId)) details.push({ node_id: domainNodeId, type: "domain", data: domain });
    }

    for (const [index, relation] of toArrayValues(app.relates).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
      const relationNodeId = graphNodeId("relation", appid, relation.relateid ?? relation.relatename ?? index);
      if (selected.has(relationNodeId)) details.push({ node_id: relationNodeId, type: "relation", data: relation });
    }

    for (const window of toArrayValues(app.windows).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")) {
      const windowid = String(window.windowid ?? "");
      if (!windowid) continue;
      const windowNodeId = graphNodeId("window", windowid);
      if (selected.has(windowNodeId)) details.push({ node_id: windowNodeId, type: "window", data: cleanDetailRecord(window, includeFields) });

      for (const [index, tab] of toArrayValues(window.tabs).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
        const tabNodeId = graphNodeId("tab", windowid, tab.tabid ?? tab.tabname ?? tab.label ?? index);
        if (selected.has(tabNodeId)) details.push({ node_id: tabNodeId, type: "tab", data: tab });
      }

      if (includeFields) {
        for (const [index, field] of toArrayValues(window.fields).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").entries()) {
          const fieldNodeId = graphNodeId("field", windowid, field.fieldid ?? field.columnname ?? field.fieldname ?? index);
          if (selected.has(fieldNodeId)) details.push({ node_id: fieldNodeId, type: "field", data: field });
        }
      }
    }
  }

  return details;
}

function buildOverviewExamples(
  records: unknown,
  keys: string[],
  limit: number
): Record<string, unknown>[] {
  return toArrayValues(records)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, limit)
    .map(record => compactGraphSummary(record, keys));
}

function buildSystemOverview(
  sessionSummary: Record<string, unknown>,
  appBlueprints: Record<string, unknown>[],
  graph: SystemGraph,
  errors: Record<string, unknown>[]
): Record<string, unknown> {
  const user = asRecord(sessionSummary.user);
  const apps = appBlueprints.map(app => ({
    appid: app.appid,
    app_name: app.app_name,
    app_code: app.app_code,
    counts: app.counts,
    examples: {
      tables: buildOverviewExamples(app.tables, ["tableid", "tablename", "alias", "tabletype", "columnkey", "columndisplay"], 8),
      menus: buildOverviewExamples(app.menus, ["menuid", "menuname", "translate", "linkwindowid", "parentid"], 6),
      windows: buildOverviewExamples(app.windows, ["windowid", "label", "tabs_count", "fields_count", "warning"], 6),
      domains: buildOverviewExamples(app.domains, ["domainid", "domainname", "name", "datatype", "controltype"], 6),
      relations: buildOverviewExamples(app.relates, ["relateid", "relatename", "parenttableid", "childtableid", "parentfield", "childfield"], 6)
    }
  }));

  return {
    intent: "Tóm tắt thân thiện cho người dùng về hệ thống Zilcode hiện tại; không cần liệt kê toàn bộ node khi người dùng chỉ hỏi tổng quan.",
    session: {
      base_url: sessionSummary.base_url,
      user: user ? pickRecordFields(user, ["userid", "username", "fullname", "email", "siteid", "sitecode", "sitename"]) : undefined,
      roleid: sessionSummary.roleid,
      role_name: sessionSummary.role_name,
      orgid: sessionSummary.orgid,
      org_name: sessionSummary.org_name
    },
    totals: {
      apps: appBlueprints.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      node_counts: graph.node_counts,
      app_errors: errors.length,
      window_errors: appBlueprints.reduce((total, app) => total + toArrayValues(app.window_errors).length, 0)
    },
    apps,
    reading_notes: [
      "Graph chỉ là bản đồ tổng quan để biết các thành phần và quan hệ chính.",
      "Khi cần chi tiết bảng/window/tab/field cụ thể, dùng node_id trong graph để lấy detail."
    ]
  };
}

interface AppBuilderRecordSpec {
  key: string;
  description: string;
  table_aliases: string[];
  table_names: string[];
  summary_keys: string[];
  optional?: boolean;
}

const APP_BUILDER_DEFAULT_APPID = "1";
const APP_BUILDER_RECORD_SPECS: AppBuilderRecordSpec[] = [
  {
    key: "applications",
    description: "Các app hiện có được tạo/cấu hình trong App Builder.",
    table_aliases: ["NApplication"],
    table_names: ["n_app"],
    summary_keys: ["appid", "appname", "appcode", "description", "siteid", "seqno", "apptype", "theme", "translate", "linkurl", "startexec", "icon", "color"]
  },
  {
    key: "services",
    description: "Data service metadata. App links to service through n_appservice; tables belong to service.",
    table_aliases: ["NService"],
    table_names: ["n_service"],
    summary_keys: ["serviceid", "servicename", "url", "servicetype", "description", "accessuser", "seqno", "siteid"]
  },
  {
    key: "appservices",
    description: "Bridge table between app and service.",
    table_aliases: ["NAppService"],
    table_names: ["n_appservice"],
    summary_keys: ["appserviceid", "appid", "serviceid", "siteid"]
  },
  {
    key: "tables",
    description: "Table/view metadata. Tables are linked to apps through serviceid -> n_appservice, not directly by appid.",
    table_aliases: ["NTable"],
    table_names: ["n_table"],
    summary_keys: ["tableid", "tablename", "alias", "tabletype", "serviceid", "url", "description", "viewname", "iscache", "archivetype", "beforechange", "afterchange", "maplayer", "hasattach", "isreadonly", "seqno"]
  },
  {
    key: "columns",
    description: "Các column hiện có của table.",
    table_aliases: ["NColumn"],
    table_names: ["n_column"],
    summary_keys: ["columnid", "columnname", "alias", "tablename", "tableid", "datatype", "columntype", "isprimarykey", "isrequired", "isnotnull", "defaultvalue", "domainid", "linktableid", "linkcolumn", "mapcolumn", "length", "seqno", "siteid"]
  },
  {
    key: "windows",
    description: "Các window hiện có.",
    table_aliases: ["NWindow"],
    table_names: ["n_window"],
    summary_keys: ["windowid", "windowname", "windowtype", "appid", "execname", "isopenfind", "translate", "subtype", "siteid", "seqno"]
  },
  {
    key: "tabs",
    description: "Các tab hiện có trong window.",
    table_aliases: ["NTab"],
    table_names: ["n_tab"],
    summary_keys: ["tabid", "tabname", "parenttabid", "tablevel", "seqno", "tableid", "windowid", "linktableid", "linkchildfield", "linkparentfield", "relatetableid", "relatechildfield", "relateparentfield", "noinsert", "noupdate", "nodelete", "noselect", "noexport", "workflowid", "isviewonly"]
  },
  {
    key: "fields",
    description: "Các field hiện có trong tab/window.",
    table_aliases: ["NField"],
    table_names: ["n_field"],
    summary_keys: ["fieldid", "fieldname", "columnname", "columnid", "tableid", "tabid", "translate", "fieldtype", "displaylength", "fieldlength", "vformat", "defaultvalue", "fieldgroup", "parentfieldid", "whereclause", "domainid", "linktableid", "displaylogic", "placeholder", "calculation", "colspan", "rowspan", "foreignwindowid", "bindfieldname", "isreadonly", "isrequire", "hideingrid", "hideinform", "hideinfind", "isfrozen", "options", "wherefieldname", "seqno", "siteid"]
  },
  {
    key: "menus",
    description: "Các menu hiện có và window mà menu mở.",
    table_aliases: ["NMenu"],
    table_names: ["n_menu"],
    summary_keys: ["menuid", "menutype", "menuname", "translate", "isopen", "parentid", "seqno", "appid", "windowid", "linkwindowid", "tabid", "execname", "whereclause", "icon", "reportid", "issummary", "maplayer", "calendarid", "siteid"]
  },
  {
    key: "domains",
    description: "Các domain/list giá trị dùng bởi field.",
    table_aliases: ["NDomain"],
    table_names: ["n_domain"],
    summary_keys: ["domainid", "domainname", "name", "domaintype", "description", "datatype", "controltype", "appid", "iseditable", "siteid", "domainjson"]
  },
  {
    key: "caches",
    description: "Generated window/app layout cache. Delete or refresh it when window/tab/field/menu metadata changes.",
    table_aliases: ["NCache"],
    table_names: ["n_cache"],
    summary_keys: ["cacheid", "windowid", "appid", "siteid"]
  },
  {
    key: "roleapps",
    description: "Role access to apps.",
    table_aliases: ["NRoleApp"],
    table_names: ["n_roleapp"],
    summary_keys: ["roleappid", "roleid", "appid", "siteid"]
  },
  {
    key: "rolemenus",
    description: "Role access to menus.",
    table_aliases: ["NRoleMenu"],
    table_names: ["n_rolemenu"],
    summary_keys: ["rolemenuid", "roleid", "menuid", "whereclause", "siteid"]
  },
  {
    key: "accesses",
    description: "Role access flags for tables.",
    table_aliases: ["NAccess"],
    table_names: ["n_access"],
    summary_keys: ["accessid", "roleid", "tableid", "isarchive", "noinsert", "noupdate", "nodelete", "noselect", "noexport", "noattach", "islock", "siteid"]
  },
  {
    key: "archives",
    description: "Archive/history rows linked to tables.",
    table_aliases: ["NArchive"],
    table_names: ["n_archive"],
    summary_keys: ["archiveid", "archivetype", "archivetime", "recordid", "tableid", "siteid"],
    optional: true
  },
  {
    key: "roles",
    description: "Roles. Sensitive fields are not included.",
    table_aliases: ["NRole"],
    table_names: ["n_role"],
    summary_keys: ["roleid", "rolename", "description", "seqno", "siteid"]
  },
  {
    key: "users",
    description: "Users. Password and PIN are intentionally excluded.",
    table_aliases: ["NUser"],
    table_names: ["n_user"],
    summary_keys: ["userid", "username", "fullname", "email", "phone", "active", "issystem", "isviewer", "parentid", "siteid"]
  },
  {
    key: "roleusers",
    description: "Bridge table between role and user.",
    table_aliases: ["NRoleUser"],
    table_names: ["n_roleuser"],
    summary_keys: ["roleuserid", "roleid", "userid", "siteid"]
  },
  {
    key: "orgs",
    description: "Organizations.",
    table_aliases: ["NOrg"],
    table_names: ["n_org"],
    summary_keys: ["orgid", "orgname", "orgcode", "active", "description", "parentid", "seqno", "siteid"]
  },
  {
    key: "orgusers",
    description: "Bridge table between org and user.",
    table_aliases: ["NOrgUser"],
    table_names: ["n_orguser"],
    summary_keys: ["orguserid", "orgid", "userid", "siteid"]
  }
];

function findAppBuilderTable(
  tables: Record<string, unknown>[],
  spec: AppBuilderRecordSpec
): Record<string, unknown> | undefined {
  return tables.find(table => {
    const alias = String(table.alias ?? "").toLowerCase();
    const tablename = String(table.tablename ?? "").toLowerCase();
    return spec.table_aliases.some(item => item.toLowerCase() === alias)
      || spec.table_names.some(item => item.toLowerCase() === tablename);
  });
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

function unwrapZilcodeRecordResult(envelope: ZilcodeApiEnvelope<unknown>): unknown {
  if (envelope && typeof envelope === "object" && "success" in envelope) {
    return assertZilcodeSuccess(envelope);
  }

  const result = asRecord(envelope)?.result;
  return result ?? envelope;
}

async function fetchZilcodeRecordsFromTable(
  env: Env,
  session: ZilcodeSession,
  table: Record<string, unknown>,
  maxRecords: number
): Promise<Record<string, unknown>[]> {
  const urlview = String(table.urlview ?? "");
  if (!urlview) return [];

  const endpoint = addQueryParams(urlview, { limit: maxRecords });
  const envelope = await callZilcodeJson<unknown>(
    env,
    endpoint,
    {
      token: session.token,
      baseUrl: session.base_url,
      headers: {
        Range: `0-${Math.max(0, maxRecords - 1)}`,
        Prefer: "count=exact"
      }
    }
  );
  return toArrayValues(unwrapZilcodeRecordResult(envelope))
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object");
}

function summarizeAppBuilderRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const summary = compactGraphSummary(record, keys);
  const domainJson = getCaseInsensitiveValue(record, "domainjson");
  if (typeof domainJson === "string" && domainJson) {
    try {
      const parsed = JSON.parse(domainJson);
      summary.domain_values_count = Array.isArray(parsed) ? parsed.length : undefined;
      summary.domain_values_preview = Array.isArray(parsed) ? parsed.slice(0, 8) : undefined;
    } catch {
      summary.domainjson_chars = domainJson.length;
    }
    delete summary.domainjson;
  }

  return summary;
}

function groupCount(records: Record<string, unknown>[], key: string): Record<string, number> {
  return records.reduce<Record<string, number>>((output, record) => {
    const value = getCaseInsensitiveValue(record, key);
    if (value === undefined || value === null || value === "") return output;
    const groupKey = String(value);
    output[groupKey] = (output[groupKey] ?? 0) + 1;
    return output;
  }, {});
}

function sameZilcodeId(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || left === "") return false;
  if (right === undefined || right === null || right === "") return false;
  return String(left) === String(right);
}

function getZilcodeIdText(record: Record<string, unknown>, key: string): string | undefined {
  const value = getCaseInsensitiveValue(record, key);
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function collectAppBuilderIds(records: Record<string, unknown>[], key: string): Set<string> {
  const output = new Set<string>();
  for (const record of records) {
    const value = getZilcodeIdText(record, key);
    if (value) output.add(value);
  }
  return output;
}

function dedupeAppBuilderRecords(records: Record<string, unknown>[], idKey: string): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const id = getZilcodeIdText(record, idKey) ?? JSON.stringify(record);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(record);
  }
  return output;
}

function buildAppBuilderInventory(
  recordLists: Record<string, Record<string, unknown>[]>
): Record<string, unknown> {
  const applications = recordLists.applications ?? [];
  const services = recordLists.services ?? [];
  const appservices = recordLists.appservices ?? [];
  const tables = recordLists.tables ?? [];
  const columns = recordLists.columns ?? [];
  const windows = recordLists.windows ?? [];
  const tabs = recordLists.tabs ?? [];
  const fields = recordLists.fields ?? [];
  const menus = recordLists.menus ?? [];
  const domains = recordLists.domains ?? [];
  const caches = recordLists.caches ?? [];
  const roleapps = recordLists.roleapps ?? [];
  const rolemenus = recordLists.rolemenus ?? [];
  const accesses = recordLists.accesses ?? [];
  const archives = recordLists.archives ?? [];

  const apps = applications.map(app => {
    const appid = getCaseInsensitiveValue(app, "appid");
    const appServices = appservices.filter(appservice => sameZilcodeId(getCaseInsensitiveValue(appservice, "appid"), appid));
    const serviceIds = collectAppBuilderIds(appServices, "serviceid");
    const appServiceRecords = services.filter(service => serviceIds.has(String(getCaseInsensitiveValue(service, "serviceid") ?? "")));
    const appWindows = windows.filter(window => sameZilcodeId(getCaseInsensitiveValue(window, "appid"), appid));
    const appWindowIds = collectAppBuilderIds(appWindows, "windowid");
    const appTabs = tabs.filter(tab => appWindowIds.has(String(getCaseInsensitiveValue(tab, "windowid") ?? "")));
    const tabTableIds = new Set<string>();
    for (const tab of appTabs) {
      for (const key of ["tableid", "linktableid", "relatetableid"]) {
        const value = getZilcodeIdText(tab, key);
        if (value) tabTableIds.add(value);
      }
    }
    const legacyAppTables = tables.filter(table => sameZilcodeId(getCaseInsensitiveValue(table, "appid"), appid));
    const serviceTables = tables.filter(table => serviceIds.has(String(getCaseInsensitiveValue(table, "serviceid") ?? "")));
    const tabTables = tables.filter(table => tabTableIds.has(String(getCaseInsensitiveValue(table, "tableid") ?? "")));
    const appTables = dedupeAppBuilderRecords([...legacyAppTables, ...serviceTables, ...tabTables], "tableid");
    const appMenus = menus.filter(menu => sameZilcodeId(getCaseInsensitiveValue(menu, "appid"), appid));
    const appMenuIds = collectAppBuilderIds(appMenus, "menuid");
    const appDomains = domains.filter(domain => sameZilcodeId(getCaseInsensitiveValue(domain, "appid"), appid));
    const appCaches = caches.filter(cache =>
      sameZilcodeId(getCaseInsensitiveValue(cache, "appid"), appid)
      || appWindowIds.has(String(getCaseInsensitiveValue(cache, "windowid") ?? ""))
    );
    const appRoleApps = roleapps.filter(roleapp => sameZilcodeId(getCaseInsensitiveValue(roleapp, "appid"), appid));
    const appRoleMenus = rolemenus.filter(rolemenu => appMenuIds.has(String(getCaseInsensitiveValue(rolemenu, "menuid") ?? "")));
    const tableIds = collectAppBuilderIds(appTables, "tableid");
    const appAccesses = accesses.filter(access => tableIds.has(String(getCaseInsensitiveValue(access, "tableid") ?? "")));
    const appArchives = archives.filter(archive => tableIds.has(String(getCaseInsensitiveValue(archive, "tableid") ?? "")));

    return {
      appid,
      appname: getCaseInsensitiveValue(app, "appname"),
      appcode: getCaseInsensitiveValue(app, "appcode"),
      description: getCaseInsensitiveValue(app, "description"),
      services_count: appServiceRecords.length,
      tables_count: appTables.length,
      windows_count: appWindows.length,
      menus_count: appMenus.length,
      domains_count: appDomains.length,
      caches_count: appCaches.length,
      roleapps_count: appRoleApps.length,
      rolemenus_count: appRoleMenus.length,
      accesses_count: appAccesses.length,
      archives_count: appArchives.length,
      appservices: appServices,
      services: appServiceRecords,
      tables: appTables.map(table => {
        const tableid = getCaseInsensitiveValue(table, "tableid");
        const tablename = getCaseInsensitiveValue(table, "tablename");
        const tableColumns = columns.filter(column =>
          sameZilcodeId(getCaseInsensitiveValue(column, "tableid"), tableid)
          || sameZilcodeId(getCaseInsensitiveValue(column, "tablename"), tablename)
        );

        return {
          ...table,
          columns_count: tableColumns.length,
          columns: tableColumns,
          access_count: appAccesses.filter(access => sameZilcodeId(getCaseInsensitiveValue(access, "tableid"), tableid)).length,
          archive_count: appArchives.filter(archive => sameZilcodeId(getCaseInsensitiveValue(archive, "tableid"), tableid)).length
        };
      }),
      windows: appWindows.map(window => {
        const windowid = getCaseInsensitiveValue(window, "windowid");
        const windowTabs = tabs.filter(tab => sameZilcodeId(getCaseInsensitiveValue(tab, "windowid"), windowid));

        return {
          ...window,
          tabs_count: windowTabs.length,
          tabs: windowTabs.map(tab => {
            const tabid = getCaseInsensitiveValue(tab, "tabid");
            const tableid = getCaseInsensitiveValue(tab, "tableid");
            const tabFields = fields.filter(field =>
              sameZilcodeId(getCaseInsensitiveValue(field, "tabid"), tabid)
              || sameZilcodeId(getCaseInsensitiveValue(field, "tableid"), tableid)
            );

            return {
              ...tab,
              fields_count: tabFields.length,
              fields: tabFields
            };
          })
        };
      }),
      menus: appMenus,
      domains: appDomains,
      caches: appCaches,
      roleapps: appRoleApps,
      rolemenus: appRoleMenus,
      accesses: appAccesses,
      archives_summary: {
        records_count: appArchives.length,
        tableids: [...new Set(appArchives.map(archive => String(getCaseInsensitiveValue(archive, "tableid") ?? "")).filter(Boolean))]
      }
    };
  });

  return {
    description: "Cay du lieu cau hinh hien co trong App Builder. Doc theo thu tu: App -> appservice -> service -> table -> column va App -> window -> tab -> field/menu/domain/cache/role access.",
    apps_count: apps.length,
    apps
  };
}

async function buildAppBuilderRecords(
  env: Env,
  session: ZilcodeSession,
  appBuilderTables: Record<string, unknown>[],
  maxRecords: number
): Promise<Record<string, unknown>> {
  const collections: Record<string, unknown> = {};
  const errors: Record<string, unknown>[] = [];
  const recordLists: Record<string, Record<string, unknown>[]> = {};

  for (const spec of APP_BUILDER_RECORD_SPECS) {
    const table = findAppBuilderTable(appBuilderTables, spec);
    if (!table) {
      if (!spec.optional) {
        errors.push({ key: spec.key, error: "Không tìm thấy bảng metadata tương ứng trong App Builder." });
      }
      continue;
    }

    try {
      const records = await fetchZilcodeRecordsFromTable(env, session, table, maxRecords);
      const summarized = records.map(record => summarizeAppBuilderRecord(record, spec.summary_keys));
      recordLists[spec.key] = summarized;
      collections[spec.key] = {
        description: spec.description,
        source_table: {
          tableid: table.tableid,
          tablename: table.tablename,
          alias: table.alias,
          urlview: table.urlview,
          urledit: table.urledit,
          columnkey: table.columnkey,
          columndisplay: table.columndisplay
        },
        records_count: summarized.length,
        maybe_truncated: summarized.length >= maxRecords,
        records: summarized
      };
    } catch (error) {
      errors.push({
        key: spec.key,
        tableid: table.tableid,
        tablename: table.tablename,
        alias: table.alias,
        error: truncateDebugText(error)
      });
    }
  }

  return {
    max_records_per_table: maxRecords,
    inventory: buildAppBuilderInventory(recordLists),
    relationships: {
      appservices_by_appid: groupCount(recordLists.appservices ?? [], "appid"),
      appservices_by_serviceid: groupCount(recordLists.appservices ?? [], "serviceid"),
      tables_by_serviceid: groupCount(recordLists.tables ?? [], "serviceid"),
      columns_by_tableid: groupCount(recordLists.columns ?? [], "tableid"),
      windows_by_appid: groupCount(recordLists.windows ?? [], "appid"),
      tabs_by_windowid: groupCount(recordLists.tabs ?? [], "windowid"),
      fields_by_tabid: groupCount(recordLists.fields ?? [], "tabid"),
      menus_by_appid: groupCount(recordLists.menus ?? [], "appid"),
      domains_by_appid: groupCount(recordLists.domains ?? [], "appid"),
      caches_by_appid: groupCount(recordLists.caches ?? [], "appid"),
      caches_by_windowid: groupCount(recordLists.caches ?? [], "windowid"),
      roleapps_by_appid: groupCount(recordLists.roleapps ?? [], "appid"),
      rolemenus_by_menuid: groupCount(recordLists.rolemenus ?? [], "menuid"),
      accesses_by_tableid: groupCount(recordLists.accesses ?? [], "tableid"),
      archives_by_tableid: groupCount(recordLists.archives ?? [], "tableid")
    },
    collections,
    errors: errors.length ? errors : undefined
  };
}

function resolveAppBuilderApp(session: ZilcodeSession, appidFilter: string): Record<string, unknown> {
  const apps = listSessionApplicationSummaries(session);
  const explicit = appidFilter
    ? apps.find(app => String(app.appid ?? "") === appidFilter)
    : undefined;
  const appBuilder = explicit
    ?? apps.find(app => String(app.appid ?? "") === APP_BUILDER_DEFAULT_APPID)
    ?? apps.find(app => String(app.app_name ?? "").toLowerCase().includes("app builder"))
    ?? { appid: appidFilter || APP_BUILDER_DEFAULT_APPID, app_name: "App Builder" };

  return appBuilder;
}

export async function buildZilcodeAppBuilderBlueprint(
  env: Env,
  session: ZilcodeSession,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const mode = getBlueprintMode(args);
  const appidFilter = getStringArg(args, "appid");
  const includeFields = getOptionalBooleanArg(args, "include_fields", mode === "detail");
  const includeRaw = getOptionalBooleanArg(args, "include_raw", false);
  const includeRecords = getOptionalBooleanArg(args, "include_records", true);
  const maxRecordsPerTable = getLimitArg(args, "max_records_per_table", 500, 5000);
  const maxWindowsPerApp = getLimitArg(args, "max_windows_per_app", 50, 300);
  const nodeIds = getNodeIdsArg(args);
  const depth = getLimitArg(args, "depth", 1, 4);
  const appBuilderApp = resolveAppBuilderApp(session, appidFilter);
  const apps = [appBuilderApp];
  const appBlueprints: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  let appBuilderRecords: Record<string, unknown> | undefined;

  for (const app of apps) {
    const appid = String(app.appid ?? "");
    if (!appid) continue;

    try {
      const metadata = await fetchZilcodeAppMetadata(env, session, appid);
      const tables = toArrayValues(metadata.tables)
        .filter((table): table is Record<string, unknown> => Boolean(table) && typeof table === "object")
        .map(table => summarizeBlueprintTable(table, app));
      const tableById = new Map<string, Record<string, unknown>>();
      for (const table of tables) {
        const tableId = String(table.tableid ?? "");
        if (tableId) tableById.set(tableId, table);
      }

      const menus = toArrayValues(metadata.menus)
        .filter((menu): menu is Record<string, unknown> => Boolean(menu) && typeof menu === "object")
        .map(summarizeBlueprintMenu);
      const domains = toArrayValues(metadata.domains)
        .filter((domain): domain is Record<string, unknown> => Boolean(domain) && typeof domain === "object")
        .map(summarizeBlueprintDomain);
      const relates = toArrayValues(metadata.relates)
        .filter((relation): relation is Record<string, unknown> => Boolean(relation) && typeof relation === "object")
        .map(summarizeBlueprintRelation);
      const windowIds = extractWindowIdsFromAppMetadata(metadata).slice(0, maxWindowsPerApp);
      const windows: Record<string, unknown>[] = [];
      const windowErrors: Record<string, unknown>[] = [];

      if (includeRecords) {
        appBuilderRecords = await buildAppBuilderRecords(env, session, tables, maxRecordsPerTable);
      }

      for (const windowid of windowIds) {
        try {
          const cache = await fetchZilcodeWindowCache(env, session, windowid);
          windows.push(summarizeWindowBlueprint(windowid, cache, tableById, includeFields, includeRaw));
        } catch (error) {
          windowErrors.push({ windowid, error: getErrorText(error) });
        }
      }

      appBlueprints.push({
        appid,
        app_name: app.app_name,
        app_code: app.app_code,
        counts: {
          tables: tables.length,
          menus: menus.length,
          domains: domains.length,
          relates: relates.length,
          windows: windows.length,
          window_errors: windowErrors.length
        },
        tables,
        menus,
        domains,
        relates,
        windows,
        window_errors: windowErrors.length ? windowErrors : undefined,
        raw_metadata: includeRaw ? metadata : undefined
      });
    } catch (error) {
      errors.push({
        appid,
        app_name: app.app_name,
        error: getErrorText(error)
      });
    }
  }

  const sessionSummary = {
    base_url: session.base_url,
    user: stripSensitiveUserFields(session.user),
    roleid: session.roleid,
    role_name: getSelectedRoleName(session),
    orgid: session.orgid,
    org_name: getSelectedOrgName(session)
  };
  const graph = buildSystemGraphFromBlueprint(sessionSummary, appBlueprints);
  const focusedGraph = mode === "graph" ? graph : filterGraphByNeighborhood(graph, nodeIds, depth);
  const details = mode === "detail" || mode === "subgraph"
    ? collectBlueprintDetails(appBlueprints, nodeIds, includeFields)
    : [];
  const overview = buildSystemOverview(sessionSummary, appBlueprints, graph, errors);
  const ignoredSessionAppsCount = listSessionApplicationSummaries(session)
    .filter(app => String(app.appid ?? "") !== String(appBuilderApp.appid ?? ""))
    .length;

  return {
    mode,
    scope: "app_builder",
    read_path: [
      "App Builder metadata/schema",
      "App Builder records: NApplication, NService, NAppService, NTable, NColumn, NWindow, NTab, NField, NMenu, NDomain, NCache, role/access tables",
      "Configured apps from NApplication",
      "For each configured app: appservice -> service -> tables -> columns",
      "For each configured app: windows -> tabs -> fields",
      "Graph relationships between app, service, table, column, menu, window, tab, field, domain, cache, role access and relation"
    ],
    session: sessionSummary,
    scan: {
      scope: "app_builder_only",
      app_builder_appid: appBuilderApp.appid,
      attempted_apps_count: apps.length,
      attempted_apps: apps.map(app => ({
        appid: app.appid,
        app_name: app.app_name,
        app_code: app.app_code
      })),
      ignored_session_apps_count: ignoredSessionAppsCount,
      note: "Các app khác trong session không được liệt kê ở đây để tránh nhiễu. Danh sách app cần phân tích nằm trong app_builder_records.inventory.apps, lấy từ bảng NApplication của App Builder."
    },
    filters: {
      appid: String(appBuilderApp.appid ?? APP_BUILDER_DEFAULT_APPID),
      node_ids: nodeIds.length ? nodeIds : undefined,
      depth: mode === "subgraph" ? depth : undefined,
      include_fields: includeFields,
      include_raw: includeRaw,
      include_records: includeRecords,
      max_records_per_table: includeRecords ? maxRecordsPerTable : undefined,
      max_windows_per_app: maxWindowsPerApp
    },
    apps_count: appBlueprints.length,
    overview,
    app_builder_records: appBuilderRecords,
    graph: focusedGraph,
    details_count: details.length || undefined,
    details: details.length ? details : undefined,
    errors: errors.length ? errors : undefined,
    note: apps.length === 0
      ? "Phiên hiện tại không có app nào hoặc appid không khớp. Hãy đăng nhập và chọn role/org role system trước."
      : mode === "graph"
        ? "Đây là graph compact. Nếu cần dữ liệu chi tiết, gọi lại tool với mode=subgraph hoặc mode=detail và node_id/node_ids từ graph.nodes."
        : details.length
          ? "Đã trả graph vùng liên quan và dữ liệu chi tiết cho node_id/node_ids đã chọn."
          : "Không tìm thấy detail cho node_id/node_ids đã truyền. Hãy dùng đúng id trong graph.nodes."
  };
}

async function applyZilcodeRoleOrg(
  env: Env,
  session: ZilcodeSession,
  roleid: string | number,
  orgid: string | number
): Promise<void> {
  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    "rest/token/roleorg",
    {
      method: "PUT",
      token: session.token,
      baseUrl: session.base_url,
      data: [roleid, orgid || 0]
    }
  );
  const result = assertZilcodeSuccess(envelope);
  session.roleid = roleid;
  session.orgid = orgid || 0;
  session.access = (result.access && typeof result.access === "object")
    ? result.access as Record<string, unknown>
    : {};
  session.apps = result.apps ?? [];
  session.notifies = result.notifies ?? [];
  session.updated_at = new Date().toISOString();
}

export async function handleZilcodeLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    username?: string;
    sitecode?: string;
    password?: string;
    zilcode_base?: string;
  };

  const username = body.username?.trim();
  const sitecode = body.sitecode?.trim();
  const password = body.password ?? "";
  const baseUrl = normalizeZilcodeBaseInput(body.zilcode_base);

  if (!username || !sitecode || !password) {
    return Response.json(
      { success: false, error: "Bắt buộc phải có username, sitecode và password." },
      { status: 400, headers: CORS }
    );
  }

  const envelope = await callZilcodeJson<Record<string, unknown>>(
    env,
    "rest/token/",
    {
      method: "POST",
      baseUrl,
      data: [username, sitecode, password]
    }
  );
  const user = assertZilcodeSuccess(envelope);
  const token = String(user.token ?? "");
  if (!token) {
    throw new Error("Zilcode login thành công nhưng response không có token.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + getSessionTtlSeconds(env) * 1000);
  const sessionId = crypto.randomUUID();
  const roles = user.roles ?? [];
  const orgs = user.orgs ?? [];
  const session: ZilcodeSession = {
    token,
    base_url: getZilcodeBase(env, baseUrl),
    user: stripSensitiveUserFields(user),
    roles,
    orgs,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  };

  const roleValues = toArrayValues(roles);
  const orgValues = toArrayValues(orgs);
  if (roleValues.length === 1 && orgValues.length <= 1) {
    const roleid = getRecordId(roleValues[0], ROLE_ID_KEYS);
    const orgid = orgValues.length ? getRecordId(orgValues[0], ORG_ID_KEYS) ?? 0 : 0;
    if (roleid !== undefined) {
      await applyZilcodeRoleOrg(env, session, roleid, orgid);
    }
  }

  await saveZilcodeSession(env, sessionId, session);
  const state = { id: sessionId, session };

  return Response.json(
    {
      success: true,
      ...publicSessionPayload(state),
      needs_role_org: !session.roleid
    },
    { headers: CORS }
  );
}

export async function handleZilcodeSelectRoleOrg(request: Request, env: Env): Promise<Response> {
  const state = await loadZilcodeSession(request, env);
  if (!state) {
    return Response.json(
      { success: false, error: "Chưa có phiên Zilcode hoặc phiên đã hết hạn." },
      { status: 401, headers: CORS }
    );
  }

  const body = await request.json() as {
    roleid?: string | number;
    orgid?: string | number;
  };

  if (body.roleid === undefined || body.roleid === "") {
    return Response.json(
      { success: false, error: "Bắt buộc phải có roleid." },
      { status: 400, headers: CORS }
    );
  }

  await applyZilcodeRoleOrg(env, state.session, body.roleid, body.orgid ?? 0);
  await saveZilcodeSession(env, state.id, state.session);

  return Response.json(
    { success: true, ...publicSessionPayload(state), needs_role_org: false },
    { headers: CORS }
  );
}

export async function handleZilcodeMe(request: Request, env: Env): Promise<Response> {
  const state = await loadZilcodeSession(request, env);
  if (!state) {
    return Response.json(
      { success: false, authenticated: false },
      { status: 401, headers: CORS }
    );
  }

  return Response.json(
    { success: true, authenticated: true, ...publicSessionPayload(state) },
    { headers: CORS }
  );
}

export async function handleZilcodeLogout(request: Request, env: Env): Promise<Response> {
  await deleteZilcodeSession(env, getSessionIdFromRequest(request));
  return Response.json({ success: true }, { headers: CORS });
}
