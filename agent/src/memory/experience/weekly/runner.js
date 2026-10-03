/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toIsoWeekInfo } from "../../utils/date.js";
import { buildWeeklySummaryPrompt } from "../../prompts/builders.js";
import { assertNotAborted } from "../../../shared/utils/error-utils.js";

export async function runWeeklySummaryIfNeeded({
  storage,
  invokeModel = null,
  promptI18n = {},
  fields,
  abortSignal = null,
  basePath = "",
  listDateDirs,
  mergeDomainText,
  normalizeWeeklySummary,
  saveWeeklySummary,
  readMetadata,
  writeMetadata,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || typeof invokeModel !== "function") return false;
  let hasWrittenSummary = false;
  while (true) {
    const dateDirs = await listDateDirs(basePath);
    if (dateDirs.length < 7) break;

    assertNotAborted(abortSignal);
    const targetDates = dateDirs.slice(0, 7);
    const weekInfo = toIsoWeekInfo(targetDates[targetDates.length - 1]);
    const weekLabel = weekInfo.weekKey || weekInfo.weekLabel;
    const mergedDomainMap = await mergeDomainText(basePath, targetDates);
    if (!mergedDomainMap.size) break;

    const savedDomains = [];
    for (const [domainName, mergedText] of mergedDomainMap.entries()) {
      assertNotAborted(abortSignal);
      const modelTree = await readExperienceModel(basePath);
      const knownCategoryText = Object.keys(modelTree?.[domainName] || {}).join(", ");
      const prompt = buildWeeklySummaryPrompt({
        promptI18n,
        fields,
        domainName,
        knownCategoryText,
        mergedText,
      });
      const output = await invokeModel({
        prompt,
        flow: "memory.experience.weekly",
        purpose: "memory_experience_weekly",
      });
      const parsedSummary = normalizeWeeklySummary(output.text, domainName, { basePath });
      const saved = await saveWeeklySummary({
        basePath,
        weekLabel,
        domainName: parsedSummary.domain || domainName,
        categories: parsedSummary.categories,
        createdAt: new Date().toISOString(),
        sourceDates: targetDates,
      });
      if (!saved) continue;
      const modelEntries = (
        Array.isArray(parsedSummary?.categories) ? parsedSummary.categories : []
      ).map((item) => ({
        domain: parsedSummary.domain || domainName,
        category: item?.category,
      }));
      if (modelEntries.length) {
        await upsertModelEntries(basePath, modelEntries);
      }
      savedDomains.push(domainName);
    }
    if (savedDomains.length !== mergedDomainMap.size) break;

    for (const dateKey of targetDates) {
      await storage.removeDir(storage.dailySummaryDateDir(basePath, dateKey));
    }
    const metadata = await readMetadata(basePath);
    metadata.weeklyBatches.push({
      weekLabel,
      dates: targetDates,
      domainCount: savedDomains.length,
      createdAt: new Date().toISOString(),
    });
    metadata.updatedAt = new Date().toISOString();
    await writeMetadata(basePath, metadata);
    hasWrittenSummary = true;
  }
  return hasWrittenSummary;
}
