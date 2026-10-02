/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readMemoryDocumentBody } from "@noobot/memory-protocol/document";
import { EXPERIENCE_PATCH_SCHEMA } from "@noobot/memory-protocol/experience/schema";

export async function mergeDomainTextForWeeks({ storage, basePath = "", weekKeys = [] } = {}) {
  const domainMap = new Map();
  for (const weekKey of Array.isArray(weekKeys) ? weekKeys : []) {
    const weekDir = path.join(storage.weeklySummaryDir(basePath), weekKey);
    const domainEntries = await storage.safeReadDirEntries(weekDir);
    for (const domainEntry of domainEntries) {
      if (!domainEntry.isDirectory()) continue;
      const domainName = String(domainEntry.name || "").trim();
      if (!domainName) continue;
      const domainDir = path.join(weekDir, domainName);
      const categoryEntries = await storage.safeReadDirEntries(domainDir);
      for (const categoryEntry of categoryEntries) {
        if (!categoryEntry.isFile() || !categoryEntry.name.endsWith(".md")) continue;
        const filePath = path.join(domainDir, categoryEntry.name);
        const content = readMemoryDocumentBody(
          EXPERIENCE_PATCH_SCHEMA.weekly.documentKind,
          await storage.readText(filePath, ""),
        );
        if (!content) continue;
        const previous = String(domainMap.get(domainName) || "");
        domainMap.set(domainName, `${previous}${previous ? "\n\n" : ""}${content}`);
      }
    }
  }
  return domainMap;
}
