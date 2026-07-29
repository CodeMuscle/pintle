/**
 * Thin Nest wrapper over the `@pintle/storage` provider so feature modules
 * inject one service and never touch a driver. The provider (S3/MinIO, or
 * filesystem) is chosen from env at construction — see `createStorage`.
 *
 * Object key pattern (blueprint Module 4):
 *   tenants/{tenant_id}/projects/{project_id}/uploads/{upload_id}/{filename}
 */
import { Injectable } from "@nestjs/common";
import { createStorage, uploadObjectKey, type StorageProvider } from "@pintle/storage";

@Injectable()
export class StorageService {
  private readonly storage: StorageProvider = createStorage();

  objectKey(tenantId: string, projectId: string, uploadId: string, filename: string): string {
    return uploadObjectKey(tenantId, projectId, uploadId, filename);
  }

  /** Presigned PUT URL (default 15 min) for direct client upload. */
  presignPut(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    return this.storage.presignPut(key, contentType, expiresInSeconds);
  }

  /** True if the object exists; used by uploads/complete to verify the PUT. */
  objectExists(key: string): Promise<boolean> {
    return this.storage.objectExists(key);
  }
}
