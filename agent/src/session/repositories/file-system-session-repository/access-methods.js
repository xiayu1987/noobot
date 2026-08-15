/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";

class SessionAccessMethods {
  async _readDeletedSessions(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: {}, updatedAt: this.now() };
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const raw = await this.storageService.readJson(markerFile, null);
    const currentSessions =
      raw?.sessions && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {};
    let pruned = false;
    const nextSessions = {};
    for (const [sessionId, deletedAt] of Object.entries(currentSessions)) {
      const normalizedSessionId = String(sessionId || "").trim();
      const deletedAtMs = Number(deletedAt);
      if (!normalizedSessionId || !Number.isFinite(deletedAtMs)) {
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
        sessions && typeof sessions === "object" && !Array.isArray(sessions) ? sessions : {},
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
      const currentLifecycle = await this._readSessionLifecycleRecord(normalizedUserId, sessionId);
      const now = this.now();
      await this._writeSessionLifecycleRecord(normalizedUserId, sessionId, {
        schemaVersion: 1,
        sessionId,
        state: "deleted",
        generation: Math.max(1, Number(currentLifecycle?.generation) || 1) + 1,
        createdAt: String(currentLifecycle?.createdAt || now),
        updatedAt: now,
        operationId: randomUUID(),
        deletedAt: now,
      });
      marked += 1;
    }
    await this._writeDeletedSessions(normalizedUserId, nextSessions);
    await this.removeSessionSummaries(normalizedUserId, ids);
    await this.removeSessionDisplaySummaries(normalizedUserId, ids);
    return marked;
  }

  async isSessionDeleted(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    const payload = await this._readDeletedSessions(userId);
    return Boolean(payload?.sessions?.[normalizedSessionId]);
  }

  createSessionDeletedError(userId = "", sessionId = "") {
    const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
    error.statusCode = 410;
    error.errorCode = "SESSION_DELETED";
    error.code = "SESSION_DELETED";
    error.userId = String(userId || "").trim();
    error.sessionId = String(sessionId || "").trim();
    return error;
  }

  createSessionGenerationStaleError(
    userId = "",
    sessionId = "",
    expectedGeneration = 0,
    currentGeneration = 0,
  ) {
    const error = new Error(`stale session generation: ${String(sessionId || "").trim()}`);
    error.statusCode = 409;
    error.errorCode = "SESSION_GENERATION_STALE";
    error.code = "SESSION_GENERATION_STALE";
    error.userId = String(userId || "").trim();
    error.sessionId = String(sessionId || "").trim();
    error.expectedGeneration = expectedGeneration;
    error.currentGeneration = currentGeneration;
    return error;
  }

  async assertSessionWritable(userId = "", sessionId = "", persistenceContext = null) {
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw this.createSessionDeletedError(userId, sessionId);
    }
    const lifecycle = await this.getSessionLifecycle(userId, sessionId);
    if (lifecycle?.state === "deleted") throw this.createSessionDeletedError(userId, sessionId);
    const token = Number(persistenceContext?.sessionGeneration);
    const current = Number(lifecycle?.generation);
    if (Number.isInteger(token) && token > 0 && token !== current) {
      throw this.createSessionGenerationStaleError(userId, sessionId, token, current);
    }
    return lifecycle;
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveParentSessionId(userId, sessionId, parentSessionId);
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionDir(userId, sessionId, parentSessionId);
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    return resolver.resolveSessionScope(userId, sessionId, parentSessionId);
  }
}

export const sessionAccessMethods = SessionAccessMethods.prototype;
