/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionDeletedError } from "@noobot/session-protocol";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

function requireIdentity(value, message, code) {
  const normalized = text(value);
  if (!normalized) throw fatalSystemError(tSystem(message), { code });
  return normalized;
}

function requireUserId(userId) {
  return requireIdentity(userId, "common.userIdRequired", ERROR_CODE.FATAL_USER_ID_REQUIRED);
}

function requireSessionId(sessionId) {
  return requireIdentity(
    sessionId,
    "common.sessionIdRequired",
    ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
  );
}

function createTombstoneInvalidError(tombstoneFile) {
  const error = new Error(`invalid session tombstone: ${tombstoneFile}`);
  error.code = "SESSION_TOMBSTONE_INVALID";
  error.persistencePath = tombstoneFile;
  return error;
}

class SessionAccessMethods {
  async _readDeletedSessions(userId) {
    const tombstoneFile = this._sessionTombstoneFile(requireUserId(userId));
    const tombstone = await this.storageService.readJson(tombstoneFile, null);
    if (tombstone === null) return { sessions: {} };
    const sessions = tombstone?.sessions;
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
      throw createTombstoneInvalidError(tombstoneFile);
    }
    for (const [sessionId, deletedAt] of Object.entries(sessions)) {
      if (!String(sessionId).trim() || !Number.isFinite(deletedAt)) {
        throw createTombstoneInvalidError(tombstoneFile);
      }
    }
    return { sessions };
  }

  async markSessionsDeleted(userId, sessionIds) {
    const normalizedUserId = requireUserId(userId);
    if (!Array.isArray(sessionIds)) throw new TypeError("markSessionsDeleted requires sessionIds");
    const ids = [...new Set(sessionIds.map((sessionId) => requireSessionId(sessionId)))];
    if (!ids.length) return 0;
    const current = await this._readDeletedSessions(normalizedUserId);
    const deletedAt = Date.now();
    const sessions = { ...current.sessions };
    for (const sessionId of ids) {
      sessions[sessionId] = deletedAt;
    }
    await this.storageService.writeJsonAtomic(this._sessionTombstoneFile(normalizedUserId), {
      sessions,
      updatedAt: this.now(),
    });
    await this.removeSessionSummaries(normalizedUserId, ids);
    await this.removeSessionDisplaySummaries(normalizedUserId, ids);
    return ids.length;
  }

  async isSessionDeleted(userId, sessionId) {
    const normalizedSessionId = requireSessionId(sessionId);
    const { sessions } = await this._readDeletedSessions(userId);
    return Object.hasOwn(sessions, normalizedSessionId);
  }

  async assertSessionWritable(userId = "", sessionId = "") {
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw createSessionDeletedError({ userId, sessionId });
    }
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
