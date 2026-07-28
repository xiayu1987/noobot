/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toTs } from "../utils/date.js";

export async function readShortMemory(storage, basePath) {
  return storage.readJson(storage.shortPath(basePath), {
    items: [],
    updatedAt: new Date().toISOString(),
  });
}

export function flattenShortItems(short = {}) {
  return Array.isArray(short?.items) ? short.items : [];
}

export function getSortedShortItems(short = {}) {
  return flattenShortItems(short).sort(
    (a, b) => toTs(a.createdAt) - toTs(b.createdAt),
  );
}

