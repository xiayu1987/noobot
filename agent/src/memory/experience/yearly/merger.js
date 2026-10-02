/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readMemoryDocumentBody } from "@noobot/memory-protocol/document";
import { EXPERIENCE_PATCH_SCHEMA } from "@noobot/memory-protocol/experience/schema";

export async function mergeDomainTextForMonths({ storage, basePath = "", monthKeys = [] } = {}) {
  const domainMap = new Map();
  for (const monthKey of Array.isArray(monthKeys) ? monthKeys : []) {
    const monthDir = path.join(storage.monthlySummaryDir(basePath), monthKey);
    const domainEntries = await storage.safeReadDirEntries(monthDir);
    for (const domainEntry of domainEntries) {
      if (!domainEntry.isDirectory()) continue;
      const domainName = String(domainEntry.name || "").trim();
      if (!domainName) continue;
      const domainDir = path.join(monthDir, domainName);
      const categoryEntries = await storage.safeReadDirEntries(domainDir);
      for (const categoryEntry of categoryEntries) {
        if (!categoryEntry.isDirectory()) continue;
        const categoryDir = path.join(domainDir, categoryEntry.name);
        const files = await storage.safeReadDirEntries(categoryDir);
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".md")) continue;
          const filePath = path.join(categoryDir, file.name);
          const content = readMemoryDocumentBody(
            EXPERIENCE_PATCH_SCHEMA.monthly.documentKind,
            await storage.readText(filePath, ""),
          );
          if (!content) continue;
          const previous = String(domainMap.get(domainName) || "");
          domainMap.set(domainName, `${previous}${previous ? "\n\n" : ""}${content}`);
        }
      }
    }
  }
  return domainMap;
}
