/**
 * Detect the source-file format from filename + MIME + a small content sniff.
 * Only `csv` is parsed in this module; xlsx/json are recognised so the worker
 * can refuse them cleanly (rather than mis-parsing) until later modules add
 * support.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import type { DetectedFormat } from "@pintle/contracts";

const EXT: Record<string, DetectedFormat> = {
  ".csv": "csv",
  ".tsv": "csv",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".json": "json",
};
const MIME: Record<string, DetectedFormat> = {
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "application/json": "json",
};

export async function detectFormat(
  filePath: string,
  filename: string,
  mimeType: string | undefined,
): Promise<DetectedFormat | null> {
  // 1. Extension first — cheapest and usually right.
  const ext = path.extname(filename).toLowerCase();
  if (EXT[ext]) return EXT[ext];
  if (mimeType && MIME[mimeType]) return MIME[mimeType];

  // 2. Content sniff: read first ~512 bytes.
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8").trim();
    if (head.startsWith("{") || head.startsWith("[")) return "json";
    // ZIP signature `PK\x03\x04` → xlsx (xlsx is a zip container).
    if (buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
    // Default to csv if it looks like comma/tab-delimited text.
    if (/[,\t]/.test(head)) return "csv";
  } finally {
    await fh.close();
  }
  return null;
}
