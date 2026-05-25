/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "../utils/text.js";
import { buildDailyExperiencePrompt } from "../prompts/builders.js";
import { appendParseErrorLog } from "../parsers/error-logger.js";
import { parseDailyExperienceOutput } from "./daily/parser.js";
import { appendDailyDomainResults } from "./daily/appender.js";
import { normalizeWeeklySummaryOutput } from "./weekly/parser.js";
import { mergeDomainTextForDates } from "./weekly/merger.js";
import { saveWeeklyDomainSummary } from "./weekly/saver.js";
import { runWeeklySummaryIfNeeded } from "./weekly/runner.js";
import { normalizeMonthlySummaryOutput } from "./monthly/parser.js";
import { mergeDomainTextForWeeks } from "./monthly/merger.js";
import { saveMonthlyDomainSummary } from "./monthly/saver.js";
import { runMonthlySummaryIfNeeded } from "./monthly/runner.js";
import { normalizeYearlySummaryOutput } from "./yearly/parser.js";
import { mergeDomainTextForMonths } from "./yearly/merger.js";
import { saveYearlyDomainSummary } from "./yearly/saver.js";
import { runYearlySummaryIfNeeded } from "./yearly/runner.js";
import {
  readExperienceModel as readExperienceModelFile,
  writeExperienceModel as writeExperienceModelFile,
  upsertExperienceModelEntries as upsertExperienceModelEntriesInMemory,
} from "./model/index.js";
import { isAbortLikeError } from "./workflow.js";
import {
  normalizeExperienceMetadata,
  parseExperienceMetadataText,
  renderExperienceMetadataText,
} from "./metadata-store.js";

export class ExperienceManager {
  constructor(storage) {
    this.storage = storage;
  }

  async readMetadata(basePath) {
    const metadataPath = this.storage.experienceMetadataPath(basePath);
    const text = String(await this.storage.readText(metadataPath, "") || "").trim();
    if (text) return parseExperienceMetadataText(text);
    const legacyJsonPath = metadataPath.replace(/\.md$/i, ".json");
    const legacyJson = await this.storage.readJson(legacyJsonPath, null);
    return normalizeExperienceMetadata(legacyJson);
  }

  async writeMetadata(basePath, metadata = null) {
    const metadataPath = this.storage.experienceMetadataPath(basePath);
    await this.storage.ensureDir(this.storage.experienceDir(basePath));
    await this.storage.writeText(
      metadataPath,
      renderExperienceMetadataText(metadata),
    );
  }

  async appendParseErrorLog({
    basePath = "",
    stage = "",
    rawContent = "",
    candidate = "",
    error = "",
  } = {}) {
    await appendParseErrorLog({
      storage: this.storage,
      basePath,
      stage,
      rawContent,
      candidate,
      error,
    });
  }

  parseDaily(rawContent, { basePath = "" } = {}) {
    return parseDailyExperienceOutput(rawContent, {
      onParseError: (payload) => void this.appendParseErrorLog({ basePath, ...payload }),
    });
  }

  normalizeWeekly(rawContent, fallbackDomainName = "", { basePath = "" } = {}) {
    return normalizeWeeklySummaryOutput(rawContent, fallbackDomainName, {
      onParseError: (payload) => void this.appendParseErrorLog({ basePath, ...payload }),
    });
  }

  normalizeMonthly(rawContent, fallbackDomainName = "", { basePath = "" } = {}) {
    return normalizeMonthlySummaryOutput(rawContent, fallbackDomainName, {
      onParseError: (payload) => void this.appendParseErrorLog({ basePath, ...payload }),
    });
  }

  normalizeYearly(rawContent, fallbackDomainName = "", { basePath = "" } = {}) {
    return normalizeYearlySummaryOutput(rawContent, fallbackDomainName, {
      onParseError: (payload) => void this.appendParseErrorLog({ basePath, ...payload }),
    });
  }

  async listDateDirs(basePath = "") {
    const lessonsDir = this.storage.dailySummaryDir(basePath);
    const entries = await this.storage.safeReadDirEntries(lessonsDir);
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(entry.name || "").trim()),
      )
      .map((entry) => entry.name)
      .sort();
  }

  async listWeekDirs(basePath = "") {
    const weeklyDir = this.storage.weeklySummaryDir(basePath);
    const entries = await this.storage.safeReadDirEntries(weeklyDir);
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-W\d{2}$/.test(entry.name || ""))
      .map((entry) => entry.name)
      .sort();
  }

  async listMonthDirs(basePath = "") {
    const monthlyDir = this.storage.monthlySummaryDir(basePath);
    const entries = await this.storage.safeReadDirEntries(monthlyDir);
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name || ""))
      .map((entry) => entry.name)
      .sort();
  }

  async readExperienceModel(basePath = "") {
    return readExperienceModelFile(this.storage, basePath);
  }

  async upsertExperienceModelEntries(basePath = "", entries = []) {
    const model = await this.readExperienceModel(basePath);
    const { changed, model: nextModel } = upsertExperienceModelEntriesInMemory(model, entries);
    if (!changed) return false;
    return writeExperienceModelFile(this.storage, basePath, nextModel);
  }

  async collectKnownDomainNames(basePath = "") {
    const model = await this.readExperienceModel(basePath);
    const modelDomains = Object.keys(model || {});
    const metadata = await this.readMetadata(basePath);
    return dedupeTextList([...modelDomains, ...(metadata?.domainNames || [])]);
  }

  async appendDailyDomainResults({ basePath = "", results = [], createdAt = "" } = {}) {
    return appendDailyDomainResults({
      storage: this.storage,
      readMetadata: (bp) => this.readMetadata(bp),
      writeMetadata: (bp, metadata) => this.writeMetadata(bp, metadata),
      basePath,
      results,
      createdAt,
    });
  }

  async mergeDomainTextForDates(basePath = "", dateKeys = []) {
    return mergeDomainTextForDates({
      storage: this.storage,
      basePath,
      dateKeys,
    });
  }

  async saveWeeklyDomainSummary(params = {}) {
    return saveWeeklyDomainSummary({
      storage: this.storage,
      ...params,
    });
  }

  async runWeeklySummaryIfNeeded({
    basePath = "",
    llm = null,
    promptI18n = {},
    abortSignal = null,
  } = {}) {
    return runWeeklySummaryIfNeeded({
      storage: this.storage,
      llm,
      promptI18n,
      abortSignal,
      basePath,
      listDateDirs: (bp) => this.listDateDirs(bp),
      mergeDomainText: (bp, dateKeys) => this.mergeDomainTextForDates(bp, dateKeys),
      normalizeWeeklySummary: (raw, fallback, options) =>
        this.normalizeWeekly(raw, fallback, options),
      saveWeeklySummary: (params) => this.saveWeeklyDomainSummary(params),
      readMetadata: (bp) => this.readMetadata(bp),
      writeMetadata: (bp, metadata) => this.writeMetadata(bp, metadata),
      readExperienceModel: (bp) => this.readExperienceModel(bp),
      upsertModelEntries: (bp, entries) => this.upsertExperienceModelEntries(bp, entries),
    });
  }

  async mergeDomainTextForWeeks(basePath = "", weekKeys = []) {
    return mergeDomainTextForWeeks({
      storage: this.storage,
      basePath,
      weekKeys,
    });
  }

  async saveMonthlyDomainSummary(params = {}) {
    return saveMonthlyDomainSummary({
      storage: this.storage,
      ...params,
    });
  }

  async runMonthlySummaryIfNeeded({
    basePath = "",
    llm = null,
    promptI18n = {},
    abortSignal = null,
  } = {}) {
    return runMonthlySummaryIfNeeded({
      storage: this.storage,
      llm,
      promptI18n,
      abortSignal,
      basePath,
      mergeDomainText: (bp, weekKeys) => this.mergeDomainTextForWeeks(bp, weekKeys),
      normalizeMonthlySummary: (raw, fallback, options) =>
        this.normalizeMonthly(raw, fallback, options),
      saveMonthlySummary: (params) => this.saveMonthlyDomainSummary(params),
      readExperienceModel: (bp) => this.readExperienceModel(bp),
      upsertModelEntries: (bp, entries) => this.upsertExperienceModelEntries(bp, entries),
    });
  }

  async mergeDomainTextForMonths(basePath = "", monthKeys = []) {
    return mergeDomainTextForMonths({
      storage: this.storage,
      basePath,
      monthKeys,
    });
  }

  async saveYearlyDomainSummary(params = {}) {
    return saveYearlyDomainSummary({
      storage: this.storage,
      ...params,
    });
  }

  async runYearlySummaryIfNeeded({
    basePath = "",
    llm = null,
    promptI18n = {},
    abortSignal = null,
  } = {}) {
    return runYearlySummaryIfNeeded({
      storage: this.storage,
      llm,
      promptI18n,
      abortSignal,
      basePath,
      mergeDomainText: (bp, monthKeys) => this.mergeDomainTextForMonths(bp, monthKeys),
      normalizeYearlySummary: (raw, fallback, options) =>
        this.normalizeYearly(raw, fallback, options),
      saveYearlySummary: (params) => this.saveYearlyDomainSummary(params),
      readExperienceModel: (bp) => this.readExperienceModel(bp),
      upsertModelEntries: (bp, entries) => this.upsertExperienceModelEntries(bp, entries),
    });
  }

  async runDaily({
    basePath = "",
    llm = null,
    promptI18n = {},
    promptPayload = [],
    createdAt = "",
    abortSignal = null,
  } = {}) {
    if (!llm) return false;
    try {
      const knownDomainNames = await this.collectKnownDomainNames(basePath);
      const lessonPrompt = buildDailyExperiencePrompt({
        promptI18n,
        knownDomainText: dedupeTextList(knownDomainNames).join(", "),
        shortMemoryItems: promptPayload,
      });
      const lessonRes = await llm.invoke(lessonPrompt, { signal: abortSignal });
      const normalizedResults = this.parseDaily(lessonRes?.content, { basePath });
      const modelEntries = normalizedResults.map((item) => ({
        domain_name: item?.domain_name,
      }));
      if (modelEntries.length) {
        await this.upsertExperienceModelEntries(basePath, modelEntries);
      }
      return this.appendDailyDomainResults({
        basePath,
        results: normalizedResults,
        createdAt,
      });
    } catch (error) {
      if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
      return false;
    }
  }
}
