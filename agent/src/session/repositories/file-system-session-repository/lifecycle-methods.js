/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { randomUUID } from "node:crypto";
import { fsMkdir } from "../../../shared/storage/fs-adapter.js";

class SessionLifecycleMethods {
  _sessionLifecycleLockDir(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const safeSessionId = encodeURIComponent(normalizedSessionId || "__empty__");
    return path.join(this._sessionRoot(userId), ".lifecycle", "locks", `${safeSessionId}.lock`);
  }

  _sessionLifecycleRecordFile(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const safeSessionId = encodeURIComponent(normalizedSessionId || "__empty__");
    return path.join(this._sessionRoot(userId), ".lifecycle", "records", `${safeSessionId}.json`);
  }

  async _readSessionLifecycleRecord(userId = "", sessionId = "") {
    const record = await this.storageService.readJson(
      this._sessionLifecycleRecordFile(userId, sessionId),
      null,
    );
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  }

  async _writeSessionLifecycleRecord(userId = "", sessionId = "", record = {}) {
    await fsMkdir(path.dirname(this._sessionLifecycleRecordFile(userId, sessionId)), {
      recursive: true,
    });
    await this.storageService.writeJsonAtomic(
      this._sessionLifecycleRecordFile(userId, sessionId),
      record,
    );
    return record;
  }

  async getSessionLifecycle(userId = "", sessionId = "", { initialize = true } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const current = await this._readSessionLifecycleRecord(userId, normalizedSessionId);
    if (current) return current;
    if (!initialize) return null;
    return this.withSessionLifecycleMutation(userId, normalizedSessionId, async () => {
      const existing = await this._readSessionLifecycleRecord(userId, normalizedSessionId);
      if (existing) return existing;
      const deleted = await this.isSessionDeleted(userId, normalizedSessionId);
      const now = this.now();
      return this._writeSessionLifecycleRecord(userId, normalizedSessionId, {
        schemaVersion: 1,
        sessionId: normalizedSessionId,
        state: deleted ? "deleted" : "active",
        generation: 1,
        createdAt: now,
        updatedAt: now,
        operationId: randomUUID(),
        ...(deleted ? { deletedAt: now } : {}),
      });
    });
  }

  async withSessionLifecycleMutation(userId, sessionId, operation) {
    return this._withMutationLock(this._sessionLifecycleLockDir(userId, sessionId), operation);
  }

  async withSessionLifecycleMutations(userId, sessionIds = [], operation) {
    const ids = [
      ...new Set(
        (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    ].sort();
    const runAt = async (index) => {
      if (index >= ids.length) return operation();
      return this.withSessionLifecycleMutation(userId, ids[index], () => runAt(index + 1));
    };
    return runAt(0);
  }

  async withSessionMutation(
    userId,
    sessionId,
    parentSessionId = "",
    operation,
    persistenceContext = null,
  ) {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      await this.assertSessionWritable(userId, sessionId, persistenceContext);
      const scope = await this.resolveSessionScope(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const result = await operation();
      if (typeof persistenceContext?.metadataContributor === "function") {
        const metadata = await persistenceContext.metadataContributor({
          userId,
          sessionId,
          parentSessionId: scope.resolvedParentSessionId,
          scope,
        });
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          await this.storageService.writeJsonAtomic(scope.metadataFile, metadata);
        }
      }
      return result;
    });
  }

  _withMutationLock(lockPath, operation) {
    return this.mutationCoordinator.run(lockPath, operation);
  }

  async _withSessionSummaryMutation(userId, operation) {
    return this._withMutationLock(`${this._sessionsSummaryFile(userId)}.mutation-lock`, operation);
  }
}

export const sessionLifecycleMethods = SessionLifecycleMethods.prototype;
