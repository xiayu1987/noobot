/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { toDateKey } from "../../utils/date.js";
import { sanitizeFileName, dedupeTextList } from "@noobot/memory-protocol/text";
import { formatDomainBlock } from "../../utils/format.js";
import { buildExperiencePatchSchema } from "@noobot/memory-protocol/experience/schema";

export async function appendDailyDomainResults({
  storage,
  readMetadata,
  writeMetadata,
  basePath = "",
  results = [],
  createdAt = "",
  fields,
} = {}) {
  const normalizedResults = Array.isArray(results) ? results : [];
  if (!basePath || !normalizedResults.length) return false;
  const schema = buildExperiencePatchSchema("daily", fields);
  const dateKey = toDateKey(createdAt);
  const dayDir = storage.dailySummaryDateDir(basePath, dateKey);
  await storage.ensureDir(dayDir);

  let appendedCount = 0;
  const domainNames = [];
  for (const item of normalizedResults) {
    const domainName = sanitizeFileName(item?.domain, "");
    if (!domainName) continue;
    const filePath = path.join(dayDir, `${domainName}.md`);
    const block = formatDomainBlock({ createdAt, item, sections: schema.sections });
    await storage.appendMemoryDocument(schema.documentKind, filePath, block);
    appendedCount += 1;
    domainNames.push(domainName);
  }
  if (!appendedCount) return false;

  const metadata = await readMetadata(basePath);
  await storage.ensureDir(storage.experienceDir(basePath));
  metadata.domainNames = dedupeTextList([...metadata.domainNames, ...domainNames]);
  metadata.updatedAt = new Date().toISOString();
  await writeMetadata(basePath, metadata);
  return true;
}
