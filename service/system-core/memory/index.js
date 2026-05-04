/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, writeFile } from "node:fs/promises";
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

  async readLongMemory({ userId }) {
    const basePath = this._resolveBasePath(userId);
    const longMem = await this._readJson(this._longPath(basePath), {});
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

  async maybeSummarize({ userId, userConfig }) {
    const basePath = this._resolveBasePath(userId);
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const promptI18n = resolveMemoryPromptI18n(
      effectiveConfig?.locale || this.globalConfig?.locale || "zh-CN",
    );
    const short = await this._readShortMemory(basePath);
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
    const prompt = String(
      promptI18n?.prompt?.({
        longMemoryModel,
        existingLongMemory,
        promptPayload,
      }) || "",
    ).trim();
    if (!prompt) return;

    let nextLongMemory = existingLongMemory;
    try {
      const res = await llm.invoke(prompt);
      nextLongMemory = this._normalizeModelContent(res?.content);
    } catch {
      nextLongMemory = existingLongMemory;
    }

    longMem.memory = nextLongMemory;
    longMem.updatedAt = new Date().toISOString();
    await writeFile(this._longPath(basePath), JSON.stringify(longMem, null, 2));

    // 提取后短期记忆全部清空
    this._assignShortItems(short, []);
    await this._writeShortMemory(basePath, short);
  }
}
