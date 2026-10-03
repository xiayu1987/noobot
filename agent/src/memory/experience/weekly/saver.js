/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { sanitizeFileName } from "@noobot/memory-protocol/text";
import { formatDomainBlock } from "../../utils/format.js";
import { buildExperiencePatchSchema } from "@noobot/memory-protocol/experience/schema";

export async function saveWeeklyDomainSummary({
  storage,
  basePath = "",
  weekLabel = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceDates = [],
  fields,
} = {}) {
  const safeDomainName = sanitizeFileName(domainName, "");
  if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;
  const schema = buildExperiencePatchSchema("weekly", fields);
  const domainDir = path.join(storage.weeklySummaryDir(basePath), weekLabel, safeDomainName);
  await storage.ensureDir(domainDir);

  let writtenCount = 0;
  for (const category of categories) {
    const categoryName = sanitizeFileName(category?.category, "");
    if (!categoryName) continue;
    const filePath = path.join(domainDir, `${categoryName}.md`);
    const block = [
      `时间：${createdAt || new Date().toISOString()}`,
      `来源日期：${(Array.isArray(sourceDates) ? sourceDates : []).join(", ")}`,
      "",
      formatDomainBlock({ createdAt, item: category, sections: schema.sections }),
    ].join("\n");
    await storage.appendMemoryDocument(schema.documentKind, filePath, block);
    writtenCount += 1;
  }
  return writtenCount > 0;
}
