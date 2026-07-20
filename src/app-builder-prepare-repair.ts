import { runChatModel } from "./ai";
import { CHAT_MODEL, type Env } from "./config";
import { isSensitiveKey, redactSensitiveData } from "./security-redaction";

const PREPARE_REPAIR_MAX_TOKENS = 3072;
const MAX_REPAIR_OPERATIONS = 80;

export interface PrepareRepairRequest {
  operations: Array<Record<string, unknown>>;
  blocking_errors: unknown;
  attempt: number;
}

export interface PrepareRepairResult {
  operations?: Array<Record<string, unknown>>;
  model?: string;
  error?: string;
}

export async function repairInvalidPrepareOperations(
  env: Env,
  request: PrepareRepairRequest
): Promise<PrepareRepairResult> {
  if (!request.operations.length || request.operations.length > MAX_REPAIR_OPERATIONS) {
    return { error: "Số operation không phù hợp để auto-repair an toàn." };
  }

  const safeOperations = redactSensitiveData(request.operations, "", { replacement: "<redacted:preserve>" });
  const safeErrors = redactSensitiveData(request.blocking_errors, "", { replacement: "<redacted:preserve>" });
  const response = await runChatModel(CHAT_MODEL, {
    max_tokens: PREPARE_REPAIR_MAX_TOKENS,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Bạn sửa payload metadata App Builder từ structured blocking_errors.
Chỉ trả JSON hợp lệ theo dạng {"operations":[...]} và không giải thích.
Không thêm, xóa hoặc đổi operation id. Không đổi op, phase, depends_on, id_field, id_value, where, cascade hoặc cờ an toàn.
Chỉ sửa record theo blocking_errors. Giữ mọi field record hiện có; không bỏ field để làm plan valid.
Không đoán ID, quan hệ, default hoặc field chưa được evidence chứng minh.
Giá trị <redacted:preserve> là bí mật và phải được giữ nguyên đúng placeholder.
Nếu không thể sửa chắc chắn, trả nguyên operations.`
      },
      {
        role: "user",
        content: JSON.stringify({
          attempt: request.attempt,
          operations: safeOperations,
          blocking_errors: safeErrors
        })
      }
    ]
  }, env);

  const proposed = parseRepairOperations(response.response ?? "");
  if (!proposed) {
    return { model: response.model, error: "Model không trả operations JSON hợp lệ." };
  }

  const normalized = validateAndNormalizeRepair(request.operations, proposed, request.blocking_errors);
  if (!normalized.operations) {
    return { model: response.model, error: normalized.error };
  }

  return { operations: normalized.operations, model: response.model };
}

export function parseRepairOperations(text: string): Array<Record<string, unknown>> | undefined {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (!Array.isArray(parsed.operations)) return undefined;
    const operations = parsed.operations.filter(isRecord);
    return operations.length === parsed.operations.length ? operations : undefined;
  } catch {
    return undefined;
  }
}

export function validateAndNormalizeRepair(
  currentOperations: Array<Record<string, unknown>>,
  proposedOperations: Array<Record<string, unknown>>,
  blockingErrors: unknown
): { operations?: Array<Record<string, unknown>>; error?: string } {
  const currentById = operationMap(currentOperations);
  const proposedById = operationMap(proposedOperations);
  if (!currentById || !proposedById || currentById.size !== proposedById.size) {
    return { error: "Auto-repair phải giữ nguyên tập operation id." };
  }

  const errorFieldsByOperation = collectErrorFields(blockingErrors);
  const normalized: Array<Record<string, unknown>> = [];
  let hasRepairDelta = false;

  for (const current of currentOperations) {
    const operationId = String(current.id ?? "");
    const proposed = proposedById.get(operationId);
    if (!proposed || String(proposed.op ?? "") !== String(current.op ?? "")) {
      return { error: `Auto-repair đã đổi action/target của operation ${operationId}.` };
    }

    const currentRecord = asRecord(current.record) ?? {};
    const proposedRecord = asRecord(proposed.record) ?? {};
    const missingFields = Object.keys(currentRecord)
      .filter(field => !hasCaseInsensitiveKey(proposedRecord, field));
    if (missingFields.length) {
      return { error: `Auto-repair đã bỏ field của operation ${operationId}: ${missingFields.join(", ")}.` };
    }

    const repairableFields = new Set([
      ...(errorFieldsByOperation.get(operationId) ?? []),
      ...(errorFieldsByOperation.get("*") ?? [])
    ].map(field => field.toLowerCase()));
    const nextRecord: Record<string, unknown> = {};
    for (const [field, proposedValue] of Object.entries(proposedRecord)) {
      const currentEntry = getCaseInsensitiveEntry(currentRecord, field);
      if (!currentEntry) {
        return { error: `Auto-repair thêm field ${field}; cần xác nhận plan mới.` };
      }

      const [currentField, currentValue] = currentEntry;
      if (isSensitiveKey(currentField)) {
        nextRecord[currentField] = currentValue;
        continue;
      }
      if (!sameJsonValue(currentValue, proposedValue)
        && !repairableFields.has(currentField.toLowerCase())) {
        return { error: `Auto-repair đổi field ${currentField} không liên quan tới blocking_errors.` };
      }
      if (!sameJsonValue(currentValue, proposedValue)
        && !isRepresentationEquivalent(currentValue, proposedValue)) {
        return { error: `Auto-repair đổi ý nghĩa giá trị ${currentField}; cần xác nhận plan mới.` };
      }
      if (!sameJsonValue(currentValue, proposedValue)) hasRepairDelta = true;
      nextRecord[currentField] = proposedValue;
    }

    normalized.push({
      ...current,
      record: nextRecord
    });
  }

  if (!hasRepairDelta) {
    return { error: "Auto-repair không tạo ra thay đổi an toàn mới." };
  }

  return { operations: normalized };
}

function operationMap(
  operations: Array<Record<string, unknown>>
): Map<string, Record<string, unknown>> | undefined {
  const output = new Map<string, Record<string, unknown>>();
  for (const operation of operations) {
    const id = String(operation.id ?? "").trim();
    if (!id || output.has(id)) return undefined;
    output.set(id, operation);
  }
  return output;
}

function collectErrorFields(value: unknown): Map<string, string[]> {
  const output = new Map<string, string[]>();
  const errors = Array.isArray(value) ? value : [];
  for (const item of errors) {
    if (!isRecord(item)) continue;
    const operationId = String(item.operation_id ?? "*").trim() || "*";
    const fields = String(item.field ?? "")
      .split(",")
      .map(field => field.trim())
      .filter(Boolean);
    output.set(operationId, [...new Set([...(output.get(operationId) ?? []), ...fields])]);
  }
  return output;
}

function isRepresentationEquivalent(left: unknown, right: unknown): boolean {
  if (sameJsonValue(left, right)) return true;
  if (typeof left === "string" && typeof right === "string") return left.trim() === right.trim();
  if (isScalar(left) && isScalar(right)) return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
  return false;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function hasCaseInsensitiveKey(record: Record<string, unknown>, key: string): boolean {
  return Boolean(getCaseInsensitiveEntry(record, key));
}

function getCaseInsensitiveEntry(
  record: Record<string, unknown>,
  key: string
): [string, unknown] | undefined {
  return Object.entries(record).find(([field]) => field.toLowerCase() === key.toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
