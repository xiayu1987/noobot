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
import { parseWorkspaceSessionTombstones } from "@noobot/workspace-protocol/session-store";
import { createSessionTreePersistenceContext } from "../../session-location-resolver.js";

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

export function sessionTreeNodeMissingError(sessionId) {
  return fatalSystemError(`${tSystem("session.treeNodeMissing")}: ${sessionId}`, {
    code: ERROR_CODE.FATAL_SESSION_TREE_NODE_MISSING,
    details: { sessionId },
  });
}

class SessionAccessMethods {
  async _readDeletedSessions(userId) {
    const file = this._sessionTombstoneFile(requireUserId(userId));
    const raw = await this.storageService.readTextOrNull(file);
    return { sessions: parseWorkspaceSessionTombstones({ raw, file }) };
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

  _sessionLocation(persistenceContext) {
    if (!persistenceContext?.locationResolver) {
      throw new TypeError("session repository access requires a persistence context");
    }
    return persistenceContext.locationResolver;
  }

  treePersistenceContext(userId, sessionId) {
    return createSessionTreePersistenceContext({
      sessionPathResolver: this.sessionPathResolver,
      userId,
      sessionId,
    });
  }

  async locateSessionScope(userId, sessionId, persistenceContext) {
    return this._sessionLocation(persistenceContext).locateSessionScope(userId, sessionId);
  }

  async requireSessionScope(userId, sessionId, persistenceContext) {
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (scope) return scope;
    throw sessionTreeNodeMissingError(sessionId);
  }

  async placeSessionScope(userId, placement, persistenceContext) {
    return this._sessionLocation(persistenceContext).placeSessionScope(userId, placement);
  }

  async commitSessionPlacement(userId, { sessionId, parentSessionId, caller }, persistenceContext) {
    return this._sessionLocation(persistenceContext).commitSessionPlacement(userId, {
      sessionId,
      parentSessionId,
      caller,
    });
  }
}

export const sessionAccessMethods = SessionAccessMethods.prototype;
