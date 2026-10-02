/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  LONG_MEMORY_MODEL as model,
  parseLongMemoryDocument,
} from "@noobot/memory-protocol/long-memory";

export async function readLongMemoryState(storage, basePath) {
  const text = await storage.readText(storage.longPath(basePath), "");
  return { model, values: parseLongMemoryDocument(model, text) };
}
