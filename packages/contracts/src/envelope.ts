/**
 * Canonical API response envelope — Zod schemas + inferred types.
 *
 * Source of truth: /docs/design/database-blueprint.docx → "Common API
 * envelope". EVERY HTTP endpoint in services/api returns this shape.
 *
 *   Success: { data, meta }                               (no `error`)
 *   Error:   { error: { code, message, details? }, meta } (no `data`)
 *   meta is ALWAYS { requestId, timestamp }.
 *
 * API payload fields are camelCase (DB columns are snake_case — mapped at the
 * serialization boundary by @pintle/db).
 */
import { z } from "zod";

/**
 * SCREAMING_SNAKE error codes. `VALIDATION_FAILED` is verbatim from the
 * blueprint; the rest follow its convention and cover the auth/tenant
 * taxonomy the auth guard depends on (CLAUDE.md → Tenant context resolution).
 */
export const API_ERROR_CODES = [
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "TENANT_FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** One field-level problem, e.g. `{ field: "name", issue: "required" }`. */
export const ApiErrorDetailSchema = z.object({
  field: z.string(),
  issue: z.string(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  details: z.array(ApiErrorDetailSchema).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiMetaSchema = z.object({
  /** Correlation id; also emitted on logs and the `x-request-id` header. */
  requestId: z.string(),
  /** ISO-8601 server timestamp. */
  timestamp: z.string().datetime({ offset: true }),
});
export type ApiMeta = z.infer<typeof ApiMetaSchema>;

/** Success envelope schema for a given `data` schema. */
export const apiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, meta: ApiMetaSchema });

export const ApiFailureSchema = z.object({
  error: ApiErrorSchema,
  meta: ApiMetaSchema,
});

/** Full envelope (success ∪ failure) schema for a given `data` schema. */
export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.union([apiSuccessSchema(data), ApiFailureSchema]);

export interface ApiSuccess<TData> {
  data: TData;
  meta: ApiMeta;
}
export type ApiFailure = z.infer<typeof ApiFailureSchema>;
export type ApiEnvelope<TData> = ApiSuccess<TData> | ApiFailure;

export const ok = <TData>(data: TData, meta: ApiMeta): ApiSuccess<TData> => ({
  data,
  meta,
});

export const fail = (error: ApiError, meta: ApiMeta): ApiFailure => ({
  error,
  meta,
});

/** Narrowing helper — true for success envelopes. */
export const isApiSuccess = <TData>(envelope: ApiEnvelope<TData>): envelope is ApiSuccess<TData> =>
  "data" in envelope;
