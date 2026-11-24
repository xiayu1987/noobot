/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { createSessionDeletedError, createSessionNotFoundError } from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import { requireBranchDeletionDirectoriesAvailable } from "@noobot/workspace-protocol/session-tombstone";
import { withSessionReadCache } from "../../session-read-cache.js";

function requireLifecycleSessionKey(sessionId = "") {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) {
    throw fatalSystemError(tSystem("common.sessionIdRequired"), {
      code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
    });
  }
  return encodeURIComponent(normalizedSessionId);
}

class SessionLifecycleMethods {
  _sessionLifecycleLockPath(userId, sessionId) {
    const sessionKey = requireLifecycleSessionKey(sessionId);
    return path.join(
      this.pathResolver.sessionLifecycleLocksDir(this._basePath(userId)),
      `${sessionKey}.lock`,
    );
  }

  async withSessionLifecycleMutation(userId, sessionId, operation) {
    const lockPath = this._sessionLifecycleLockPath(userId, sessionId);
    await this.sessionTreeRepository.assertWorkspaceInitialized(userId);
    return this._withMutationLock(lockPath, operation);
  }

  async withSessionLifecycleMutations(userId, sessionIds = [], operation) {
    const ids = [
      ...new Set(
        (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
          .map((item) => text(item))
          .filter(Boolean),
      ),
    ].sort();
    const runAt = async (index) => {
      if (index >= ids.length) return operation();
      return this.withSessionLifecycleMutation(userId, ids[index], () => runAt(index + 1));
    };
    return runAt(0);
  }

  async withSessionMutation(userId, sessionId, operation, { persistenceContext } = {}) {
    return this._withScopedSessionMutation(userId, sessionId, operation, async () => {
      const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
      if (!scope) throw createSessionNotFoundError({ userId, sessionId });
      return scope;
    });
  }

  async withSessionPlacementMutation(userId, placement, operation, { persistenceContext } = {}) {
    const withAvailableDirectory = (scope) => {
      if (scope.indexed) return operation(scope);
      return this.withSessionDeletionFence(userId, async () => {
        const directory = path.relative(this._basePath(userId), scope.sessionDir).split(path.sep);
        requireBranchDeletionDirectoriesAvailable(await this._readDeletedSessions(userId), [
          { sessionId: placement.sessionId, directory },
        ]);
        return operation(scope);
      });
    };
    return this.withSessionLifecycleMutations(
      userId,
      [placement.sessionId, placement.parentSessionId],
      () =>
        this._withScopedSessionMutation(
          userId,
          placement.sessionId,
          withAvailableDirectory,
          async () => {
            await this._assertParentSessionWritable(userId, placement.parentSessionId);
            return this.placeSessionScope(userId, placement, persistenceContext);
          },
        ),
    );
  }

  async _withScopedSessionMutation(userId, sessionId, operation, resolveScope) {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      await this.assertSessionWritable(userId, sessionId);
      const scope = await resolveScope();
      await this._assertParentSessionWritable(userId, scope.resolvedParentSessionId);
      return withSessionReadCache(scope.sessionDir, () => operation(scope));
    });
  }

  async _assertParentSessionWritable(userId, parentSessionId) {
    if (parentSessionId && (await this.isSessionDeleted(userId, parentSessionId))) {
      throw createSessionDeletedError({ userId, sessionId: parentSessionId });
    }
  }

  async writeSessionMetadata(userId, sessionId, metadata, { persistenceContext } = {}) {
    if (!isPlainObject(metadata)) throw new TypeError("session metadata must be a plain object");
    return this.withSessionReader(
      userId,
      sessionId,
      async ({ reader, commitChanges }) => {
        return commitChanges(
          await reader.prepareRequest({
            operationId: `scoped-metadata:${reader.generation}`,
            changes: { scopedMetadata: metadata },
            committedAt: this.now(),
          }),
        );
      },
      { persistenceContext },
    );
  }

  _withMutationLock(lockPath, operation) {
    return this.mutationCoordinator.run(lockPath, operation);
  }
}

export const sessionLifecycleMethods = SessionLifecycleMethods.prototype;
