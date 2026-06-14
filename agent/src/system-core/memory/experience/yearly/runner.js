/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { buildYearlySummaryPrompt } from "../../prompts/builders.js";
import { isAbortLikeError, throwIfAborted } from "../abort-control.js";

export async function runYearlySummaryIfNeeded({
  storage,
  llm = null,
  promptI18n = {},
  abortSignal = null,
  basePath = "",
  mergeDomainText,
  normalizeYearlySummary,
  saveYearlySummary,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || !llm) return false;
  let hasWrittenSummary = false;
  while (true) {
    const monthEntries = await storage.safeReadDirEntries(storage.monthlySummaryDir(basePath));
    const monthDirs = monthEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name || "").trim())
      .filter((key) => /^\d{4}-\d{2}$/.test(key))
      .sort();
    if (monthDirs.length < 12) break;

    const targetMonths = monthDirs.slice(0, 12);
    const yearKey = String(targetMonths[0] || "").slice(0, 4) || new Date().toISOString().slice(0, 4);
    const mergedDomainMap = await mergeDomainText(basePath, targetMonths);
    if (!mergedDomainMap.size) break;

    const savedDomains = [];
    for (const [domainName, mergedText] of mergedDomainMap.entries()) {
      throwIfAborted(abortSignal);
      const modelTree = await readExperienceModel(basePath);
      const knownDomainTree = modelTree?.[domainName] || {};
      const prompt = buildYearlySummaryPrompt({
        promptI18n,
        domainName,
        knownTreeText: JSON.stringify(knownDomainTree, null, 2),
        mergedText,
      });
      let parsedSummary = { domain_name: domainName, categories: [] };
      try {
        const res = await llm.invoke(prompt, { signal: abortSignal });
        parsedSummary = normalizeYearlySummary(res?.content, domainName, { basePath });
      } catch (error) {
        if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
        parsedSummary = { domain_name: domainName, categories: [] };
      }
      const saved = await saveYearlySummary({
        basePath,
        yearKey,
        domainName: parsedSummary.domain_name || domainName,
        categories: parsedSummary.categories,
        createdAt: new Date().toISOString(),
        sourceMonths: targetMonths,
      });
      if (!saved) continue;
      const modelEntries = [];
      for (const category of Array.isArray(parsedSummary?.categories)
        ? parsedSummary.categories
        : []) {
        for (const subcategory of Array.isArray(category?.subcategories)
          ? category.subcategories
          : []) {
          modelEntries.push({
            domain_name: parsedSummary.domain_name || domainName,
            category_name: category?.category_name,
            subcategory_name: subcategory?.subcategory_name,
          });
        }
      }
      if (modelEntries.length) {
        await upsertModelEntries(basePath, modelEntries);
      }
      savedDomains.push(domainName);
    }
    if (savedDomains.length !== mergedDomainMap.size) break;
    for (const monthKey of targetMonths) {
      await storage.removeDir(path.join(storage.monthlySummaryDir(basePath), monthKey));
    }
    hasWrittenSummary = true;
  }
  return hasWrittenSummary;
}

