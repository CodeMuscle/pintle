/**
 * Schema inference over a sample of CSV rows. Pure functions — no I/O —
 * so they're cheap to unit-test alongside the streaming worker.
 *
 * Per blueprint Module 5 → SourceSchemaSnapshot.schema_json columns shape:
 *   { fieldKey, displayName, dataType, sampleValues, nullable, enumValues? }
 *
 * Decision order (first match wins):
 *   boolean → date → number → enum (cardinality < 20) → string
 *
 * Boolean is checked first so `1`/`0` aren't pre-empted as numbers; date is
 * checked before number so `20240101` isn't pre-empted as a number.
 */
import type { FieldDataType } from "@pintle/contracts";

const SAMPLE_LIMIT = 100;
const ENUM_MAX_CARDINALITY = 20;
const SAMPLE_PREVIEW = 5;

const BOOLEAN_TOKENS = new Set(["true", "false", "yes", "no", "y", "n", "0", "1"]);
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
// YYYY-MM-DD or ISO-8601 with optional time + offset.
const DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isEmpty = (v: string) => v === "" || v == null;

function inferColumnType(values: string[]): {
  dataType: FieldDataType;
  nullable: boolean;
  enumValues?: string[];
} {
  const nonEmpty = values.filter((v) => !isEmpty(v));
  const nullable = nonEmpty.length !== values.length;

  if (nonEmpty.length === 0) return { dataType: "string", nullable: true };

  if (nonEmpty.every((v) => BOOLEAN_TOKENS.has(v.toLowerCase()))) {
    // …but only if at least one distinct token is non-numeric, else it's
    // ambiguous (all 0/1) and number is the safer call.
    if (nonEmpty.some((v) => !/^[01]$/.test(v))) {
      return { dataType: "boolean", nullable };
    }
  }
  if (nonEmpty.every((v) => DATE_RE.test(v))) {
    return { dataType: "date", nullable };
  }
  if (nonEmpty.every((v) => NUMBER_RE.test(v))) {
    return { dataType: "number", nullable };
  }

  const distinct = new Set(nonEmpty);
  if (distinct.size > 0 && distinct.size <= ENUM_MAX_CARDINALITY) {
    return {
      dataType: "enum",
      nullable,
      enumValues: [...distinct].sort(),
    };
  }
  return { dataType: "string", nullable };
}

export interface InferredColumn {
  fieldKey: string;
  displayName: string;
  dataType: FieldDataType;
  nullable: boolean;
  sampleValues: string[];
  enumValues?: string[];
}

/** Build inferred columns from sample row records keyed by header. */
export function inferSchema(
  headers: string[],
  sampleRows: Record<string, string>[],
): InferredColumn[] {
  const cap = Math.min(sampleRows.length, SAMPLE_LIMIT);
  return headers.map((h) => {
    const values: string[] = [];
    for (let i = 0; i < cap; i++) {
      const r = sampleRows[i];
      values.push(r ? (r[h] ?? "") : "");
    }
    const { dataType, nullable, enumValues } = inferColumnType(values);
    const distinctPreview = [...new Set(values.filter((v) => !isEmpty(v)))].slice(
      0,
      SAMPLE_PREVIEW,
    );
    return {
      fieldKey: h,
      displayName: h,
      dataType,
      nullable,
      sampleValues: distinctPreview,
      ...(enumValues ? { enumValues } : {}),
    };
  });
}

export const SCHEMA_INFERENCE_SAMPLE_LIMIT = SAMPLE_LIMIT;
