/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { buildMonthlySummaryPrompt } from "../../prompts/builders.js";
import { buildSubcategoryModelEntries } from "../model-entry-builder.js";
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
  invokeModel = null,
  promptI18n = {},
  abortSignal = null,
  basePath = "",
  listWeekDirs,
  mergeDomainText,
  normalizeMonthlySummary,
  saveMonthlySummary,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || typeof invokeModel !== "function") return false;
  let hasWrittenSummary = false;
  while (true) {
    const weekDirs = await listWeekDirs(basePath);
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
        const output = await invokeModel({
          prompt,
          flow: "memory.experience.monthly",
          purpose: "memory_experience_monthly",
        });
        parsedSummary = normalizeMonthlySummary(output.text, domainName, { basePath });
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
      const modelEntries = buildSubcategoryModelEntries(parsedSummary, domainName);
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
