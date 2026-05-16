/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { sanitizeFileName } from "../../utils/text.js";
import { formatDomainBlock } from "../../utils/format.js";

export async function saveWeeklyDomainSummary({
  storage,
  basePath = "",
  weekLabel = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceDates = [],
} = {}) {
  const safeDomainName = sanitizeFileName(domainName, "");
  if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;
  const domainDir = path.join(storage.weeklySummaryDir(basePath), weekLabel, safeDomainName);
  await storage.ensureDir(domainDir);

  let writtenCount = 0;
  for (const category of categories) {
    const categoryName = sanitizeFileName(category?.category_name, "");
    if (!categoryName) continue;
    const filePath = path.join(domainDir, `${categoryName}.txt`);
    const block = [
      `时间：${createdAt || new Date().toISOString()}`,
      `来源日期：${(Array.isArray(sourceDates) ? sourceDates : []).join(", ")}`,
      "",
      formatDomainBlock({
        createdAt,
        experiences: category?.experiences,
        lessons: category?.lessons,
      }),
    ].join("\n");
    await storage.appendText(filePath, block);
    writtenCount += 1;
  }
  return writtenCount > 0;
}

