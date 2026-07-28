/**
 * Typed API client. The one place we know about:
 *   - the API base URL
 *   - the canonical envelope shape `{ data, meta }` / `{ error, meta }`
 *   - the per-request auth + tenant headers
 *
 * Every query/mutation hook composes a bound instance via `useApiClient`.
 */
import type { ApiEnvelope, ApiError, ApiSuccess } from "@pintle/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: ApiError,
  ) {
    super(`${apiError.code}: ${apiError.message}`);
    this.name = "ApiClientError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
}

interface ClientDeps {
  /** Returns a fresh Clerk session JWT, or null if signed out. */
  getToken: () => Promise<string | null>;
  /** Resolved tenant id sent as `X-Tenant-Id`. */
  tenantId: string;
}

async function request<T>(
  deps: ClientDeps,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = await deps.getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant-Id": deps.tenantId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  // Even 4xx/5xx come back as envelopes; parse first, then branch.
  const payload = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || "error" in payload) {
    const failure = payload as { error: ApiError };
    throw new ApiClientError(res.status, failure.error);
  }

  return (payload as ApiSuccess<T>).data;
}

export function createApiClient(deps: ClientDeps) {
  return {
    get: <T>(path: string, options?: RequestOptions) =>
      request<T>(deps, path, { ...options, method: "GET" }),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>(deps, path, { ...options, method: "POST", body }),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>(deps, path, { ...options, method: "PATCH", body }),
    delete: <T>(path: string, options?: RequestOptions) =>
      request<T>(deps, path, { ...options, method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
