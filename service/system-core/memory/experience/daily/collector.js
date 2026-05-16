/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "../../utils/text.js";

export async function collectKnownDomainNames({
  storage,
  metadata,
  listDateDirs,
  basePath = "",
} = {}) {
  const names = [...(Array.isArray(metadata?.domainNames) ? metadata.domainNames : [])];
  const dateDirs = await listDateDirs(basePath);
  for (const dateKey of dateDirs) {
    const dayDir = storage.experienceLessonsDailyDir(basePath, dateKey);
    const entries = await storage.safeReadDirEntries(dayDir);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;
      names.push(entry.name.replace(/\.txt$/i, ""));
    }
  }
  return dedupeTextList(names);
}

