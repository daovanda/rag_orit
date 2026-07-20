import { describe, expect, it } from "vitest";
import {
  ActiveJobLeaseError,
  canScheduleJobRetry,
  isRetryableJobError
} from "../src/job-retry";

describe("async job retry policy", () => {
  it.each([
    new TypeError("Failed to fetch"),
    new ActiveJobLeaseError("job_1", "2026-01-01T00:00:00Z"),
    new Error("NVIDIA API lỗi 429: rate limit"),
    new Error("HTTP 503 Service Unavailable"),
    new Error("D1_ERROR: database is locked"),
    { retryable: true, message: "upstream temporary failure" },
    { status: 504 }
  ])("recognizes transient infrastructure failures", error => {
    expect(isRetryableJobError(error)).toBe(true);
  });

  it.each([
    new Error("metadata window 500 does not exist"),
    new Error("required_field_missing"),
    new Error("unsupported_metadata_field"),
    { status: 400 },
    { retryable: false, message: "validation failed" }
  ])("does not retry deterministic validation or business errors", error => {
    expect(isRetryableJobError(error)).toBe(false);
  });

  it("requires a queue and remaining retry budget", () => {
    const error = new Error("HTTP 503 Service Unavailable");
    expect(canScheduleJobRetry({ error, attempt_count: 1, max_attempts: 3, queue_available: true })).toBe(true);
    expect(canScheduleJobRetry({ error, attempt_count: 3, max_attempts: 3, queue_available: true })).toBe(false);
    expect(canScheduleJobRetry({ error, attempt_count: 1, max_attempts: 3, queue_available: false })).toBe(false);
  });
});
