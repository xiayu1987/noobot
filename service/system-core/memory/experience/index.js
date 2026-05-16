/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "../utils/text.js";
import { buildDailyExperiencePrompt } from "../prompts/builders.js";
import { appendParseErrorLog } from "../parsers/error-logger.js";
import { collectKnownDomainNames } from "./daily/collector.js";
import { parseDailyExperienceOutput } from "./daily/parser.js";
import { appendDailyDomainResults } from "./daily/appender.js";
import { normalizeWeeklySummaryOutput } from "./weekly/parser.js";
import { mergeDomainTextForDates } from "./weekly/merger.js";
import { saveWeeklyDomainSummary } from "./weekly/saver.js";
import { runWeeklySummaryIfNeeded } from "./weekly/runner.js";
import { isAbortLikeError } from "./workflow.js";

export class ExperienceManager {
  constructor(storage) {
    this.storage = storage;
  }

  async readMetadata(basePath) {
    const metadata = await this.storage.readJson(
      this.storage.experienceLessonsMetadataPath(basePath),
      {
        domainNames: [],
        weeklyBatches: [],
        updatedAt: "",
      },
    );
    return {
      domainNames: dedupeTextList(metadata?.domainNames),
      weeklyBatches: Array.isArray(metadata?.weeklyBatches) ? metadata.weeklyBatches : [],
      updatedAt: String(metadata?.updatedAt || "").trim(),
    };
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

  async listDateDirs(basePath = "") {
    const lessonsDir = this.storage.experienceLessonsDir(basePath);
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

  async collectKnownDomainNames(basePath = "") {
    const metadata = await this.readMetadata(basePath);
    return collectKnownDomainNames({
      storage: this.storage,
      metadata,
      listDateDirs: (bp) => this.listDateDirs(bp),
      basePath,
    });
  }

  async appendDailyDomainResults({ basePath = "", results = [], createdAt = "" } = {}) {
    return appendDailyDomainResults({
      storage: this.storage,
      readMetadata: (bp) => this.readMetadata(bp),
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
