/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  LONG_MEMORY_ERROR_CODE,
  parseLongMemoryDocument,
  parseLongMemoryModel,
} from "@noobot/memory-protocol/long-memory";

export async function readLongMemoryState(storage, basePath) {
  const model = parseLongMemoryModel(
    await storage.readText(storage.longMemoryModelPath(basePath), ""),
  );
  const text = String((await storage.readText(storage.longPath(basePath), "")) ?? "");
  try {
    return { model, text, values: parseLongMemoryDocument(model, text), valid: true };
  } catch (error) {
    if (error?.code !== LONG_MEMORY_ERROR_CODE.DOCUMENT_INVALID) throw error;
    return { model, text, values: new Map(), valid: false };
  }
}
