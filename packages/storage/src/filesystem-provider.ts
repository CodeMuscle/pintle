/**
 * Filesystem driver — objects are files under a root directory. For the
 * smallest self-host (a single box with no object store). Proves the seam
 * isn't secretly S3-shaped.
 *
 * ponytail: `presignPut` is unsupported here — presigned direct-upload is an
 * object-store concept. A filesystem deployment needs the API to expose a
 * signed direct-upload route; until that exists, run STORAGE_DRIVER=s3 with
 * MinIO for uploads. get/put/exists/delete work fully (snapshots, reports).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { StorageProvider } from "./provider.js";

export interface FilesystemConfig {
  /** Root directory that holds all object bytes. */
  root: string;
}

export class FilesystemStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(cfg: FilesystemConfig) {
    this.root = path.resolve(cfg.root);
  }

  /** Resolve a key to an absolute path, refusing anything that escapes root. */
  private resolveKey(key: string): string {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`storage: key "${key}" escapes the storage root`);
    }
    return full;
  }

  presignPut(): Promise<string> {
    throw new Error(
      "storage: filesystem driver cannot presign a PUT; use STORAGE_DRIVER=s3 (MinIO) for direct uploads",
    );
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolveKey(key);
    await fs.access(full); // surface "missing" eagerly rather than mid-stream
    return createReadStream(full);
  }

  async putObject(key: string, body: Buffer | Readable): Promise<void> {
    const full = this.resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await fs.writeFile(full, body);
    } else {
      await pipeline(body, createWriteStream(full));
    }
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.resolveKey(key), { force: true });
  }
}
