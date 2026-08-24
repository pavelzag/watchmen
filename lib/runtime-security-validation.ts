import type {
  RuntimeSecurityAction,
  RuntimeSecurityRuleCondition,
  RuntimeSecuritySeverity,
} from "@/lib/runtime-security";

export function parseRuntimeRuleCondition(value: unknown): RuntimeSecurityRuleCondition | null {
  if (!value || typeof value !== "object") return null;
  const condition = value as Record<string, unknown>;
  const kind = condition.kind;
  const rawConditionValue = condition.value;
  if (typeof kind !== "string" || typeof rawConditionValue !== "string") return null;
  const conditionValue = rawConditionValue.trim();
  if (!conditionValue) return null;

  switch (kind) {
    case "method":
      return { kind, value: conditionValue.toUpperCase() };
    case "path_prefix":
      return { kind, value: conditionValue.startsWith("/") ? conditionValue : `/${conditionValue}` };
    case "content_type":
      return { kind, value: conditionValue.toLowerCase() };
    case "body_contains":
      return { kind, value: conditionValue };
    case "source_ip_class":
      if (conditionValue !== "public" && conditionValue !== "private") return null;
      return { kind, value: conditionValue };
    default:
      return null;
  }
}

export function isRuntimeSecuritySeverity(value: unknown): value is RuntimeSecuritySeverity {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

export function isRuntimeSecurityAction(value: unknown): value is RuntimeSecurityAction {
  return value === "flag" || value === "would_block";
}
