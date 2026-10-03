/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { buildYearlySummaryPrompt } from "../../prompts/builders.js";
import { buildSubcategoryModelEntries } from "../model-entry-builder.js";
import { assertNotAborted } from "../../../shared/utils/error-utils.js";

export async function runYearlySummaryIfNeeded({
  storage,
  invokeModel = null,
  promptI18n = {},
  fields,
  abortSignal = null,
  basePath = "",
  listMonthDirs,
  mergeDomainText,
  normalizeYearlySummary,
  saveYearlySummary,
  readExperienceModel,
  upsertModelEntries,
} = {}) {
  if (!basePath || typeof invokeModel !== "function") return false;
  let hasWrittenSummary = false;
  while (true) {
    const monthDirs = await listMonthDirs(basePath);
    if (monthDirs.length < 12) break;

    const targetMonths = monthDirs.slice(0, 12);
    const yearKey =
      String(targetMonths[0] || "").slice(0, 4) || new Date().toISOString().slice(0, 4);
    const mergedDomainMap = await mergeDomainText(basePath, targetMonths);
    if (!mergedDomainMap.size) break;

    const savedDomains = [];
    for (const [domainName, mergedText] of mergedDomainMap.entries()) {
      assertNotAborted(abortSignal);
      const modelTree = await readExperienceModel(basePath);
      const knownDomainTree = modelTree?.[domainName] || {};
      const prompt = buildYearlySummaryPrompt({
        promptI18n,
        fields,
        domainName,
        knownTreeText: JSON.stringify(knownDomainTree, null, 2),
        mergedText,
      });
      const output = await invokeModel({
        prompt,
        flow: "memory.experience.yearly",
        purpose: "memory_experience_yearly",
      });
      const parsedSummary = normalizeYearlySummary(output.text, domainName, { basePath });
      const saved = await saveYearlySummary({
        basePath,
        yearKey,
        domainName: parsedSummary.domain || domainName,
        categories: parsedSummary.categories,
        createdAt: new Date().toISOString(),
        sourceMonths: targetMonths,
      });
      if (!saved) continue;
      const modelEntries = buildSubcategoryModelEntries(parsedSummary, domainName);
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
