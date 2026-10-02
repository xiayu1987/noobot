/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readMemoryDocumentBody } from "@noobot/memory-protocol/document";
import { EXPERIENCE_PATCH_SCHEMA } from "@noobot/memory-protocol/experience/schema";

export async function mergeDomainTextForDates({ storage, basePath = "", dateKeys = [] } = {}) {
  const domainMap = new Map();
  for (const dateKey of Array.isArray(dateKeys) ? dateKeys : []) {
    const dayDir = storage.dailySummaryDateDir(basePath, dateKey);
    const entries = await storage.safeReadDirEntries(dayDir);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const domainName = entry.name.replace(/\.md$/i, "");
      const filePath = path.join(dayDir, entry.name);
      const content = readMemoryDocumentBody(
        EXPERIENCE_PATCH_SCHEMA.daily.documentKind,
        await storage.readText(filePath, ""),
      );
      if (!content) continue;
      const previous = String(domainMap.get(domainName) || "");
      domainMap.set(domainName, `${previous}${previous ? "\n\n" : ""}${content}`);
    }
  }
  return domainMap;
}
