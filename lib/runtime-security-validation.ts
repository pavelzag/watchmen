import {
  KNOWN_ATTACK_VECTORS,
  type KnownAttackVectorId,
  type RuntimeSecurityAction,
  type RuntimeSecurityRuleCondition,
  type RuntimeSecurityRuleMode,
  type RuntimeSecuritySeverity,
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
    case "path_regex": {
      if (conditionValue.length > 200) return null;
      try {
        // Validate regex syntax at rule creation/update time.
        new RegExp(conditionValue, "i");
        return { kind, value: conditionValue };
      } catch {
        return null;
      }
    }
    case "content_type":
      return { kind, value: conditionValue.toLowerCase() };
    case "body_contains":
      return { kind, value: conditionValue };
    case "source_ip_class":
      if (conditionValue !== "public" && conditionValue !== "private") return null;
      return { kind, value: conditionValue };
    case "status_code": {
      const parts = conditionValue.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
      if (parts.length === 0) return null;
      const valid = parts.every((p) => /^\d{3}$/.test(p) || /^[1-5]xx$/.test(p));
      if (!valid) return null;
      return { kind, value: parts.join(",") };
    }
    case "known_attack_vector": {
      if (!(conditionValue in KNOWN_ATTACK_VECTORS)) return null;
      return { kind, value: conditionValue as KnownAttackVectorId };
    }
    default:
      return null;
  }
}

export function isRuntimeSecuritySeverity(value: unknown): value is RuntimeSecuritySeverity {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

export function isRuntimeSecurityAction(value: unknown): value is RuntimeSecurityAction {
  return value === "flag" || value === "would_block" || value === "alert" || value === "block";
}

export function isRuntimeSecurityRuleMode(value: unknown): value is RuntimeSecurityRuleMode {
  return value === "detect" || value === "enforce";
}
