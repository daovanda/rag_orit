import {
  parseExpectedWriteOperations,
  type AppBuilderVerificationReport,
  type ExpectedWriteOperation,
  type OperationVerificationResult
} from "./app-builder-verification";
import {
  buildApprovedChangeEnvelope,
  type ApprovedChangeEnvelope
} from "./app-builder-envelope";

export type { ApprovedChangeEnvelope, ApprovedOperationEnvelope } from "./app-builder-envelope";
export { buildApprovedChangeEnvelope } from "./app-builder-envelope";

export interface ResidualPlanResult {
  valid: boolean;
  within_approved_envelope: boolean;
  requires_new_confirmation: boolean;
  operations: Array<Record<string, unknown>>;
  confirmation_required_operations: Array<Record<string, unknown>>;
  completed_operation_ids: string[];
  residual_operation_ids: string[];
  blockers: Array<Record<string, unknown>>;
  approved_change_envelope: ApprovedChangeEnvelope;
}

const TARGET_ALIAS: Record<string, string> = {
  application: "app",
  app_service: "appservice",
  role_app: "roleapp",
  role_menu: "rolemenu"
};

export function buildResidualPlan(
  writeResult: Record<string, unknown>,
  verification: AppBuilderVerificationReport,
  approvedEnvelope?: ApprovedChangeEnvelope
): ResidualPlanResult {
  const expected = parseExpectedWriteOperations(writeResult.expected_operations);
  const envelope = approvedEnvelope ?? buildApprovedChangeEnvelope(
    typeof writeResult.plan_id === "string" ? writeResult.plan_id : undefined,
    expected
  );
  const verificationById = new Map(
    verification.operation_results.map(result => [result.operation_id, result])
  );
  const verifiedReferences = verification.verified_operations;
  const operations: Array<Record<string, unknown>> = [];
  const blockers: Array<Record<string, unknown>> = [];
  const confirmationRequiredOperations: Array<Record<string, unknown>> = [];

  for (const operation of expected) {
    const result = verificationById.get(operation.operation_id);
    if (result?.status === "passed") continue;
    if (!result || result.status === "inconclusive" || result.observed_state === "unknown") {
      blockers.push(blocker(
        "verification_inconclusive",
        operation,
        "Không đủ evidence để xác định entity đã ghi hay chưa; không được retry mù.",
        result
      ));
      continue;
    }

    const residual = buildResidualOperation(operation, result, verifiedReferences);
    if ("blocker" in residual) {
      blockers.push(residual.blocker);
      const proposedOperation = asRecord(residual.blocker.proposed_operation);
      if (Object.keys(proposedOperation).length) confirmationRequiredOperations.push(proposedOperation);
      continue;
    }
    operations.push(residual.operation);
  }

  const scopeErrors = validateResidualScope(operations, envelope);
  blockers.push(...scopeErrors);
  const requiresNewConfirmation = blockers.some(item =>
    [
      "repair_requires_scope_expansion",
      "residual_operation_outside_envelope",
      "residual_action_outside_envelope",
      "residual_target_outside_envelope",
      "residual_fields_outside_envelope"
    ].includes(String(item.code ?? ""))
  );

  return {
    valid: blockers.length === 0 && operations.length > 0,
    within_approved_envelope: scopeErrors.length === 0 && !requiresNewConfirmation,
    requires_new_confirmation: requiresNewConfirmation,
    operations: blockers.length ? [] : operations,
    confirmation_required_operations: confirmationRequiredOperations,
    completed_operation_ids: verification.operation_results
      .filter(result => result.status === "passed")
      .map(result => result.operation_id),
    residual_operation_ids: operations.map(operation => String(operation.id ?? "")),
    blockers,
    approved_change_envelope: envelope
  };
}

function buildResidualOperation(
  operation: ExpectedWriteOperation,
  result: OperationVerificationResult,
  verifiedReferences: Record<string, Record<string, unknown>>
): { operation: Record<string, unknown> } | { blocker: Record<string, unknown> } {
  const target = TARGET_ALIAS[operation.target] ?? operation.target;
  const dependencies = (operation.depends_on ?? []).filter(id => !verifiedReferences[id]);
  const base: Record<string, unknown> = {
    id: operation.operation_id,
    phase: operation.phase,
    depends_on: dependencies
  };

  if (result.observed_state === "absent") {
    if (operation.action !== "create") {
      const proposedOperation = operation.action === "update"
        ? {
          ...base,
          op: `create_${target}`,
          record: resolveReferences(operation.record ?? {}, verifiedReferences)
        }
        : undefined;
      return {
        blocker: {
          ...blocker(
            "repair_requires_scope_expansion",
            operation,
            `${operation.action} target đã biến mất; tạo lại entity không nằm trong action đã được xác nhận.`,
            result
          ),
          proposed_operation: proposedOperation
        }
      };
    }
    return {
      operation: {
        ...base,
        op: `create_${target}`,
        record: resolveReferences(operation.record ?? {}, verifiedReferences)
      }
    };
  }

  if (operation.action === "delete") {
    return {
      operation: {
        ...base,
        op: `delete_${target}`,
        id_value: resolveReferences(operation.id_value, verifiedReferences),
        where: resolveReferences(operation.where, verifiedReferences)
      }
    };
  }

  const mismatchedRecord = Object.fromEntries(
    result.mismatches.map(mismatch => [
      mismatch.field,
      resolveReferences(mismatch.expected, verifiedReferences)
    ])
  );
  if (!Object.keys(mismatchedRecord).length) {
    return {
      blocker: blocker(
        "repair_has_no_safe_delta",
        operation,
        "Entity tồn tại nhưng verifier không xác định được field delta an toàn.",
        result
      )
    };
  }

  const idField = operation.id_field;
  const actualId = idField
    ? getCaseInsensitive(result.actual_record ?? result.reference ?? {}, idField)
    : undefined;
  const idValue = actualId ?? operation.id_value;
  if (idValue === undefined || idValue === null || idValue === "") {
    return {
      blocker: blocker(
        "repair_target_id_missing",
        operation,
        "Không resolve được metadata ID của entity hiện có; update tự động không an toàn.",
        result
      )
    };
  }

  return {
    operation: {
      ...base,
      op: `update_${target}`,
      id_value: idValue,
      record: mismatchedRecord
    }
  };
}

export function validateResidualScope(
  residualOperations: Array<Record<string, unknown>>,
  envelope: ApprovedChangeEnvelope
): Array<Record<string, unknown>> {
  const blockers: Array<Record<string, unknown>> = [];
  const allowedById = new Map(envelope.operations.map(operation => [operation.operation_id, operation]));

  for (const operation of residualOperations) {
    const operationId = String(operation.id ?? "");
    const allowed = allowedById.get(operationId);
    const parsed = parseOperationName(String(operation.op ?? ""));
    if (!allowed || !parsed) {
      blockers.push({
        code: "residual_operation_outside_envelope",
        operation_id: operationId,
        repair_hint: "Tạo pending action mới và yêu cầu người dùng xác nhận."
      });
      continue;
    }

    const normalizedTarget = TARGET_ALIAS[allowed.target] ?? allowed.target;
    const allowedActions = allowed.original_action === "create"
      ? new Set(["create", "update"])
      : new Set([allowed.original_action]);
    if (parsed.target !== normalizedTarget || !allowedActions.has(parsed.action)) {
      blockers.push({
        code: "residual_action_outside_envelope",
        operation_id: operationId,
        expected: { target: normalizedTarget, actions: [...allowedActions] },
        actual: parsed,
        repair_hint: "Không tự apply; tạo pending action mới để xác nhận phạm vi thay đổi."
      });
    }

    const residualFields = Object.keys(asRecord(operation.record));
    const unapprovedFields = residualFields.filter(field => !allowed.allowed_fields.includes(field));
    if (unapprovedFields.length) {
      blockers.push({
        code: "residual_fields_outside_envelope",
        operation_id: operationId,
        expected: allowed.allowed_fields,
        actual: unapprovedFields,
        repair_hint: "Không thêm field ngoài plan đã xác nhận."
      });
    }
  }
  return blockers;
}

function parseOperationName(value: string): { action: string; target: string } | undefined {
  const match = value.match(/^(create|update|delete)_(.+)$/);
  return match ? { action: match[1], target: match[2] } : undefined;
}

function resolveReferences(
  value: unknown,
  references: Record<string, Record<string, unknown>>
): unknown {
  if (Array.isArray(value)) return value.map(item => resolveReferences(item, references));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, resolveReferences(item, references)])
    );
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/);
  if (exact && references[exact[1]]) {
    return getCaseInsensitive(references[exact[1]], exact[2]);
  }
  return value.replace(/\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)/g, (match, operationId: string, field: string) => {
    if (!references[operationId]) return match;
    const resolved = getCaseInsensitive(references[operationId], field);
    return resolved === undefined || resolved === null ? match : String(resolved);
  });
}

function blocker(
  code: string,
  operation: ExpectedWriteOperation,
  detail: string,
  evidence?: unknown
): Record<string, unknown> {
  return {
    code,
    operation_id: operation.operation_id,
    entity: operation.target,
    detail,
    evidence,
    repair_hint: "Dừng auto-repair và yêu cầu xác nhận mới nếu cần mở rộng phạm vi."
  };
}

function getCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
