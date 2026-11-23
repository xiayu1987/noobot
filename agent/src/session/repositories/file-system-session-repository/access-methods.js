/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { createSessionDeletedError } from "@noobot/session-protocol";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";
import { createSessionTreePersistenceContext } from "../../session-location-resolver.js";
import { readSessionDeletionState } from "../../session-deletion-state.js";
import { requireServerNow } from "@noobot/session-protocol/server-clock";
import {
  advanceSessionBranchDeletion,
  requireBranchDeletionDirectoriesAvailable,
  requireSessionTombstoneSessions,
  SESSION_DELETION_STAGE,
  sessionTombstoneBranchDeletions,
} from "@noobot/workspace-protocol/session-tombstone";
import { syncStorageDirectory } from "../../../shared/storage/durable-file.js";

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
  withSessionBranchDeletion(userId, key, operation) {
    const dir = this.pathResolver.sessionLifecycleLocksDir(this._basePath(userId));
    return this._withMutationLock(path.join(dir, `.branch-${hash("sha256", key)}.lock`), operation);
  }

  _readDeletedSessions(userId) {
    return readSessionDeletionState(this._basePath(requireUserId(userId)));
  }

  async readSessionBranchDeletion(userId, key) {
    const current = await this._readDeletedSessions(userId);
    const operation = sessionTombstoneBranchDeletions(current)[key];
    if (operation) await syncStorageDirectory(path.dirname(this._sessionTombstoneFile(userId)));
    return operation;
  }

  withSessionDeletionFence(userId, operation) {
    const lock = this.pathResolver.sessionTombstoneLockFile(this._basePath(requireUserId(userId)));
    return this._withMutationLock(lock, operation);
  }

  async _updateSessionTombstones(userId, update) {
    const file = this._sessionTombstoneFile(requireUserId(userId));
    return this.withSessionDeletionFence(userId, async () => {
      const current = await this._readDeletedSessions(userId);
      const next = update(current);
      if (next === current) return current;
      requireSessionTombstoneSessions(next, { persistencePath: file });
      await this.storageService.writeJsonAtomic(file, next, { durable: true });
      return next;
    });
  }

  _addSessionTombstones(state, sessionIds, userId) {
    for (const sessionId of sessionIds) {
      if (Object.hasOwn(state.sessions, sessionId)) {
        throw createSessionDeletedError({ userId, sessionId });
      }
    }
    const updatedAt = this.now();
    const deletedAt = requireServerNow(updatedAt);
    return {
      ...state,
      sessions: {
        ...state.sessions,
        ...Object.fromEntries(sessionIds.map((sessionId) => [sessionId, deletedAt])),
      },
      updatedAt,
    };
  }

  async recordSessionBranchDeletion(userId, key, targets, pluginHandlerIds) {
    const operation = { targets, pluginHandlerIds, nextStage: SESSION_DELETION_STAGE.DIRECTORIES };
    const ids = targets.map(({ sessionId }) => sessionId);
    await this._updateSessionTombstones(userId, (current) => {
      const next = this._addSessionTombstones(current, ids, userId);
      requireBranchDeletionDirectoriesAvailable(current, targets);
      return {
        ...next,
        branchDeletions: { ...sessionTombstoneBranchDeletions(current), [key]: operation },
      };
    });
    return operation;
  }

  async advanceSessionBranchDeletion(userId, key, completedStage) {
    const state = await this._updateSessionTombstones(userId, (current) => {
      const operations = sessionTombstoneBranchDeletions(current);
      const next = advanceSessionBranchDeletion(operations[key], completedStage);
      return { ...current, branchDeletions: { ...operations, [key]: next } };
    });
    return sessionTombstoneBranchDeletions(state)[key];
  }

  async releaseDeletedSessionReads(userId, targets) {
    const directories = new Set(
      targets.map(({ directory }) => path.join(this._basePath(userId), ...directory)),
    );
    return this.revokeSessionReads(
      userId,
      new Set(targets.map(({ sessionId }) => sessionId)),
      directories,
    );
  }

  async revokeSessionReads(userId, sessionIds, directories) {
    await this.pageSnapshots.releaseDeletedSessions({ userId, sessionIds, directories });
    await this.removeSessionDisplaySummaries(userId, [...sessionIds]);
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
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw createSessionDeletedError({ userId, sessionId });
    }
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
