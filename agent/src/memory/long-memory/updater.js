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

export async function updateLongMemory(storage, basePath, { model, values }, patchText) {
  const nextValues = applyLongMemoryPatch(model, values, parseLongMemoryPatch(model, patchText));
  if (isSameLongMemory(values, nextValues)) return { changed: false };
  const longPath = storage.longPath(basePath);
  await storage.ensureDir(path.dirname(longPath));
  await storage.writeText(longPath, renderLongMemoryDocument(model, nextValues));
  return { changed: true };
}
