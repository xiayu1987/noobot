/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  LONG_MEMORY_MODEL,
  parseLongMemoryDocumentState,
  parseLongMemoryModelText,
} from "@noobot/memory-protocol/long-memory";

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  if (!(await storage.fileExists(modelPath))) {
    return { model: LONG_MEMORY_MODEL, modelError: null };
  }
  try {
    return {
      model: parseLongMemoryModelText(await storage.readText(modelPath, "")),
      modelError: null,
    };
  } catch (error) {
    return { model: LONG_MEMORY_MODEL, modelError: error };
  }
}

export async function readLongMemoryState(storage, basePath) {
  const { model, modelError } = await readLongMemoryModel(storage, basePath);
  const text = await storage.readText(storage.longPath(basePath), "");
  const { values, orphans } = parseLongMemoryDocumentState(model, text);
  return { model, modelError, values, orphans };
}
