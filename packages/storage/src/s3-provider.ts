/**
 * S3-compatible driver. Works against any S3-API store — MinIO (self-host),
 * AWS S3, Cloudflare R2, Backblaze B2, GCS, Azure Blob — purely by pointing
 * `endpoint` + `forcePathStyle` at it. This one driver covers the whole
 * self-host + low-cost story; the filesystem driver is only for a no-object-
 * store single box.
 */
import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageProvider } from "./provider.js";

export interface S3Config {
  bucket: string;
  region: string;
  /** Custom endpoint for non-AWS stores (MinIO/R2/…). Omit for real AWS S3. */
  endpoint?: string;
  /** MinIO and most self-host stores need path-style addressing. */
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const DEFAULT_PRESIGN_TTL = 900; // 15 minutes

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3Config) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  presignPut(
    key: string,
    contentType: string,
    expiresInSeconds = DEFAULT_PRESIGN_TTL,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const code = (err as { name?: string }).name;
      if (code === "NotFound" || code === "NoSuchKey" || code === "403") return false;
      // Unknown error: treat as absent but let the caller's logs surface it.
      return false;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const obj = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = obj.Body as Readable | undefined;
    if (!body) throw new Error(`storage: object "${key}" had an empty body`);
    return body;
  }

  async putObject(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
