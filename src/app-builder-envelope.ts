export interface ApprovedOperationEnvelope {
  operation_id: string;
  original_action: "create" | "update" | "delete";
  target: string;
  collection: string;
  allowed_fields: string[];
  id_field?: string;
  id_value?: unknown;
  where?: string;
}

export interface ApprovedChangeEnvelope {
  source: "confirmed_plan";
  plan_id?: string;
  operations: ApprovedOperationEnvelope[];
}

export interface ApprovedEnvelopeOperationInput {
  operation_id?: string;
  id?: string;
  action: "create" | "update" | "delete";
  target: string;
  collection: string;
  record?: Record<string, unknown>;
  id_field?: string;
  id_value?: unknown;
  where?: string;
}

export function buildApprovedChangeEnvelope(
  planId: string | undefined,
  operations: ApprovedEnvelopeOperationInput[]
): ApprovedChangeEnvelope {
  return {
    source: "confirmed_plan",
    plan_id: planId,
    operations: operations.map(operation => ({
      operation_id: operation.operation_id ?? operation.id ?? "",
      original_action: operation.action,
      target: operation.target,
      collection: operation.collection,
      allowed_fields: Object.keys(operation.record ?? {}).sort(),
      id_field: operation.id_field,
      id_value: operation.id_value,
      where: operation.where
    }))
  };
}
