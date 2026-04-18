/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createChatModelByName, resolveDefaultModelSpec } from "../model/index.js";
import { mergeConfig } from "../config/index.js";

export class MemoryService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw new Error("workspaceRoot/userId required");
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  _shortPath(basePath) {
    return path.join(basePath, "memory/short-memory");
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

  _normalizeShortMemory(data) {
    const normalizedDays = {};

    const days = data?.days || {};
    for (const [day, items] of Object.entries(days)) {
      if (!Array.isArray(items)) continue;
      if (!normalizedDays[day]) normalizedDays[day] = [];
      for (const item of items) {
        normalizedDays[day].push({
          ...item,
          createdAt: item?.createdAt || `${day}T00:00:00.000Z`,
        });
      }
    }

    return {
      days: normalizedDays,
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }

  async _readShortMemory(basePath) {
    const shortDir = this._shortPath(basePath);
    await mkdir(shortDir, { recursive: true });
    const days = {};
    const files = (await readdir(shortDir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name);
    for (const file of files) {
      const day = file.replace(/\.json$/i, "");
      const dayData = await this._readJson(path.join(shortDir, file), { items: [] });
      const items = Array.isArray(dayData?.items) ? dayData.items : [];
      days[day] = items;
    }
    return this._normalizeShortMemory({ days });
  }

  async _writeShortMemory(basePath, short) {
    const shortDir = this._shortPath(basePath);
    await mkdir(shortDir, { recursive: true });
    const dayMap = short?.days || {};
    const expectedFiles = new Set(
      Object.keys(dayMap).map((day) => `${String(day)}.json`),
    );

    const currentFiles = (await readdir(shortDir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name);
    for (const file of currentFiles) {
      if (expectedFiles.has(file)) continue;
      await rm(path.join(shortDir, file), { force: true });
    }

    for (const [day, items] of Object.entries(dayMap)) {
      const payload = {
        date: day,
        items: Array.isArray(items) ? items : [],
        updatedAt: new Date().toISOString(),
      };
      await writeFile(
        path.join(shortDir, `${day}.json`),
        JSON.stringify(payload, null, 2),
      );
    }
  }

  _dayKey(ts = "") {
    const d = new Date(ts || Date.now());
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  _toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  _flattenShortItems(short = {}) {
    const days = short?.days || {};
    const out = [];
    for (const items of Object.values(days)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) out.push(item);
    }
    return out;
  }

  _assignShortItems(short, items = []) {
    const days = {};
    for (const item of items) {
      const day = this._dayKey(item?.createdAt);
      if (!days[day]) days[day] = [];
      days[day].push(item);
    }
    for (const day of Object.keys(days)) {
      days[day].sort((a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt));
    }
    short.days = days;
  }

  _compactShortMemory(short, userConfig = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const maxItems = Number(effectiveConfig.shortMemoryMaxItems || 1000);
    const pendingTtlDays = Number(
      effectiveConfig.shortMemoryPendingTtlDays || 3,
    );
    const ttlMs =
      pendingTtlDays > 0 ? pendingTtlDays * 24 * 60 * 60 * 1000 : 0;
    const now = Date.now();

    // 规则：只保留“未提取”短期记忆；已提取立即删除
    let pending = this._flattenShortItems(short)
      .filter((i) => !i.extracted)
      .filter((i) => {
        if (!ttlMs) return true;
        const t = this._toTs(i.createdAt);
        return t > 0 && now - t <= ttlMs;
      })
      .sort((a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt));

    if (pending.length > maxItems) pending = pending.slice(-maxItems);
    this._assignShortItems(short, pending);
  }

  async readLongMemory({ userId }) {
    const basePath = this._resolveBasePath(userId);
    return (await this._readJson(this._longPath(basePath), { facts: [] })).facts || [];
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

    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const threshold = Number(
      effectiveConfig.sessionToShortMemoryThreshold || 10,
    );
    const messages = sessionData.messages || [];
    const checkpoint = Number(sessionData.shortMemoryCheckpoint || 0);
    const pendingCount = messages.length - checkpoint;
    if (pendingCount < threshold) return false;

    const records = messages.slice(checkpoint);
    const short = await this._readShortMemory(basePath);
    const items = this._flattenShortItems(short);
    items.push({
      id: `${sessionId}-${Date.now()}-${messages.length}`,
      sessionId,
      fromIndex: checkpoint,
      toIndex: messages.length,
      records,
      extracted: false,
      createdAt: new Date().toISOString(),
    });
    this._assignShortItems(short, items);
    this._compactShortMemory(short, userConfig);
    await this._writeShortMemory(basePath, short);

    sessionData.shortMemoryCheckpoint = messages.length;
    sessionData.updatedAt = new Date().toISOString();
    await writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    return true;
  }

  async maybeSummarize({ userId, userConfig }) {
    const basePath = this._resolveBasePath(userId);
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const short = await this._readShortMemory(basePath);
    const unextracted = this._flattenShortItems(short)
      .filter((i) => !i.extracted)
      .sort((a, b) => this._toTs(a.createdAt) - this._toTs(b.createdAt));
    if (unextracted.length < Number(effectiveConfig.shortMemoryThreshold || 12))
      return;

    const limit = Number(effectiveConfig.longMemoryWindow || 20);
    const target = unextracted.slice(0, limit);
    const promptPayload = target.map((i) => ({
      sessionId: i.sessionId,
      records: i.records,
    }));
    const longMem = await this._readJson(this._longPath(basePath), { facts: [] });
    const existingFacts = Array.isArray(longMem?.facts) ? longMem.facts : [];

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
      `已有长期偏好:\n${JSON.stringify(existingFacts)}`,
      `新短期记忆块:\n${JSON.stringify(promptPayload)}`,
    ].join("\n\n");

    let facts = [];
    try {
      const res = await llm.invoke(prompt);
      const parsed =
        typeof res.content === "string" ? JSON.parse(res.content) : [];
      facts = Array.isArray(parsed) ? parsed : [];
    } catch {
      facts = existingFacts;
    }

    longMem.facts = Array.isArray(facts)
      ? facts.slice(-500)
      : existingFacts.slice(-500);
    await writeFile(this._longPath(basePath), JSON.stringify(longMem, null, 2));

    const targetIds = new Set(target.map((t) => t.id));
    // 提取后立即删除
    const remained = this._flattenShortItems(short).filter(
      (item) => !targetIds.has(item.id),
    );
    this._assignShortItems(short, remained);

    this._compactShortMemory(short, userConfig);
    await this._writeShortMemory(basePath, short);
  }
}
