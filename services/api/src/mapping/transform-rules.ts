/**
 * Built-in transform rules. Each tenant gets one row per rule (lazy seed via
 * `ensureBuiltinTransformRules`). Mappings reference them by `transformRuleId`
 * when `mappingType === "transform"`.
 *
 * The TypeScript config schemas live in `@pintle/contracts` (so the
 * SDK + UI can validate before the API does); this file owns the DB
 * upsert + the per-rule display names + default configs.
 */
import { MappingDTO } from "@pintle/contracts";

const BUILTIN_TRANSFORM_RULE_KEYS = MappingDTO.BUILTIN_TRANSFORM_RULE_KEYS;
type BuiltinTransformRuleKey = MappingDTO.BuiltinTransformRuleKey;

interface BuiltinDef {
  ruleKey: BuiltinTransformRuleKey;
  displayName: string;
  defaultConfig: Record<string, unknown>;
}

export const BUILTIN_RULE_DEFS: BuiltinDef[] = [
  { ruleKey: "trim", displayName: "Trim whitespace", defaultConfig: {} },
  { ruleKey: "uppercase", displayName: "Uppercase", defaultConfig: {} },
  { ruleKey: "lowercase", displayName: "Lowercase", defaultConfig: {} },
  {
    ruleKey: "concat",
    displayName: "Concatenate fields",
    defaultConfig: { separator: " " },
  },
  {
    ruleKey: "date_parse",
    displayName: "Parse date",
    defaultConfig: { format: "YYYY-MM-DD" },
  },
  {
    ruleKey: "phone_normalize",
    displayName: "Normalise phone number",
    defaultConfig: { defaultCountry: "IN" },
  },
];

// Sanity assert that BUILTIN_TRANSFORM_RULE_KEYS and BUILTIN_RULE_DEFS stay
// in lock-step.
{
  const defKeys = BUILTIN_RULE_DEFS.map((d) => d.ruleKey)
    .sort()
    .join(",");
  const enumKeys = [...BUILTIN_TRANSFORM_RULE_KEYS].sort().join(",");
  if (defKeys !== enumKeys) {
    throw new Error(`BUILTIN_RULE_DEFS (${defKeys}) drifted from contracts (${enumKeys})`);
  }
}
