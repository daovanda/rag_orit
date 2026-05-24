export type DebugStatus = "start" | "ok" | "skip" | "error";

export interface DebugStep {
  step: string;
  status: DebugStatus;
  detail: string;
  data?: Record<string, unknown>;
  timestamp_ms: number;
}

export function addDebugStep(
  steps: DebugStep[] | undefined,
  step: string,
  status: DebugStatus,
  detail: string,
  data?: Record<string, unknown>
): void {
  if (!steps) return;
  steps.push({
    step,
    status,
    detail,
    data,
    timestamp_ms: Date.now()
  });
}
