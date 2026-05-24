export function getStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getNumberArg(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = args[name];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function truncateDebugText(value: unknown, maxChars = 700): string {
  const text = getErrorText(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function toArrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function getCaseInsensitiveValue(record: Record<string, unknown>, key: string): unknown {
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

export function pickRecordFields(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = getCaseInsensitiveValue(record, key);
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  }
  return output;
}
