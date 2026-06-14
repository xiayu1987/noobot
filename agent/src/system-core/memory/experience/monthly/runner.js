/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { buildMonthlySummaryPrompt } from "../../prompts/builders.js";
import { isAbortLikeError, throwIfAborted } from "../abort-control.js";

function toMonthKey(weekKeys = []) {
  const firstWeek = String((Array.isArray(weekKeys) ? weekKeys[0] : "") || "").trim();
  const matched = firstWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!matched) return new Date().toISOString().slice(0, 7);
  const year = Number(matched[1]);
  const week = Number(matched[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 7);
}

export async function runMonthlySummaryIfNeeded({
  storage,
  llm = null,
  promptI18n = {},
  abortSignal = null,
  basePath = "",
  mergeDomainText,
  normalizeMonthlySummary,
  saveMonthlySummary,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || !llm) return false;
  let hasWrittenSummary = false;
  while (true) {
    const weekEntries = await storage.safeReadDirEntries(storage.weeklySummaryDir(basePath));
    const weekDirs = weekEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name || "").trim())
      .filter((key) => /^\d{4}-W\d{2}$/.test(key))
      .sort();
    if (weekDirs.length < 4) break;

    const targetWeeks = weekDirs.slice(0, 4);
    const monthKey = toMonthKey(targetWeeks);
    const mergedDomainMap = await mergeDomainText(basePath, targetWeeks);
    if (!mergedDomainMap.size) break;

    const savedDomains = [];
    for (const [domainName, mergedText] of mergedDomainMap.entries()) {
      throwIfAborted(abortSignal);
      const modelTree = await readExperienceModel(basePath);
      const knownDomainTree = modelTree?.[domainName] || {};
      const prompt = buildMonthlySummaryPrompt({
        promptI18n,
        domainName,
        knownTreeText: JSON.stringify(knownDomainTree, null, 2),
        mergedText,
      });
      let parsedSummary = { domain_name: domainName, categories: [] };
      try {
        const res = await llm.invoke(prompt, { signal: abortSignal });
        parsedSummary = normalizeMonthlySummary(res?.content, domainName, { basePath });
      } catch (error) {
        if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
        parsedSummary = { domain_name: domainName, categories: [] };
      }
      const saved = await saveMonthlySummary({
        basePath,
        monthKey,
        domainName: parsedSummary.domain_name || domainName,
        categories: parsedSummary.categories,
        createdAt: new Date().toISOString(),
        sourceWeeks: targetWeeks,
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
    for (const weekKey of targetWeeks) {
      await storage.removeDir(path.join(storage.weeklySummaryDir(basePath), weekKey));
    }
    hasWrittenSummary = true;
  }
  return hasWrittenSummary;
}

