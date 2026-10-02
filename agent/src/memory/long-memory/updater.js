/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  applyLongMemoryPatch,
  isSameLongMemory,
  parseLongMemoryPatch,
  renderLongMemoryDocument,
} from "@noobot/memory-protocol/long-memory";

function backupFilePath(longPath, now) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(path.dirname(longPath), `long-memory.backup-${stamp}.md`);
}

export async function updateLongMemory(
  storage,
  basePath,
  { model, text, values, valid },
  patchText,
  { now = new Date() } = {},
) {
  const nextValues = applyLongMemoryPatch(model, values, parseLongMemoryPatch(model, patchText));
  if (valid && isSameLongMemory(values, nextValues)) return { changed: false, backupPath: "" };
  const longPath = storage.longPath(basePath);
  await storage.ensureDir(path.dirname(longPath));
  const backupPath = valid ? "" : backupFilePath(longPath, now);
  if (backupPath) await storage.writeText(backupPath, text);
  await storage.writeText(longPath, renderLongMemoryDocument(model, nextValues));
  return { changed: !isSameLongMemory(values, nextValues), backupPath };
}
