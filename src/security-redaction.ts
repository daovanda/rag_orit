const REDACTED = "<redacted>";

const SENSITIVE_KEYS = new Set([
  "token",
  "devtoken",
  "accesstoken",
  "refreshtoken",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "credential",
  "credentials",
  "accesspass",
  "authorization",
  "apikey",
  "privatekey"
]);

export interface RedactionOptions {
  replacement?: string;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return false;
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return ["password", "secret", "credential", "accesspass", "authorization", "apikey", "privatekey"]
    .some(fragment => normalized.endsWith(fragment));
}

export function redactSensitiveString(value: string, replacement = REDACTED): string {
  return value
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${replacement}`)
    .replace(/\b(?:nvapi-|sk-|cfut_)[A-Za-z0-9._-]{6,}\b/g, replacement)
    .replace(
      /((?:["']?(?:token|dev_token|access_token|refresh_token|password|passwd|secret|client_secret|credential|credentials|accesspass|authorization|api[_-]?key|private[_-]?key)["']?)\s*[:=]\s*["']?)([^"'\s,;&}]+)/gi,
      `$1${replacement}`
    );
}

export function redactSensitiveData(
  value: unknown,
  key = "",
  options: RedactionOptions = {}
): unknown {
  const replacement = options.replacement ?? REDACTED;
  if (isSensitiveKey(key)) return replacement;
  if (typeof value === "string") return redactSensitiveString(value, replacement);
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveData(item, "", options));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactSensitiveData(entryValue, entryKey, options)
        ])
    );
  }
  return value;
}
