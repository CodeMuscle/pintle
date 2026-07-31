/**
 * The single storage seam. Every service reads/writes object bytes through a
 * `StorageProvider`; nothing imports the AWS SDK (or any driver) directly. That
 * is what lets a deployment run entirely on the customer's own infra — MinIO,
 * a plain filesystem, R2/B2/GCS/Azure — with no AWS lock-in and no private
 * cloud holding their data.
 */
import type { Readable } from "node:stream";

export interface StorageProvider {
  /**
   * A presigned PUT URL so a client uploads bytes directly to storage (the API
   * only ever sees metadata). S3-family only; the filesystem driver rejects
   * this until a direct-upload route exists.
   */
  presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;

  /** True if the object exists. Used to verify a client-side PUT completed. */
  objectExists(key: string): Promise<boolean>;

  /** Stream an object's bytes. Throws if the object is missing. */
  getStream(key: string): Promise<Readable>;

  /** Write bytes (buffer or stream). Creates intermediate paths as needed. */
  putObject(key: string, body: Buffer | Readable, contentType?: string): Promise<void>;

  /** Delete an object. No-op if it does not exist. */
  deleteObject(key: string): Promise<void>;
}

/**
 * Canonical object-key layout (database-blueprint Module 4):
 *   tenants/{tenantId}/projects/{projectId}/uploads/{uploadId}/{filename}
 * Path separators in the client-supplied filename are stripped so a crafted
 * name cannot escape its tenant/upload prefix.
 */
export function uploadObjectKey(
  tenantId: string,
  projectId: string,
  uploadId: string,
  filename: string,
): string {
  const safe = filename.replace(/[/\\]/g, "_");
  return `tenants/${tenantId}/projects/${projectId}/uploads/${uploadId}/${safe}`;
}
