/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

  _experienceLessonsDailyPath(basePath, dateKey = "") {
    return path.join(this._experienceLessonsDir(basePath), `${dateKey}.json`);
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

  async _backupLongMemoryIfNeeded(longMemoryPath, existingLongMemory) {
    if (this._isBlankLongMemoryContent(existingLongMemory)) return;
    try {
      await access(longMemoryPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await cp(longMemoryPath, `${longMemoryPath}.${timestamp}.bak`, {
        force: false,
        errorOnExist: false,
      });
    } catch {
      // Best-effort backup only; do not block memory summarization.
    }
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
      batches: [],
      updatedAt: "",
    });
    return {
      batches: Array.isArray(metadata?.batches) ? metadata.batches : [],
      updatedAt: String(metadata?.updatedAt || "").trim(),
    };
  }

  _extractJsonCandidate(input = "") {
    const text = this._stripMarkdownFence(input).trim();
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
    return text.slice(startIndex).trim();
  }

  _normalizeExperienceLessonItems(rawItems = [], { batchId = "", createdAt = "" } = {}) {
    const out = [];
    for (const item of Array.isArray(rawItems) ? rawItems : []) {
      const summary = String(item?.summary || item?.lesson || item?.content || "").trim();
      if (!summary) continue;
      const rawTags = Array.isArray(item?.tags)
        ? item.tags
        : typeof item?.tag === "string"
          ? [item.tag]
          : [];
      const tags = Array.from(
        new Set(
          rawTags
            .map((tagItem) => String(tagItem || "").trim())
            .filter(Boolean),
        ),
      );
      const category = String(item?.category || "").trim();
      out.push({
        id: randomUUID(),
        batchId,
        createdAt,
        category,
        tags,
        summary,
      });
    }
    return out;
  }

  _parseExperienceLessonOutput(rawContent, { batchId = "", createdAt = "" } = {}) {
    const content = this._normalizeModelContent(rawContent);
    if (Array.isArray(content)) {
      return this._normalizeExperienceLessonItems(content, { batchId, createdAt });
    }
    const text = typeof content === "string" ? content : String(content || "");
    const candidate = this._extractJsonCandidate(text);
    if (!candidate) return [];
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed?.lessons)
        ? parsed.lessons
        : Array.isArray(parsed)
          ? parsed
          : [];
      return this._normalizeExperienceLessonItems(items, { batchId, createdAt });
    } catch {
      return [];
    }
  }

  _buildExperienceLessonPrompt({ promptPayload = [] } = {}) {
    return [
      "你是经验复盘助手。请从下面对话记录中提炼“经验教训”，并打标签分类。",
      "输出必须是 JSON，结构如下：",
      '{"lessons":[{"category":"", "tags":[""], "summary":""}]}',
      "要求：",
      "1) 只输出 JSON，不要解释；2) tags 为简短中文标签；3) summary 要可复用。",
      "对话记录：",
      JSON.stringify(promptPayload, null, 2),
    ].join("\n");
  }

  async _appendExperienceLessons({
    basePath = "",
    lessons = [],
    batchId = "",
    createdAt = "",
    sourceShortItems = [],
  } = {}) {
    const normalizedLessons = Array.isArray(lessons) ? lessons : [];
    if (!basePath || !normalizedLessons.length) return false;
    const dateKey = this._toDateKey(createdAt);
    const lessonsDir = this._experienceLessonsDir(basePath);
    const filePath = this._experienceLessonsDailyPath(basePath, dateKey);
    await mkdir(lessonsDir, { recursive: true });

    const existingDaily = await this._readJson(filePath, { date: dateKey, items: [] });
    const existingItems = Array.isArray(existingDaily?.items) ? existingDaily.items : [];
    const nextDaily = {
      date: dateKey,
      items: [...existingItems, ...normalizedLessons],
      updatedAt: new Date().toISOString(),
    };
    await writeFile(filePath, JSON.stringify(nextDaily, null, 2));

    const metadataPath = this._experienceLessonsMetadataPath(basePath);
    const metadata = await this._readExperienceLessonsMetadata(basePath);
    const uniqueTags = Array.from(
      new Set(
        normalizedLessons
          .flatMap((item) => (Array.isArray(item?.tags) ? item.tags : []))
          .map((tagItem) => String(tagItem || "").trim())
          .filter(Boolean),
      ),
    );
    const sourceCreatedAtValues = (Array.isArray(sourceShortItems) ? sourceShortItems : [])
      .map((item) => String(item?.createdAt || "").trim())
      .filter(Boolean)
      .sort();
    metadata.batches.push({
      batchId,
      createdAt,
      date: dateKey,
      file: path.relative(basePath, filePath).replaceAll("\\", "/"),
      fileDir: path.relative(basePath, lessonsDir).replaceAll("\\", "/"),
      tags: uniqueTags,
      lessonCount: normalizedLessons.length,
      sourceShortMemoryCount: Array.isArray(sourceShortItems) ? sourceShortItems.length : 0,
      sourceCreatedAtRange: {
        from: sourceCreatedAtValues[0] || "",
        to: sourceCreatedAtValues[sourceCreatedAtValues.length - 1] || "",
      },
    });
    metadata.updatedAt = new Date().toISOString();
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    return true;
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
    if (unextracted.length < memoryMaxItems)
      return;

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

    let nextLongMemory = existingLongMemory;
    const summaryBatchId = randomUUID();
    const summaryCreatedAt = new Date().toISOString();
    try {
      const res = await llm.invoke(prompt, { signal: abortSignal });
      nextLongMemory = this._normalizeModelContent(res?.content);
    } catch (error) {
      if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
      nextLongMemory = existingLongMemory;
    }
    throwIfAborted(abortSignal);

    let hasUpdatedLongMemory = false;
    if (!this._isBlankLongMemoryContent(nextLongMemory)) {
      const longMemoryPath = this._longPath(basePath);
      await this._backupLongMemoryIfNeeded(longMemoryPath, existingLongMemory);
      throwIfAborted(abortSignal);
      longMem.memory = nextLongMemory;
      longMem.staticMemory = nextLongMemory;
      longMem.updatedAt = new Date().toISOString();
      await writeFile(longMemoryPath, JSON.stringify(longMem, null, 2));
      hasUpdatedLongMemory = true;
    }

    let hasAppendedExperienceLessons = false;
    try {
      const lessonPrompt = this._buildExperienceLessonPrompt({
        promptPayload,
      });
      const lessonRes = await llm.invoke(lessonPrompt, { signal: abortSignal });
      const normalizedLessons = this._parseExperienceLessonOutput(lessonRes?.content, {
        batchId: summaryBatchId,
        createdAt: summaryCreatedAt,
      });
      hasAppendedExperienceLessons = await this._appendExperienceLessons({
        basePath,
        lessons: normalizedLessons,
        batchId: summaryBatchId,
        createdAt: summaryCreatedAt,
        sourceShortItems: target,
      });
    } catch (error) {
      if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
      hasAppendedExperienceLessons = false;
    }

    if (!hasUpdatedLongMemory && !hasAppendedExperienceLessons) return;

    // 提取后短期记忆全部清空
    this._assignShortItems(short, []);
    await this._writeShortMemory(basePath, short);
  }
}
