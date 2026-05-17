/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toIsoWeekInfo } from "../../utils/date.js";
import { buildWeeklySummaryPrompt } from "../../prompts/builders.js";
import { isAbortLikeError, throwIfAborted } from "../workflow.js";

export async function runWeeklySummaryIfNeeded({
  storage,
  llm = null,
  promptI18n = {},
  abortSignal = null,
  basePath = "",
  listDateDirs,
  mergeDomainText,
  normalizeWeeklySummary,
  saveWeeklySummary,
  readMetadata,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || !llm) return false;
  let hasWrittenSummary = false;
  while (true) {
    const dateDirs = await listDateDirs(basePath);
    if (dateDirs.length < 7) break;

    throwIfAborted(abortSignal);
    const targetDates = dateDirs.slice(0, 7);
    const weekInfo = toIsoWeekInfo(targetDates[targetDates.length - 1]);
    const weekLabel = weekInfo.weekKey || weekInfo.weekLabel;
    const mergedDomainMap = await mergeDomainText(basePath, targetDates);
    if (!mergedDomainMap.size) break;

    const savedDomains = [];
    for (const [domainName, mergedText] of mergedDomainMap.entries()) {
      throwIfAborted(abortSignal);
      const modelTree = await readExperienceModel(basePath);
      const knownCategoryText = Object.keys(modelTree?.[domainName] || {}).join(", ");
      const prompt = buildWeeklySummaryPrompt({
        promptI18n,
        domainName,
        knownCategoryText,
        mergedText,
      });
      let parsedSummary = { domain_name: domainName, categories: [] };
      try {
        const res = await llm.invoke(prompt, { signal: abortSignal });
        parsedSummary = normalizeWeeklySummary(res?.content, domainName, { basePath });
      } catch (error) {
        if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
        parsedSummary = { domain_name: domainName, categories: [] };
      }
      const saved = await saveWeeklySummary({
        basePath,
        weekLabel,
        domainName: parsedSummary.domain_name || domainName,
        categories: parsedSummary.categories,
        createdAt: new Date().toISOString(),
        sourceDates: targetDates,
      });
      if (!saved) continue;
      const modelEntries = (Array.isArray(parsedSummary?.categories)
        ? parsedSummary.categories
        : []
      ).map((item) => ({
        domain_name: parsedSummary.domain_name || domainName,
        category_name: item?.category_name,
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
    await storage.writeJson(storage.summaryPipelineMetadataPath(basePath), metadata);
    hasWrittenSummary = true;
  }
  return hasWrittenSummary;
}
