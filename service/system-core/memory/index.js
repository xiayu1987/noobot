/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createChatModelByName, resolveDefaultModelSpec } from "../model/index.js";
import { mergeConfig } from "../config/index.js";
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import { normalizeLocale } from "../i18n/index.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptI18n } from "../i18n/locales/zh-CN/system-prompt.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptI18n } from "../i18n/locales/en-US/system-prompt.js";

const MEMORY_PROMPT_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhSystemPromptI18n?.memoryPrompt || {}),
  "en-US": Object.freeze(enSystemPromptI18n?.memoryPrompt || {}),
});

function isAbortLikeError(error = {}) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return name.includes("abort") || message.includes("abort");
}

function throwIfAborted(abortSignal = null) {
  if (!abortSignal?.aborted) return;
  const abortError = new Error("memory summarize aborted");
  abortError.name = "AbortError";
  throw abortError;
}

function resolveMemoryPromptI18n(locale = "zh-CN") {
  const normalizedLocale = normalizeLocale(locale, "zh-CN");
  return normalizedLocale === "en-US"
    ? MEMORY_PROMPT_I18N["en-US"]
    : MEMORY_PROMPT_I18N["zh-CN"];
}

export class MemoryService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: "FATAL_WORKSPACE_PATH_INVALID",
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  _shortPath(basePath) {
    return path.join(basePath, "memory/short-memory.json");
  }

  _longPath(basePath) {
    return path.join(basePath, "memory/long-memory.json");
  }

  _experienceLessonsDir(basePath) {
    return path.join(basePath, "memory/experience-lessons");
  }

  _experienceLessonsMetadataPath(basePath) {
    return path.join(this._experienceLessonsDir(basePath), "metadata.json");
  }

  _weeklySummaryDir(basePath) {
    return path.join(basePath, "memory/Weekly_Summary");
  }

  _experienceLessonsDailyDir(basePath, dateKey = "") {
    return path.join(this._experienceLessonsDir(basePath), dateKey);
  }

  _sanitizeFileName(input = "", fallback = "untitled") {
    const cleaned = String(input || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ");
    return cleaned || fallback;
  }

  _dedupeTextList(items = []) {
    return Array.from(
      new Set(
        (Array.isArray(items) ? items : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    );
  }

  _toIsoWeekInfo(value = "") {
    const dateObj = new Date(value || Date.now());
    if (Number.isNaN(dateObj.getTime())) {
      return { weekYear: 1970, weekNumber: 1, weekLabel: "1970-第1周" };
    }
    const utcDate = new Date(
      Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()),
    );
    const day = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
    const weekYear = utcDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
    return {
      weekYear,
      weekNumber,
      weekLabel: `${weekYear}-第${weekNumber}周`,
    };
  }

  _formatDomainBlock({
    createdAt = "",
    experiences = [],
    lessons = [],
  } = {}) {
    const normalizedExperiences = this._dedupeTextList(experiences);
    const normalizedLessons = this._dedupeTextList(lessons);
    const expLines = normalizedExperiences.length
      ? normalizedExperiences.map((item) => `- ${item}`).join("\n")
      : "- （无）";
    const lessonLines = normalizedLessons.length
      ? normalizedLessons.map((item) => `- ${item}`).join("\n")
      : "- （无）";
    return [
      `[${createdAt || new Date().toISOString()}]`,
      "经验：",
      expLines,
      "教训：",
      lessonLines,
      "",
    ].join("\n");
  }

  _sessionFile(basePath, sessionId, parentSessionId = "") {
    return parentSessionId
      ? path.join(
          basePath,
          "runtime/session",
          parentSessionId,
          sessionId,
          "session.json",
        )
      : path.join(basePath, "runtime/session", sessionId, "session.json");
  }

  _longMemoryModelPath(basePath) {
    return path.join(basePath, "memory/long-memory-model.md");
  }

  async _readLongMemoryModel(basePath) {
    const modelPath = this._longMemoryModelPath(basePath);
    try {
      await access(modelPath);
      return (await readFile(modelPath, "utf8")).trim();
    } catch {
      return "";
    }
  }

  async _readJson(p, fallback = {}) {
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async _readShortMemory(basePath) {
    return this._readJson(this._shortPath(basePath), {
      items: [],
      updatedAt: new Date().toISOString(),
    });
  }

  async _writeShortMemory(basePath, short) {
    const payload = {
      items: Array.isArray(short?.items) ? short.items : [],
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this._shortPath(basePath), JSON.stringify(payload, null, 2));
  }

  _toTs(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  _flattenShortItems(short = {}) {
    return Array.isArray(short?.items) ? short.items : [];
  }

  _normalizeModelContent(rawContent) {
    if (rawContent === undefined) return "";
    if (typeof rawContent === "string") return rawContent;
    try {
      return JSON.parse(JSON.stringify(rawContent));
    } catch {
      return String(rawContent ?? "");
    }
  }

  _stripMarkdownFence(input = "") {
    const text = String(input || "").trim();
    const matched = /^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/.exec(text);
    return matched ? String(matched[1] || "").trim() : text;
  }

  _isBlankLongMemoryContent(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    const normalized = this._stripMarkdownFence(value).trim();
    if (!normalized) return true;
    return ["null", "undefined", "{}", "[]"].includes(normalized.toLowerCase());
  }

  _sanitizeDialogRecordsForMemory(messages = []) {
    const out = [];
    for (const messageItem of messages) {
      const role = String(messageItem?.role || "").trim();
      const type = String(messageItem?.type || "").trim();
      if (!["user", "assistant"].includes(role)) continue;
      if (role === "assistant" && type === "tool_call") continue;
      const content = String(messageItem?.content || "").trim();
      if (!content) continue;
      // 只保留长期记忆提炼需要的最小字段，避免记录额外噪音
      out.push({
        role,
        content,
      });
    }
    return out;
  }

  _assignShortItems(short, items = []) {
    short.items = Array.isArray(items) ? items : [];
  }

  _compactShortMemory(short) {
    const pending = this._flattenShortItems(short).sort(
      (a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt),
    );
    this._assignShortItems(short, pending);
  }

  _toDateKey(value = "") {
    const dateObj = new Date(value || Date.now());
    if (Number.isNaN(dateObj.getTime())) return new Date().toISOString().slice(0, 10);
    return dateObj.toISOString().slice(0, 10);
  }

  async _readExperienceLessonsMetadata(basePath) {
    const metadata = await this._readJson(this._experienceLessonsMetadataPath(basePath), {
      domainNames: [],
      weeklyBatches: [],
      updatedAt: "",
    });
    return {
      domainNames: this._dedupeTextList(metadata?.domainNames),
      weeklyBatches: Array.isArray(metadata?.weeklyBatches) ? metadata.weeklyBatches : [],
      updatedAt: String(metadata?.updatedAt || "").trim(),
    };
  }

  _extractJsonCandidate(input = "") {
    const text = this._stripMarkdownFence(input)
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    if (!text) return "";
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    const startIndex =
      firstBrace < 0
        ? firstBracket
        : firstBracket < 0
          ? firstBrace
          : Math.min(firstBrace, firstBracket);
    if (startIndex < 0) return text;
    const startChar = text[startIndex];
    const endChar = startChar === "[" ? "]" : "}";
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === startChar) depth += 1;
      if (ch === endChar) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(startIndex, i + 1).trim();
        }
      }
    }
    return text.slice(startIndex).trim();
  }

  async _appendParseErrorLog({
    basePath = "",
    stage = "",
    rawContent = "",
    candidate = "",
    error = "",
  } = {}) {
    try {
      if (!basePath) return;
      const lessonsDir = this._experienceLessonsDir(basePath);
      await mkdir(lessonsDir, { recursive: true });
      const logPath = path.join(lessonsDir, "_parse-error.log");
      const rawText =
        typeof rawContent === "string"
          ? rawContent
          : JSON.stringify(rawContent ?? "", null, 2);
      const block = [
        `[${new Date().toISOString()}] stage=${String(stage || "").trim() || "unknown"}`,
        `error=${String(error || "").trim() || "unknown_parse_error"}`,
        `candidate=${String(candidate || "").slice(0, 2000)}`,
        "raw:",
        String(rawText || "").slice(0, 20000),
        "---",
        "",
      ].join("\n");
      await appendFile(logPath, block, "utf8");
    } catch {
      // 调试日志写入失败不影响主流程
    }
  }

  _normalizeDailyDomainResultItems(rawItems = []) {
    const out = [];
    for (const item of Array.isArray(rawItems) ? rawItems : []) {
      const domainName = this._sanitizeFileName(item?.domain_name, "");
      if (!domainName) continue;
      out.push({
        domain_name: domainName,
        is_new_domain: Boolean(item?.is_new_domain),
        experiences: this._dedupeTextList(item?.experiences),
        lessons: this._dedupeTextList(item?.lessons),
      });
    }
    return out;
  }

  _parseDailyExperienceOutput(rawContent, { basePath = "" } = {}) {
    const content = this._normalizeModelContent(rawContent);
    const text = typeof content === "string" ? content : String(content || "");
    const candidate = this._extractJsonCandidate(text);
    if (!candidate) {
      if (text.trim()) {
        void this._appendParseErrorLog({
          basePath,
          stage: "daily_experience",
          rawContent: text,
          candidate,
          error: "json_candidate_not_found",
        });
      }
      return [];
    }
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed?.results) ? parsed.results : [];
      return this._normalizeDailyDomainResultItems(items);
    } catch (error) {
      void this._appendParseErrorLog({
        basePath,
        stage: "daily_experience",
        rawContent: text,
        candidate,
        error: error?.message || "json_parse_failed",
      });
      return [];
    }
  }

  _normalizeWeeklySummaryOutput(rawContent, fallbackDomainName = "", { basePath = "" } = {}) {
    const content = this._normalizeModelContent(rawContent);
    const text = typeof content === "string" ? content : String(content || "");
    const candidate = this._extractJsonCandidate(text);
    if (!candidate) {
      if (text.trim()) {
        void this._appendParseErrorLog({
          basePath,
          stage: `weekly_summary:${fallbackDomainName}`,
          rawContent: text,
          candidate,
          error: "json_candidate_not_found",
        });
      }
      return { domain_name: fallbackDomainName, categories: [] };
    }
    try {
      const parsed = JSON.parse(candidate);
      const domainName = this._sanitizeFileName(
        parsed?.domain_name || fallbackDomainName,
        fallbackDomainName,
      );
      const categories = [];
      for (const item of Array.isArray(parsed?.categories) ? parsed.categories : []) {
        const categoryName = this._sanitizeFileName(item?.category_name, "");
        if (!categoryName) continue;
        categories.push({
          category_name: categoryName,
          experiences: this._dedupeTextList(item?.experiences),
          lessons: this._dedupeTextList(item?.lessons),
        });
      }
      return { domain_name: domainName, categories };
    } catch (error) {
      void this._appendParseErrorLog({
        basePath,
        stage: `weekly_summary:${fallbackDomainName}`,
        rawContent: text,
        candidate,
        error: error?.message || "json_parse_failed",
      });
      return { domain_name: fallbackDomainName, categories: [] };
    }
  }

  _buildDailyExperiencePrompt({
    promptI18n = {},
    knownDomains = [],
    shortMemoryItems = [],
  } = {}) {
    const knownDomainText = this._dedupeTextList(knownDomains).join(", ");
    const builder = promptI18n?.dailyExperiencePrompt;
    if (typeof builder === "function") {
      const prompt = String(
        builder({
          knownDomainText,
          shortMemoryItems,
        }) || "",
      ).trim();
      if (prompt) return prompt;
    }
    return [
      "【系统指令】",
      "分析以下短期记忆，将其归入已知领域或创建新领域。",
      `已知领域列表：${knownDomainText || "无"}`,
      "",
      "【任务要求】",
      "1. 提取每个涉及领域的经验和教训（各1-3条，宁缺毋滥，无则留空）。",
      "2. 仅输出严格的JSON，不要任何Markdown标记或解释。格式如下：",
      '{"results":[{"domain_name":"领域名","is_new_domain":true,"experiences":["经验1"],"lessons":["教训1"]}]}',
      "",
      "【输入内容】",
      JSON.stringify(shortMemoryItems, null, 2),
    ].join("\n");
  }

  _buildWeeklySummaryPrompt({
    promptI18n = {},
    domainName = "",
    mergedText = "",
  } = {}) {
    const builder = promptI18n?.weeklySummaryPrompt;
    if (typeof builder === "function") {
      const prompt = String(
        builder({
          domainName,
          mergedText,
        }) || "",
      ).trim();
      if (prompt) return prompt;
    }
    return [
      "【系统指令】",
      `对以下【${domainName}】领域过去7天的记录进行体系化总结。`,
      "",
      "【任务要求】",
      "1. 划分大类：根据内容相关性划分子类别（如：性能优化、架构设计）。",
      "2. 提炼总结：合并重复项，提取每个大类最核心的经验与教训（各1-3条）。",
      "3. 仅输出严格的JSON，不要任何Markdown标记或解释。格式如下：",
      '{"domain_name":"当前领域名","categories":[{"category_name":"大类名","experiences":["经验1"],"lessons":["教训1"]}]}',
      "",
      "【输入内容】",
      mergedText,
    ].join("\n");
  }

  async _collectKnownDomainNames(basePath = "") {
    const metadata = await this._readExperienceLessonsMetadata(basePath);
    const names = [...metadata.domainNames];
    const dateDirs = await this._listExperienceLessonDateDirs(basePath);
    for (const dateKey of dateDirs) {
      const dayDir = this._experienceLessonsDailyDir(basePath, dateKey);
      const entries = await readdir(dayDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;
        names.push(entry.name.replace(/\.txt$/i, ""));
      }
    }
    return this._dedupeTextList(names);
  }

  async _appendDailyDomainResults({
    basePath = "",
    results = [],
    createdAt = "",
  } = {}) {
    const normalizedResults = Array.isArray(results) ? results : [];
    if (!basePath || !normalizedResults.length) return false;
    const dateKey = this._toDateKey(createdAt);
    const dayDir = this._experienceLessonsDailyDir(basePath, dateKey);
    await mkdir(dayDir, { recursive: true });

    let appendedCount = 0;
    const domainNames = [];
    for (const item of normalizedResults) {
      const domainName = this._sanitizeFileName(item?.domain_name, "");
      if (!domainName) continue;
      const filePath = path.join(dayDir, `${domainName}.txt`);
      const block = this._formatDomainBlock({
        createdAt,
        experiences: item?.experiences,
        lessons: item?.lessons,
      });
      await appendFile(filePath, block, "utf8");
      appendedCount += 1;
      domainNames.push(domainName);
    }
    if (!appendedCount) return false;

    const metadata = await this._readExperienceLessonsMetadata(basePath);
    metadata.domainNames = this._dedupeTextList([...metadata.domainNames, ...domainNames]);
    metadata.updatedAt = new Date().toISOString();
    await writeFile(this._experienceLessonsMetadataPath(basePath), JSON.stringify(metadata, null, 2));
    return true;
  }

  async _listExperienceLessonDateDirs(basePath = "") {
    const lessonsDir = this._experienceLessonsDir(basePath);
    try {
      const entries = await readdir(lessonsDir, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(entry.name || "").trim()),
        )
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  async _mergeDomainTextForDates(basePath = "", dateKeys = []) {
    const domainMap = new Map();
    for (const dateKey of Array.isArray(dateKeys) ? dateKeys : []) {
      const dayDir = this._experienceLessonsDailyDir(basePath, dateKey);
      const entries = await readdir(dayDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;
        const domainName = entry.name.replace(/\.txt$/i, "");
        const filePath = path.join(dayDir, entry.name);
        const content = String(await readFile(filePath, "utf8") || "").trim();
        if (!content) continue;
        const previous = String(domainMap.get(domainName) || "");
        domainMap.set(domainName, `${previous}${previous ? "\n\n" : ""}${content}`);
      }
    }
    return domainMap;
  }

  async _saveWeeklyDomainSummary({
    basePath = "",
    weekLabel = "",
    domainName = "",
    categories = [],
    createdAt = "",
    sourceDates = [],
  } = {}) {
    const safeDomainName = this._sanitizeFileName(domainName, "");
    if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;
    const domainDir = path.join(
      this._weeklySummaryDir(basePath),
      weekLabel,
      safeDomainName,
    );
    await mkdir(domainDir, { recursive: true });
    let writtenCount = 0;
    for (const category of categories) {
      const categoryName = this._sanitizeFileName(category?.category_name, "");
      if (!categoryName) continue;
      const filePath = path.join(domainDir, `${categoryName}.txt`);
      const block = [
        `时间：${createdAt || new Date().toISOString()}`,
        `来源日期：${(Array.isArray(sourceDates) ? sourceDates : []).join(", ")}`,
        "",
        this._formatDomainBlock({
          createdAt,
          experiences: category?.experiences,
          lessons: category?.lessons,
        }),
      ].join("\n");
      await appendFile(filePath, block, "utf8");
      writtenCount += 1;
    }
    return writtenCount > 0;
  }

  async _runWeeklySummaryIfNeeded({
    basePath = "",
    llm = null,
    promptI18n = {},
    abortSignal = null,
  } = {}) {
    if (!basePath || !llm) return false;
    let hasWrittenSummary = false;
    while (true) {
      const dateDirs = await this._listExperienceLessonDateDirs(basePath);
      if (dateDirs.length < 7) break;

      throwIfAborted(abortSignal);
      const targetDates = dateDirs.slice(0, 7);
      const weekInfo = this._toIsoWeekInfo(targetDates[targetDates.length - 1]);
      const weekLabel = weekInfo.weekLabel;
      const mergedDomainMap = await this._mergeDomainTextForDates(basePath, targetDates);
      if (!mergedDomainMap.size) break;

      const savedDomains = [];
      for (const [domainName, mergedText] of mergedDomainMap.entries()) {
        throwIfAborted(abortSignal);
        const prompt = this._buildWeeklySummaryPrompt({
          promptI18n,
          domainName,
          mergedText,
        });
        let parsedSummary = { domain_name: domainName, categories: [] };
        try {
          const res = await llm.invoke(prompt, { signal: abortSignal });
          parsedSummary = this._normalizeWeeklySummaryOutput(res?.content, domainName, {
            basePath,
          });
        } catch (error) {
          if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
          parsedSummary = { domain_name: domainName, categories: [] };
        }
        const saved = await this._saveWeeklyDomainSummary({
          basePath,
          weekLabel,
          domainName: parsedSummary.domain_name || domainName,
          categories: parsedSummary.categories,
          createdAt: new Date().toISOString(),
          sourceDates: targetDates,
        });
        if (saved) savedDomains.push(domainName);
      }
      if (savedDomains.length !== mergedDomainMap.size) break;

      for (const dateKey of targetDates) {
        await rm(this._experienceLessonsDailyDir(basePath, dateKey), {
          recursive: true,
          force: true,
        });
      }
      const metadata = await this._readExperienceLessonsMetadata(basePath);
      metadata.weeklyBatches.push({
        weekLabel,
        dates: targetDates,
        domainCount: savedDomains.length,
        createdAt: new Date().toISOString(),
      });
      metadata.updatedAt = new Date().toISOString();
      await writeFile(this._experienceLessonsMetadataPath(basePath), JSON.stringify(metadata, null, 2));
      hasWrittenSummary = true;
    }
    return hasWrittenSummary;
  }

  async readLongMemory({ userId }) {
    const basePath = this._resolveBasePath(userId);
    const longMem = await this._readJson(this._longPath(basePath), {});
    if (typeof longMem?.staticMemory === "string") {
      return longMem.staticMemory;
    }
    return longMem.memory ?? "";
  }

  async captureSessionToShortMemory({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
  }) {
    const basePath = this._resolveBasePath(userId);
    const sessionFile = this._sessionFile(basePath, sessionId, parentSessionId);
    const sessionData = await this._readJson(sessionFile, null);
    if (!sessionData) return false;

    const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
    if (!messages.length) return false;
    const latestDialogProcessId = String(
      [...messages]
        .reverse()
        .find((messageItem) => String(messageItem?.dialogProcessId || "").trim())
        ?.dialogProcessId || "",
    ).trim();
    if (!latestDialogProcessId) return false;

    // 以“对话记录（dialogProcessId）”为单位提取，不再按 session checkpoint 切片
    const dialogRecords = messages.filter(
      (messageItem) =>
        String(messageItem?.dialogProcessId || "").trim() ===
        latestDialogProcessId,
    );
    const records = this._sanitizeDialogRecordsForMemory(dialogRecords);
    if (!records.length) return false;

    const short = await this._readShortMemory(basePath);
    const items = this._flattenShortItems(short);
    items.push({
      records,
      createdAt: new Date().toISOString(),
    });
    this._assignShortItems(short, items);
    this._compactShortMemory(short);
    await this._writeShortMemory(basePath, short);
    return true;
  }

  async maybeSummarize({ userId, userConfig, abortSignal = null }) {
    throwIfAborted(abortSignal);
    const basePath = this._resolveBasePath(userId);
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const promptI18n = resolveMemoryPromptI18n(
      effectiveConfig?.locale || this.globalConfig?.locale || "zh-CN",
    );
    const short = await this._readShortMemory(basePath);
    throwIfAborted(abortSignal);
    const unextracted = this._flattenShortItems(short)
      .sort((a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt));
    const memoryMaxItems = Number(effectiveConfig.memoryMaxItems || 100);
    if (!unextracted.length) return;
    const shouldUpdateLongMemory = unextracted.length >= memoryMaxItems;

    const target = unextracted;
    const promptPayload = target.map((item) => ({
      records: item.records,
    }));
    const longMem = await this._readJson(this._longPath(basePath), {});
    throwIfAborted(abortSignal);
    const existingLongMemory = longMem.memory ?? "";

    const modelSpec = resolveDefaultModelSpec({
      globalConfig: this.globalConfig,
      userConfig,
    });
    const llm = createChatModelByName(modelSpec?.alias || modelSpec?.model, {
      globalConfig: this.globalConfig,
      userConfig,
    });
    let nextLongMemory = existingLongMemory;
    const summaryCreatedAt = new Date().toISOString();
    if (shouldUpdateLongMemory) {
      const longMemoryModel = await this._readLongMemoryModel(basePath);
      throwIfAborted(abortSignal);
      const prompt = String(
        promptI18n?.prompt?.({
          longMemoryModel,
          existingLongMemory,
          promptPayload,
        }) || "",
      ).trim();
      if (!prompt) return;
      try {
        const res = await llm.invoke(prompt, { signal: abortSignal });
        nextLongMemory = this._normalizeModelContent(res?.content);
      } catch (error) {
        if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
        nextLongMemory = existingLongMemory;
      }
    }
    throwIfAborted(abortSignal);

    let hasUpdatedLongMemory = false;
    if (shouldUpdateLongMemory && !this._isBlankLongMemoryContent(nextLongMemory)) {
      const longMemoryPath = this._longPath(basePath);
      throwIfAborted(abortSignal);
      longMem.memory = nextLongMemory;
      longMem.staticMemory = nextLongMemory;
      longMem.updatedAt = new Date().toISOString();
      await writeFile(longMemoryPath, JSON.stringify(longMem, null, 2));
      hasUpdatedLongMemory = true;
    }

    let hasAppendedExperienceLessons = false;
    try {
      const knownDomainNames = await this._collectKnownDomainNames(basePath);
      const lessonPrompt = this._buildDailyExperiencePrompt({
        promptI18n,
        knownDomains: knownDomainNames,
        shortMemoryItems: promptPayload,
      });
      const lessonRes = await llm.invoke(lessonPrompt, { signal: abortSignal });
      const normalizedResults = this._parseDailyExperienceOutput(lessonRes?.content, {
        basePath,
      });
      hasAppendedExperienceLessons = await this._appendDailyDomainResults({
        basePath,
        results: normalizedResults,
        createdAt: summaryCreatedAt,
      });
    } catch (error) {
      if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
      hasAppendedExperienceLessons = false;
    }

    try {
      await this._runWeeklySummaryIfNeeded({
        basePath,
        llm,
        promptI18n,
        abortSignal,
      });
    } catch (error) {
      if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
    }

    if (!hasUpdatedLongMemory && !hasAppendedExperienceLessons) return;

    // 提取后短期记忆全部清空
    this._assignShortItems(short, []);
    await this._writeShortMemory(basePath, short);
  }
}
