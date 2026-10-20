/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { createSessionDeletedError, createSessionNotFoundError } from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

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
  _sessionLifecycleLockDir(userId, sessionId) {
    const sessionKey = requireLifecycleSessionKey(sessionId);
    return path.join(
      this.pathResolver.sessionLifecycleLocksDir(this._basePath(userId)),
      `${sessionKey}.lock`,
    );
  }

  _sessionLifecycleRecordFile(userId, sessionId) {
    const sessionKey = requireLifecycleSessionKey(sessionId);
    return path.join(
      this.pathResolver.sessionLifecycleRecordsDir(this._basePath(userId)),
      `${sessionKey}.json`,
    );
  }

  async _readSessionLifecycleRecord(userId, sessionId) {
    const recordFile = this._sessionLifecycleRecordFile(userId, sessionId);
    const record = await this.storageService.readJson(recordFile, null);
    if (record === null) return null;
    if (typeof record !== "object" || Array.isArray(record) || record.repair?.status !== "failed") {
      const error = new Error(`invalid session lifecycle record: ${recordFile}`);
      error.code = "SESSION_LIFECYCLE_RECORD_INVALID";
      error.persistencePath = recordFile;
      throw error;
    }
    return record;
  }

  async _recordSessionRepairFailure(userId, sessionId, { error, trigger }) {
    const record = {
      schemaVersion: 1,
      sessionId: String(sessionId).trim(),
      repair: {
        status: "failed",
        errorCode: String(error?.code || "SESSION_REPAIR_FAILED"),
        message: String(error?.message || "Session repair failed"),
        failedAt: this.now(),
        trigger: {
          code: String(trigger?.code || ""),
          message: String(trigger?.message || ""),
        },
      },
      updatedAt: this.now(),
    };
    await this.storageService.writeJsonAtomic(
      this._sessionLifecycleRecordFile(userId, sessionId),
      record,
    );
    return record;
  }

  _createPreviousRepairFailureError(lifecycle = null, currentError = null) {
    const repair = lifecycle?.repair || {};
    const error = new Error(String(repair.message || "Session repair previously failed"));
    error.code = String(repair.errorCode || "SESSION_REPAIR_PREVIOUSLY_FAILED");
    error.repairSkipped = true;
    if (repair.trigger) error.repairTrigger = repair.trigger;
    if (currentError) error.cause = currentError;
    return error;
  }

  async _clearSessionRepairFailure(userId = "", sessionId = "") {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      const current = await this._readSessionLifecycleRecord(userId, sessionId);
      if (!current) return false;
      await fsRm(this._sessionLifecycleRecordFile(userId, sessionId), { force: true });
      return true;
    });
  }

  async withSessionLifecycleMutation(userId, sessionId, operation) {
    const lockPath = this._sessionLifecycleLockDir(userId, sessionId);
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
    return this._withScopedSessionMutation(userId, placement.sessionId, operation, async () => {
      await this._assertParentSessionWritable(userId, placement.parentSessionId);
      return this.placeSessionScope(userId, placement, persistenceContext);
    });
  }

  async _withScopedSessionMutation(userId, sessionId, operation, resolveScope) {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      await this.assertSessionWritable(userId, sessionId);
      const scope = await resolveScope();
      await this._assertParentSessionWritable(userId, scope.resolvedParentSessionId);
      return operation(scope);
    });
  }

  async _assertParentSessionWritable(userId, parentSessionId) {
    if (parentSessionId && (await this.isSessionDeleted(userId, parentSessionId))) {
      throw createSessionDeletedError({ userId, sessionId: parentSessionId });
    }
  }

  async writeSessionMetadata(userId, sessionId, metadata, { persistenceContext } = {}) {
    if (!isPlainObject(metadata)) throw new TypeError("session metadata must be a plain object");
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) => this.storageService.writeJsonAtomic(scope.metadataFile, metadata),
      { persistenceContext },
    );
  }

  _withMutationLock(lockPath, operation) {
    return this.mutationCoordinator.run(lockPath, operation);
  }

  async _withSessionSummaryMutation(userId, operation) {
    return this._withMutationLock(`${this._sessionsSummaryFile(userId)}.mutation-lock`, operation);
  }
}

export const sessionLifecycleMethods = SessionLifecycleMethods.prototype;
