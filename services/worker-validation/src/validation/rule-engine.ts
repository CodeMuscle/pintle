/**
 * v1 rule engine. Pure functions over a row + (resolved) mapping context.
 * Each returns 0 or 1 issue spec; the processor turns specs into rows
 * inserted into `validation_issues` in batches of 1 000.
 *
 * Rules:
 *   - required:           value empty + (mapping.isRequiredOverride !== false) + dest.isRequired
 *   - type_mismatch:      value present + parses-as type ≠ declared destination dataType
 *   - regex:              mapping.config.pattern set + value doesn't match
 *   - enum:               destination has enumValues + value not in set
 *   - date_format:        destination.dataType="date" + value doesn't parse against mapping.config.format ?? ISO
 *   - foreign_key_exists: mapping.config.foreignKey = "<other dest field>" + within-batch value not present in that field's value set
 *   - uniqueness:         mapping.config.unique = true + duplicate value within batch
 *
 * `transform` mappings: the value is run through the transform first; rules
 * see the post-transform value. (v1 transforms: trim/upper/lower; concat
 * applies the separator to source value treated as-is; date_parse/phone
 * leave the value unchanged for validation purposes.)
 */
import type { IssueSeverity, ValidationRuleKey } from "@pintle/contracts";

export interface ResolvedMapping {
  sourceFieldKey?: string;
  destinationFieldKey: string;
  mappingType: "direct" | "constant" | "transform" | "composite" | "ignored";
  transformRuleKey?: string;
  isRequiredOverride?: boolean | null;
  defaultValue?: unknown;
  config?: Record<string, unknown>;
  /** Destination-schema metadata for this field. */
  destField: {
    dataType?: string; // string | number | date | boolean | enum
    isRequired?: boolean;
    enumValues?: string[];
  };
}

export interface RowContext {
  rowIndex: number;
  /** Row keyed by source field name. */
  row: Record<string, string>;
}

export interface IssueSpec {
  severity: IssueSeverity;
  ruleKey: ValidationRuleKey;
  rowIndex: number;
  sourceFieldKey: string | null;
  destinationFieldKey: string;
  message: string;
  sampleValue: string | null;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE_ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function applyTransform(value: string, ruleKey: string | undefined): string {
  if (!ruleKey) return value;
  switch (ruleKey) {
    case "trim":
      return value.trim();
    case "uppercase":
      return value.toUpperCase();
    case "lowercase":
      return value.toLowerCase();
    default:
      return value;
  }
}

/** Resolve the post-transform value for a mapping, or null if not applicable. */
function readValue(m: ResolvedMapping, row: Record<string, string>): string {
  if (m.mappingType === "constant") {
    return m.defaultValue == null ? "" : String(m.defaultValue);
  }
  if (m.mappingType === "ignored") return "";
  const raw = m.sourceFieldKey ? (row[m.sourceFieldKey] ?? "") : "";
  return applyTransform(raw, m.transformRuleKey);
}

const isEmpty = (s: string) => s === "" || s == null;

/**
 * State that the engine accumulates as it streams rows — for the rules
 * that need batch-wide context (uniqueness, foreign_key_exists).
 */
export class RuleEngineState {
  /** dest_field_key → Map<value, [first rowIndex, count]> for uniqueness. */
  readonly uniqueSeen = new Map<string, Map<string, { firstRow: number; count: number }>>();
  /** dest_field_key → Set<value>, for foreign_key_exists target sides. */
  readonly fkTargets = new Map<string, Set<string>>();
  /** [rowIndex, sourceField, destField, value, refField] queued for second pass. */
  readonly fkPending: Array<{
    rowIndex: number;
    sourceFieldKey: string | null;
    destinationFieldKey: string;
    value: string;
    refField: string;
  }> = [];
}

/** Run per-row rules; returns any issues to insert. Mutates state for uniqueness/fk. */
export function evaluateRow(
  mappings: ResolvedMapping[],
  ctx: RowContext,
  state: RuleEngineState,
): IssueSpec[] {
  const issues: IssueSpec[] = [];

  for (const m of mappings) {
    if (m.mappingType === "ignored") continue;
    const value = readValue(m, ctx.row);
    const source = m.sourceFieldKey ?? null;

    // required
    const requiredDeclared = m.destField.isRequired === true;
    const requiredOverride = m.isRequiredOverride;
    const requiredActive =
      requiredOverride === false ? false : requiredOverride === true || requiredDeclared;
    if (requiredActive && isEmpty(value)) {
      issues.push({
        severity: "error",
        ruleKey: "required",
        rowIndex: ctx.rowIndex,
        sourceFieldKey: source,
        destinationFieldKey: m.destinationFieldKey,
        message: `"${m.destinationFieldKey}" is required but value is empty`,
        sampleValue: null,
      });
      // skip remaining rules on empty required — the value is missing
      continue;
    }
    if (isEmpty(value)) {
      // Non-required + empty → no other rules apply (we treat empty as null).
      // But uniqueness over empty would be noisy; skip.
      continue;
    }

    // type_mismatch
    const dataType = m.destField.dataType;
    if (dataType === "number" && !NUMBER_RE.test(value)) {
      issues.push({
        severity: "error",
        ruleKey: "type_mismatch",
        rowIndex: ctx.rowIndex,
        sourceFieldKey: source,
        destinationFieldKey: m.destinationFieldKey,
        message: `expected number, got "${value}"`,
        sampleValue: value,
      });
    } else if (dataType === "boolean" && !/^(true|false|yes|no|y|n|0|1)$/i.test(value)) {
      issues.push({
        severity: "error",
        ruleKey: "type_mismatch",
        rowIndex: ctx.rowIndex,
        sourceFieldKey: source,
        destinationFieldKey: m.destinationFieldKey,
        message: `expected boolean, got "${value}"`,
        sampleValue: value,
      });
    } else if (dataType === "date") {
      const format = (m.config?.format as string | undefined) ?? undefined;
      // Pattern check first (cheap), then a real Date.parse so "2024-13-99"
      // (regex-shape-OK, semantically nonsense) is still flagged.
      const patternOk = format ? matchesFormat(value, format) : DATE_ISO_RE.test(value);
      const parseOk = !Number.isNaN(Date.parse(value));
      if (!patternOk || !parseOk) {
        issues.push({
          severity: "error",
          ruleKey: "date_format",
          rowIndex: ctx.rowIndex,
          sourceFieldKey: source,
          destinationFieldKey: m.destinationFieldKey,
          message: format
            ? `date does not match format "${format}": "${value}"`
            : `date does not parse as ISO: "${value}"`,
          sampleValue: value,
        });
      }
    }

    // enum
    if (m.destField.enumValues && m.destField.enumValues.length > 0) {
      if (!m.destField.enumValues.includes(value)) {
        issues.push({
          severity: "error",
          ruleKey: "enum",
          rowIndex: ctx.rowIndex,
          sourceFieldKey: source,
          destinationFieldKey: m.destinationFieldKey,
          message: `value "${value}" not in [${m.destField.enumValues.join(", ")}]`,
          sampleValue: value,
        });
      }
    }

    // regex (custom pattern on the mapping config)
    const pattern = m.config?.pattern as string | undefined;
    if (pattern) {
      try {
        const re = new RegExp(pattern);
        if (!re.test(value)) {
          issues.push({
            severity: "error",
            ruleKey: "regex",
            rowIndex: ctx.rowIndex,
            sourceFieldKey: source,
            destinationFieldKey: m.destinationFieldKey,
            message: `value "${value}" does not match /${pattern}/`,
            sampleValue: value,
          });
        }
      } catch {
        // bad pattern config → skip silently; surfaced elsewhere ideally
      }
    }

    // uniqueness (intra-batch)
    if (m.config?.unique === true) {
      const map =
        state.uniqueSeen.get(m.destinationFieldKey) ??
        new Map<string, { firstRow: number; count: number }>();
      const seen = map.get(value);
      if (!seen) {
        map.set(value, { firstRow: ctx.rowIndex, count: 1 });
      } else {
        seen.count++;
        issues.push({
          severity: "error",
          ruleKey: "uniqueness",
          rowIndex: ctx.rowIndex,
          sourceFieldKey: source,
          destinationFieldKey: m.destinationFieldKey,
          message: `duplicate value "${value}" (first seen on row ${seen.firstRow})`,
          sampleValue: value,
        });
      }
      state.uniqueSeen.set(m.destinationFieldKey, map);
    }

    // foreign_key_exists — collect target sides + queue source sides for pass 2
    const fkRef = m.config?.foreignKey as string | undefined;
    if (fkRef) {
      state.fkPending.push({
        rowIndex: ctx.rowIndex,
        sourceFieldKey: source,
        destinationFieldKey: m.destinationFieldKey,
        value,
        refField: fkRef,
      });
    }
    // Every non-empty value of every dest field is a potential FK target.
    const targetSet = state.fkTargets.get(m.destinationFieldKey) ?? new Set<string>();
    targetSet.add(value);
    state.fkTargets.set(m.destinationFieldKey, targetSet);
  }

  return issues;
}

/** After streaming all rows, resolve pending fk checks. */
export function resolveForeignKeyIssues(state: RuleEngineState): IssueSpec[] {
  const issues: IssueSpec[] = [];
  for (const fk of state.fkPending) {
    const refSet = state.fkTargets.get(fk.refField);
    if (!refSet || !refSet.has(fk.value)) {
      issues.push({
        severity: "error",
        ruleKey: "foreign_key_exists",
        rowIndex: fk.rowIndex,
        sourceFieldKey: fk.sourceFieldKey,
        destinationFieldKey: fk.destinationFieldKey,
        message: `value "${fk.value}" not found in ${fk.refField}`,
        sampleValue: fk.value,
      });
    }
  }
  return issues;
}

/** Crude format check: tokens YYYY/MM/DD only — good enough for v1. */
function matchesFormat(value: string, format: string): boolean {
  const re = format
    .replace(/YYYY/g, "(\\d{4})")
    .replace(/MM/g, "(\\d{2})")
    .replace(/DD/g, "(\\d{2})")
    .replace(/HH/g, "(\\d{2})")
    .replace(/mm/g, "(\\d{2})")
    .replace(/ss/g, "(\\d{2})");
  return new RegExp(`^${re}$`).test(value);
}
