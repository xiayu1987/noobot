/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";
import { fsMkdir, fsReaddir, fsRm } from "../../store/fs-adapter.js";
import { normalizeSessionEntity } from "../entities/session-entity.js";

function buildSessionSummary(session = {}, { depth = 0 } = {}) {
  const sessionId = String(session?.sessionId || "").trim();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "").trim().toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const lastMessage = messages.length ? buildMessageSummary(messages[messages.length - 1]) : null;
  return {
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    title: firstUserMessage
      ? String(firstUserMessage.content || "").slice(0, 20)
      : sessionId.slice(0, 8),
    messageCount: messages.length,
    lastMessage,
  };
}

function buildMessageSummary(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const summary = {
    role: String(message?.role || "").trim(),
    content: message?.content || "",
    type: String(message?.type || "").trim(),
    dialogProcessId: String(message?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    summarized: message?.summarized === true,
    ts: String(message?.ts || "").trim(),
  };
  for (const key of [
    "injectedMessage",
    "injectedBy",
    "injectedMessageType",
    "frontendUserMessage",
    "isMonotonic",
    "monotonic",
    "monotonicState",
    "stopState",
    "state",
    "status",
    "channelState",
    "pluginMessage",
    "tool_call_id",
    "toolName",
  ]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== ""));
}

function normalizeSessionsSummaryPayload(payload = {}, now = () => new Date().toISOString()) {
  const source = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const sessions = source
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      sessionId: String(item?.sessionId || "").trim(),
      parentSessionId: String(item?.parentSessionId || "").trim(),
      caller: String(item?.caller || "user").trim() || "user",
      currentTaskId: String(item?.currentTaskId || "").trim(),
      createdAt: String(item?.createdAt || "").trim(),
      updatedAt: String(item?.updatedAt || "").trim(),
      depth: Number.isFinite(Number(item?.depth)) ? Number(item.depth) : 0,
      title: String(item?.title || "").trim() || String(item?.sessionId || "").trim().slice(0, 8),
      messageCount: Number.isFinite(Number(item?.messageCount)) ? Number(item.messageCount) : 0,
      lastMessage:
        item?.lastMessage && typeof item.lastMessage === "object" && !Array.isArray(item.lastMessage)
          ? item.lastMessage
          : null,
    }))
    .filter((item) => item.sessionId);
  return {
    sessions,
    updatedAt: String(payload?.updatedAt || "").trim() || now(),
  };
}

export class FileSystemSessionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeMessages,
    normalizeSelectedConnectors,
    now = () => new Date().toISOString(),
    deletedSessionGuardTtlMs = 15 * 60 * 1000,
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.normalizeMessages = normalizeMessages;
    this.normalizeSelectedConnectors = normalizeSelectedConnectors;
    this.now = now;
    this.deletedSessionGuardTtlMs =
      Number.isFinite(Number(deletedSessionGuardTtlMs)) && Number(deletedSessionGuardTtlMs) > 0
        ? Number(deletedSessionGuardTtlMs)
        : 15 * 60 * 1000;
    this._deletedSessionCache = new Map(); // userId -> { sessions, updatedAt }
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  _deletedSessionMarkerFile(userId = "") {
    if (typeof this.pathResolver?.deletedSessionMarkerFile === "function") {
      return this.pathResolver.deletedSessionMarkerFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/.deleted-sessions.json`;
  }

  _sessionsSummaryFile(userId = "") {
    if (typeof this.pathResolver?.sessionsSummaryFile === "function") {
      return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/sessions.json`;
  }

  _sortSummaries(sessions = []) {
    return [...sessions].sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
  }

  _withSummaryDepth(session = {}, sessionTree = null) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId || !sessionTree?.nodes?.[sessionId]) return buildSessionSummary(session, { depth: 0 });
    const visited = new Set();
    let depth = 0;
    let currentId = sessionId;
    while (currentId && !visited.has(currentId) && sessionTree?.nodes?.[currentId]) {
      visited.add(currentId);
      depth += 1;
      currentId = String(sessionTree.nodes[currentId]?.parentSessionId || "").trim();
    }
    return buildSessionSummary(session, { depth });
  }

  async readSessionsSummary(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    const payload = await this.storageService.readJson(
      this._sessionsSummaryFile(normalizedUserId),
      { sessions: [], updatedAt: this.now() },
    );
    return normalizeSessionsSummaryPayload(payload, this.now);
  }

  async writeSessionsSummary(userId = "", sessions = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const payload = normalizeSessionsSummaryPayload(
      { sessions: this._sortSummaries(sessions), updatedAt: this.now() },
      this.now,
    );
    await this.storageService.writeJsonAtomic(
      this._sessionsSummaryFile(normalizedUserId),
      payload,
    );
    return payload;
  }

  async upsertSessionSummary(userId = "", session = {}, { sessionTree = null } = {}) {
    const summary = this._withSummaryDepth(session, sessionTree);
    if (!summary.sessionId) return null;
    const current = await this.readSessionsSummary(userId);
    const nextMap = new Map(current.sessions.map((item) => [item.sessionId, item]));
    nextMap.set(summary.sessionId, summary);
    await this.writeSessionsSummary(userId, Array.from(nextMap.values()));
    return summary;
  }

  async removeSessionSummaries(userId = "", sessionIds = []) {
    const ids = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!ids.size) return 0;
    const current = await this.readSessionsSummary(userId);
    const next = current.sessions.filter((item) => !ids.has(item.sessionId));
    if (next.length === current.sessions.length) return 0;
    await this.writeSessionsSummary(userId, next);
    return current.sessions.length - next.length;
  }

  async rebuildSessionsSummary(userId = "", { sessionTree = null } = {}) {
    const tree = sessionTree || null;
    const treeSessionIds = Object.keys(tree?.nodes || {});
    const sessionIds = treeSessionIds.length ? treeSessionIds : await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = String(tree?.nodes?.[sessionId]?.parentSessionId || "").trim();
      const session = await this.findById(userId, sessionId, parentSessionId);
      if (!session) continue;
      summaries.push(this._withSummaryDepth(session, tree));
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  async _readDeletedSessions(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: {}, updatedAt: this.now() };
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const raw = await this.storageService.readJson(markerFile, null);
    const currentSessions =
      raw?.sessions && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {};
    const nowMs = Date.now();
    const ttlMs = this.deletedSessionGuardTtlMs;
    let pruned = false;
    const nextSessions = {};
    for (const [sessionId, deletedAt] of Object.entries(currentSessions)) {
      const normalizedSessionId = String(sessionId || "").trim();
      const deletedAtMs = Number(deletedAt);
      if (!normalizedSessionId || !Number.isFinite(deletedAtMs)) {
        pruned = true;
        continue;
      }
      if (nowMs - deletedAtMs > ttlMs) {
        pruned = true;
        continue;
      }
      nextSessions[normalizedSessionId] = deletedAtMs;
    }
    const payload = {
      sessions: nextSessions,
      updatedAt: String(raw?.updatedAt || this.now()),
    };
    if (pruned) {
      await this.storageService.writeJsonAtomic(markerFile, {
        sessions: nextSessions,
        updatedAt: this.now(),
      });
      payload.updatedAt = this.now();
    }
    this._deletedSessionCache.set(normalizedUserId, payload);
    return payload;
  }

  async _writeDeletedSessions(userId = "", sessions = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return false;
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const payload = {
      sessions:
        sessions && typeof sessions === "object" && !Array.isArray(sessions)
          ? sessions
          : {},
      updatedAt: this.now(),
    };
    await this.storageService.writeJsonAtomic(markerFile, payload);
    this._deletedSessionCache.set(normalizedUserId, payload);
    return true;
  }

  async markSessionsDeleted(userId = "", sessionIds = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return 0;
    const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!ids.length) return 0;
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const current = await this._readDeletedSessions(normalizedUserId);
    const nextSessions = {
      ...(current?.sessions && typeof current.sessions === "object" ? current.sessions : {}),
    };
    const deletedAt = Date.now();
    let marked = 0;
    for (const sessionId of ids) {
      nextSessions[sessionId] = deletedAt;
      marked += 1;
    }
    await this._writeDeletedSessions(normalizedUserId, nextSessions);
    await this.removeSessionSummaries(normalizedUserId, ids);
    return marked;
  }

  async isSessionDeleted(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    const payload = await this._readDeletedSessions(userId);
    return Boolean(payload?.sessions?.[normalizedSessionId]);
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionDir(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async listSessionIds(userId) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    let entries = [];
    try {
      entries = await fsReaddir(this._sessionRoot(userId), { withFileTypes: true });
    } catch {
      return [];
    }
    const deletedSessions = await this._readDeletedSessions(userId);
    const deletedSet = new Set(Object.keys(deletedSessions?.sessions || {}));
    return entries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name)
      .filter((sessionId) => !deletedSet.has(String(sessionId || "").trim()));
  }

  async ensureSession({ userId, sessionId, parentSessionId = "", meta = {} }) {
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { resolvedParentSessionId, sessionDir, sessionFile } =
      await this.resolveSessionScope(userId, sessionId, parentSessionId);

    await fsMkdir(sessionDir, { recursive: true });

    if (!(await this.storageService.exists(sessionFile))) {
      const payload = normalizeSessionEntity(
        {
          sessionId,
          parentSessionId: resolvedParentSessionId || "",
          caller: meta?.caller || "user",
          modelAlias: meta?.modelAlias || "",
          currentTaskId: "",
          shortMemoryCheckpoint: 0,
          messages: [],
          selectedConnectors: {},
        },
        { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
      );
      await this.storageService.writeJson(sessionFile, payload);
      await this.upsertSessionSummary(userId, payload);
    }
    return true;
  }

  async findById(userId, sessionId, parentSessionId = "") {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!(await this.storageService.exists(sessionFile))) return null;

    const session = await this.storageService.readJson(sessionFile, {});
    session.sessionId = String(session.sessionId || sessionId || "").trim();
    session.parentSessionId = String(
      session.parentSessionId || resolvedParentSessionId || "",
    ).trim();
    session.caller = String(session.caller || "user").trim() || "user";
    session.modelAlias = String(session.modelAlias || "");
    session.messages = this.normalizeMessages(session.messages || []);
    session.selectedConnectors = this.normalizeSelectedConnectors(
      session.selectedConnectors || {},
    );
    return session;
  }

  async save(userId, session = {}, parentSessionId = "") {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId || session?.parentSessionId || "",
    );
    const payload = normalizeSessionEntity(
      {
        ...session,
        sessionId,
        parentSessionId: String(
          session?.parentSessionId || resolvedParentSessionId || "",
        ).trim(),
        updatedAt: this.now(),
      },
      { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
    );
    await this.storageService.writeJson(sessionFile, payload);
    await this.upsertSessionSummary(userId, payload);
    return true;
  }

  async delete(userId, sessionId, parentSessionId = "") {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsRm(sessionDir, { recursive: true, force: true });
    await this.removeSessionSummaries(userId, [sessionId]);
    return true;
  }
}
