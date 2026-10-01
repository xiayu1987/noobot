/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { CliUsageError } from "./cli-args.js";

const DEFAULT_MIME_TYPE = "application/octet-stream";

export async function readCliAttachments(filePaths = [], { cwd = process.cwd() } = {}) {
  const { maxFileSizeBytes, maxTotalSizeBytes } = LENGTH_THRESHOLDS.attachments;
  const resolved = [];
  let totalBytes = 0;
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(cwd, filePath);
    let info;
    try {
      info = await stat(absolutePath);
    } catch {
      throw new CliUsageError(`attachment not found: ${filePath}`);
    }
    if (!info.isFile()) throw new CliUsageError(`attachment is not a file: ${filePath}`);
    if (info.size > maxFileSizeBytes) {
      throw new CliUsageError(
        `attachment exceeds ${maxFileSizeBytes} bytes: ${filePath} (${info.size} bytes)`,
      );
    }
    totalBytes += info.size;
    if (totalBytes > maxTotalSizeBytes) {
      throw new CliUsageError(`attachments exceed total limit of ${maxTotalSizeBytes} bytes`);
    }
    resolved.push(absolutePath);
  }
  const attachments = [];
  for (const absolutePath of resolved) {
    attachments.push({
      name: path.basename(absolutePath),
      mimeType: DEFAULT_MIME_TYPE,
      contentBase64: (await readFile(absolutePath)).toString("base64"),
    });
  }
  return attachments;
}
