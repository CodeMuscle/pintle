import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStorage } from "./factory.js";
import { FilesystemStorageProvider } from "./filesystem-provider.js";

async function drain(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

describe("FilesystemStorageProvider", () => {
  let root: string;
  let store: FilesystemStorageProvider;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pintle-storage-"));
    store = new FilesystemStorageProvider({ root });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const key = "tenants/t1/projects/p1/uploads/u1/data.csv";

  it("round-trips put → exists → get → delete", async () => {
    expect(await store.objectExists(key)).toBe(false);

    await store.putObject(key, Buffer.from("a,b\n1,2\n"), "text/csv");
    expect(await store.objectExists(key)).toBe(true);
    expect(await drain(await store.getStream(key))).toBe("a,b\n1,2\n");

    await store.deleteObject(key);
    expect(await store.objectExists(key)).toBe(false);
    await store.deleteObject(key); // idempotent — no throw on missing
  });

  it("refuses keys that escape the storage root", async () => {
    await expect(store.getStream("../../etc/passwd")).rejects.toThrow(/escapes the storage root/);
    await expect(store.putObject("../evil", Buffer.from("x"))).rejects.toThrow(
      /escapes the storage root/,
    );
  });

  it("cannot presign (documented limitation)", async () => {
    expect(() => store.presignPut()).toThrow(/cannot presign/);
  });

  it("factory selects the filesystem driver", () => {
    const provider = createStorage({ STORAGE_DRIVER: "filesystem", STORAGE_FS_ROOT: root });
    expect(provider).toBeInstanceOf(FilesystemStorageProvider);
  });

  it("factory rejects an unknown driver", () => {
    expect(() => createStorage({ STORAGE_DRIVER: "carrierpigeon" })).toThrow(
      /unknown STORAGE_DRIVER/,
    );
  });
});
