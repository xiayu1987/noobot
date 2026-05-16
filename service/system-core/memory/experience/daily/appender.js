/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { toDateKey } from "../../utils/date.js";
import { sanitizeFileName, dedupeTextList } from "../../utils/text.js";
import { formatDomainBlock } from "../../utils/format.js";

export async function appendDailyDomainResults({
  storage,
  readMetadata,
  basePath = "",
  results = [],
  createdAt = "",
} = {}) {
  const normalizedResults = Array.isArray(results) ? results : [];
  if (!basePath || !normalizedResults.length) return false;
  const dateKey = toDateKey(createdAt);
  const dayDir = storage.experienceLessonsDailyDir(basePath, dateKey);
  await storage.ensureDir(dayDir);

  let appendedCount = 0;
  const domainNames = [];
  for (const item of normalizedResults) {
    const domainName = sanitizeFileName(item?.domain_name, "");
    if (!domainName) continue;
    const filePath = path.join(dayDir, `${domainName}.txt`);
    const block = formatDomainBlock({
      createdAt,
      experiences: item?.experiences,
      lessons: item?.lessons,
    });
    await storage.appendText(filePath, block);
    appendedCount += 1;
    domainNames.push(domainName);
  }
  if (!appendedCount) return false;

  const metadata = await readMetadata(basePath);
  metadata.domainNames = dedupeTextList([...metadata.domainNames, ...domainNames]);
  metadata.updatedAt = new Date().toISOString();
  await storage.writeJson(storage.experienceLessonsMetadataPath(basePath), metadata);
  return true;
}

