/**
 * Driver selection from env — the one place a deployment picks where object
 * bytes live. `STORAGE_DRIVER` defaults to `s3` (MinIO locally). Set it to
 * `filesystem` for a single-box self-host with no object store.
 */
import { FilesystemStorageProvider } from "./filesystem-provider.js";
import type { StorageProvider } from "./provider.js";
import { S3StorageProvider } from "./s3-provider.js";

type Env = Record<string, string | undefined>;

export function createStorage(env: Env = process.env): StorageProvider {
  const driver = (env.STORAGE_DRIVER ?? "s3").toLowerCase();

  if (driver === "filesystem" || driver === "fs") {
    return new FilesystemStorageProvider({ root: env.STORAGE_FS_ROOT ?? "./.storage" });
  }

  if (driver === "s3") {
    return new S3StorageProvider({
      bucket: env.S3_BUCKET ?? "pintle",
      region: env.S3_REGION ?? "us-east-1",
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    });
  }

  throw new Error(`storage: unknown STORAGE_DRIVER "${driver}" (expected: s3 | filesystem)`);
}
