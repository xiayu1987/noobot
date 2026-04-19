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

export class MemoryService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError("workspaceRoot/userId required", {
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

  _toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
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
    const short = await this._readShortMemory(basePath);
    const unextracted = this._flattenShortItems(short)
      .sort((a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt));
    const memoryMaxItems = Number(effectiveConfig.memoryMaxItems || 100);
    if (unextracted.length < memoryMaxItems)
      return;

    const target = unextracted;
    const promptPayload = target.map((i) => ({
      records: i.records,
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
    const prompt = [
      "你是长期记忆提炼器。",
      longMemoryModel
        ? `请严格遵守以下长期记忆建模规则（来自 long-memory-model.md）：\n${longMemoryModel}`
        : "若未提供建模规则，请优先提炼稳定偏好、长期约束。",
      "请基于“已有长期记忆”与“新短期记忆块”，产出最新的长期偏好。",
      "你可以对已有长期偏好进行总结处理",
      `已有长期偏好:\n${typeof existingLongMemory === "string" ? existingLongMemory : JSON.stringify(existingLongMemory, null, 2)}`,
      `新短期记忆块:\n${JSON.stringify(promptPayload)}`,
    ].join("\n\n");

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
