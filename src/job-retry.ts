const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

export class ActiveJobLeaseError extends Error {
  constructor(jobId: string, leaseExpiresAt: string | null) {
    super(`Job ${jobId} đang được worker khác xử lý đến ${leaseExpiresAt || "hết lease"}.`);
    this.name = "ActiveJobLeaseError";
  }
}

export function isRetryableJobError(error: unknown): boolean {
  if (error instanceof ActiveJobLeaseError || error instanceof TypeError) return true;
  const record = asRecord(error);
  if (record?.retryable === true) return true;

  const status = Number(record?.status ?? record?.statusCode ?? record?.http_status);
  if (Number.isFinite(status) && RETRYABLE_HTTP_STATUSES.has(status)) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");
  const explicitStatus = message.match(
    /(?:http|status|api|response|gateway)\D{0,24}(408|409|425|429|500|502|503|504|520|522|524)\b/i
  );
  if (explicitStatus && RETRYABLE_HTTP_STATUSES.has(Number(explicitStatus[1]))) return true;

  return /(failed to fetch|network|timeout|timed out|connection reset|temporar|rate limit|d1_error|database is locked|internal error)/i
    .test(message);
}

export function canScheduleJobRetry(input: {
  error: unknown;
  attempt_count: number;
  max_attempts: number;
  queue_available: boolean;
}): boolean {
  const maxAttempts = Math.max(1, Number(input.max_attempts || 1));
  const attemptCount = Math.max(0, Number(input.attempt_count || 0));
  return input.queue_available
    && attemptCount < maxAttempts
    && isRetryableJobError(input.error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
