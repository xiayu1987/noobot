/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function assignShortItems(short = {}, items = []) {
  short.items = Array.isArray(items) ? items : [];
}

export async function writeShortMemory(storage, basePath, short = {}) {
  const payload = {
    items: Array.isArray(short?.items) ? short.items : [],
    updatedAt: new Date().toISOString(),
  };
  await storage.writeJson(storage.shortPath(basePath), payload);
}

