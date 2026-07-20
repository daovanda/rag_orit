import type { Env } from "./config";
import { asRecord, getCaseInsensitiveValue, toArrayValues, truncateDebugText } from "./utils";
import { assertZilcodeSuccess, callZilcodeJson, type ZilcodeSession } from "./zilcode";

const CONTRACT_CACHE_PREFIX = "app_builder_metadata_contract:v1:";
const CONTRACT_CACHE_TTL_SECONDS = 10 * 60;

export interface MetadataColumnContract {
  id?: number;
  name: string;
  alias?: string;
  data_type?: string;
  length?: number;
  precision?: number;
  nullable?: boolean;
  in_primary_key?: boolean;
  identity?: boolean;
  default_value?: string;
  required: boolean;
}

export interface MetadataTableContract {
  collection: string;
  table_name: string;
  schema_endpoint?: string;
  source: "live_schema" | "metadata_fallback";
  columns: Record<string, MetadataColumnContract>;
  required_fields: string[];
  warnings: string[];
  fetched_at: string;
}

export interface DynamicMetadataContractRegistry {
  contracts: Record<string, MetadataTableContract>;
  warnings: string[];
  loaded_at: string;
}

export interface ContractValidationError {
  code: "required_field_missing" | "invalid_type" | "max_length_exceeded";
  field: string;
  expected: unknown;
  actual: unknown;
  evidence: Record<string, unknown>;
  repair_hint: string;
}

export async function loadDynamicMetadataContractRegistry(
  env: Env,
  session: ZilcodeSession,
  collections: Record<string, Record<string, unknown>>,
  semanticRequiredFields: Record<string, string[]>
): Promise<DynamicMetadataContractRegistry> {
  const entries = await Promise.all(Object.entries(collections).map(async ([collection, metadata]) => {
    const sourceTable = asRecord(metadata.source_table) ?? {};
    const tableName = String(ci(sourceTable, "tablename") ?? "").trim();
    const endpoint = deriveColumnSchemaEndpoint(sourceTable);
    const semanticRequired = semanticRequiredFields[collection] ?? [];

    if (!tableName || !endpoint) {
      return [collection, createFallbackContract(
        collection,
        tableName || collection,
        semanticRequired,
        "Không suy ra được endpoint /column/{table} từ source_table.urlview/urledit."
      )] as const;
    }

    try {
      const columns = await loadLiveColumns(env, session, tableName, endpoint);
      if (!columns.length) {
        return [collection, createFallbackContract(
          collection,
          tableName,
          semanticRequired,
          `Schema API ${endpoint} không trả column nào.`
        )] as const;
      }
      return [collection, mergeLiveAndSemanticContract(
        collection,
        tableName,
        endpoint,
        columns,
        semanticRequired
      )] as const;
    } catch (error) {
      return [collection, createFallbackContract(
        collection,
        tableName,
        semanticRequired,
        `Không đọc được schema live tại ${endpoint}: ${truncateDebugText(error)}`
      )] as const;
    }
  }));

  const contracts = Object.fromEntries(entries);
  return {
    contracts,
    warnings: Object.values(contracts).flatMap(contract => contract.warnings),
    loaded_at: new Date().toISOString()
  };
}

export function deriveColumnSchemaEndpoint(sourceTable: Record<string, unknown>): string | undefined {
  for (const candidate of [sourceTable.urledit, sourceTable.urlview]) {
    const raw = String(candidate ?? "").trim();
    if (!raw) continue;
    const match = raw.match(/^(.*\/rest\/[^/?#]+\/[^/?#]+)\/data\/([^/?#]+)(?:[/?#].*)?$/i)
      ?? raw.match(/^(rest\/[^/?#]+\/[^/?#]+)\/data\/([^/?#]+)(?:[/?#].*)?$/i);
    if (match) return `${match[1]}/column/${match[2]}`;
  }
  return undefined;
}

export function normalizeLiveColumnSchema(value: unknown): MetadataColumnContract[] {
  const records = extractColumnRecords(value);
  const columns: MetadataColumnContract[] = [];
  for (const record of records) {
    const name = String(ci(record, "name") ?? ci(record, "columnname") ?? "").trim();
    if (!name) continue;
    const nullable = toOptionalBoolean(ci(record, "nullable"));
    const identity = toOptionalBoolean(ci(record, "identity"));
    const defaultValue = toOptionalString(ci(record, "defaultValue") ?? ci(record, "default_value"));
    columns.push({
      id: toOptionalNumber(ci(record, "id")),
      name,
      alias: toOptionalString(ci(record, "alias")),
      data_type: toOptionalString(ci(record, "dataType") ?? ci(record, "datatype")),
      length: toOptionalNumber(ci(record, "length")),
      precision: toOptionalNumber(ci(record, "precision")),
      nullable,
      in_primary_key: toOptionalBoolean(ci(record, "inPrimaryKey") ?? ci(record, "in_primary_key")),
      identity,
      default_value: defaultValue,
      required: nullable === false && identity !== true && !hasServerDefault(defaultValue)
    });
  }
  return columns;
}

export function mergeLiveAndSemanticContract(
  collection: string,
  tableName: string,
  endpoint: string,
  liveColumns: MetadataColumnContract[],
  semanticRequired: string[]
): MetadataTableContract {
  const columns = Object.fromEntries(liveColumns.map(column => [column.name.toLowerCase(), column]));
  const warnings: string[] = [];

  for (const field of semanticRequired) {
    const live = columns[field.toLowerCase()];
    if (!live) {
      warnings.push(`${collection}: semantic contract có field ${field} nhưng schema live của ${tableName} không có; bỏ semantic field này.`);
      continue;
    }
    if (!live.required) {
      warnings.push(`${collection}.${field}: semantic contract đánh dấu bắt buộc nhưng schema live cho phép nullable/default/identity; schema live được ưu tiên.`);
    }
  }

  return {
    collection,
    table_name: tableName,
    schema_endpoint: endpoint,
    source: "live_schema",
    columns,
    required_fields: liveColumns.filter(column => column.required).map(column => column.name),
    warnings,
    fetched_at: new Date().toISOString()
  };
}

export function materializeContractDefaults(
  contract: MetadataTableContract | undefined,
  record: Record<string, unknown>,
  warnings: string[]
): void {
  if (!contract || contract.source !== "live_schema") return;
  for (const column of Object.values(contract.columns)) {
    if (hasValue(record[column.name]) || !column.default_value) continue;
    const literal = parseSafeDefaultLiteral(column.default_value);
    if (!literal.materializable) continue;
    record[column.name] = literal.value;
    warnings.push(`${contract.collection}.${column.name}: materialize default từ schema live.`);
  }
}

export function validateRecordAgainstContract(
  contract: MetadataTableContract | undefined,
  record: Record<string, unknown>
): ContractValidationError[] {
  if (!contract) return [];
  const errors: ContractValidationError[] = [];

  for (const requiredField of contract.required_fields) {
    if (hasValue(getCaseInsensitiveValue(record, requiredField))) continue;
    const column = contract.columns[requiredField.toLowerCase()];
    errors.push({
      code: "required_field_missing",
      field: requiredField,
      expected: "non-null value",
      actual: getCaseInsensitiveValue(record, requiredField),
      evidence: contractEvidence(contract, column),
      repair_hint: `Cung cấp ${requiredField} hoặc xác minh default/identity trong schema live.`
    });
  }

  for (const [field, value] of Object.entries(record)) {
    if (!hasValue(value) || isReferenceValue(value)) continue;
    const column = contract.columns[field.toLowerCase()];
    if (!column) continue;

    if (typeof value === "string" && column.length && column.length > 0 && value.length > column.length) {
      errors.push({
        code: "max_length_exceeded",
        field,
        expected: { max_length: column.length },
        actual: { length: value.length },
        evidence: contractEvidence(contract, column),
        repair_hint: `Rút ngắn ${field} xuống tối đa ${column.length} ký tự.`
      });
    }

    if (!isValueCompatibleWithDataType(value, column.data_type)) {
      errors.push({
        code: "invalid_type",
        field,
        expected: column.data_type || "schema-compatible value",
        actual: { type: typeof value, value },
        evidence: contractEvidence(contract, column),
        repair_hint: `Chuyển ${field} sang kiểu ${column.data_type}.`
      });
    }
  }

  return errors;
}

export function invalidateMetadataContractCache(
  env: Env,
  session: ZilcodeSession,
  tableNames: string[]
): Promise<void[]> {
  return Promise.all(tableNames.map(tableName =>
    env.CHUNKS.delete(contractCacheKey(session.base_url || "", tableName))
  ));
}

async function loadLiveColumns(
  env: Env,
  session: ZilcodeSession,
  tableName: string,
  endpoint: string
): Promise<MetadataColumnContract[]> {
  const cacheKey = contractCacheKey(session.base_url || "", tableName);
  const cached = await env.CHUNKS.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as unknown;
      const columns = normalizeLiveColumnSchema(parsed);
      if (columns.length) return columns;
    } catch {
      await env.CHUNKS.delete(cacheKey);
    }
  }

  const envelope = await callZilcodeJson<unknown>(env, endpoint, {
    token: session.token,
    baseUrl: session.base_url
  });
  const result = assertZilcodeSuccess(envelope);
  const columns = normalizeLiveColumnSchema(result);
  if (columns.length) {
    await env.CHUNKS.put(cacheKey, JSON.stringify(columns), { expirationTtl: CONTRACT_CACHE_TTL_SECONDS });
  }
  return columns;
}

function createFallbackContract(
  collection: string,
  tableName: string,
  semanticRequired: string[],
  warning: string
): MetadataTableContract {
  return {
    collection,
    table_name: tableName,
    source: "metadata_fallback",
    columns: {},
    required_fields: [...semanticRequired],
    warnings: [`${collection}: ${warning} Dùng semantic contract hiện có và đánh dấu chưa xác minh schema live.`],
    fetched_at: new Date().toISOString()
  };
}

function extractColumnRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["columns", "data", "records", "items", "result"]) {
    const nested = getCaseInsensitiveValue(record, key);
    if (nested !== undefined) {
      const extracted = extractColumnRecords(nested);
      if (extracted.length) return extracted;
    }
  }
  return toArrayValues(record).filter(isRecord);
}

function parseSafeDefaultLiteral(value: string): { materializable: boolean; value?: unknown } {
  let text = value.trim();
  while (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1).trim();
  if (/^null$/i.test(text)) return { materializable: false };
  if (/^(true|false)$/i.test(text)) return { materializable: true, value: text.toLowerCase() === "true" };
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { materializable: true, value: Number(text) };
  const stringMatch = text.match(/^N?'((?:''|[^'])*)'$/i);
  if (stringMatch) return { materializable: true, value: stringMatch[1].replace(/''/g, "'") };
  return { materializable: false };
}

function isValueCompatibleWithDataType(value: unknown, dataType: string | undefined): boolean {
  if (!dataType) return true;
  const normalized = dataType.toLowerCase();
  if (/(int|decimal|numeric|float|real|money)/.test(normalized)) {
    return typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()));
  }
  if (/(bit|bool)/.test(normalized)) {
    return typeof value === "boolean" || value === 0 || value === 1 || value === "0" || value === "1";
  }
  if (/(char|text|xml|json|date|time|uniqueidentifier)/.test(normalized)) {
    return typeof value === "string" || typeof value === "number";
  }
  return true;
}

function contractEvidence(
  contract: MetadataTableContract,
  column: MetadataColumnContract | undefined
): Record<string, unknown> {
  return {
    source: contract.source,
    table: contract.table_name,
    endpoint: contract.schema_endpoint,
    column
  };
}

function contractCacheKey(baseUrl: string, tableName: string): string {
  const scope = `${baseUrl.replace(/[^a-zA-Z0-9.-]/g, "_")}:${tableName.toLowerCase()}`;
  return `${CONTRACT_CACHE_PREFIX}${scope}`;
}

function hasServerDefault(value: string | undefined): boolean {
  return Boolean(value && value.trim() && !/^null$/i.test(value.trim()));
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function isReferenceValue(value: unknown): boolean {
  return typeof value === "string" && /^\$[A-Za-z0-9_-]+\.[A-Za-z0-9_]+$/.test(value.trim());
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return undefined;
}

function ci(record: Record<string, unknown>, key: string): unknown {
  return getCaseInsensitiveValue(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
