/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../../shared/errors/index.js";
import { filePath as path } from "@noobot/path-resolver";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { fsMkdir, fsReaddir, fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import { writeSessionArtifact } from "../../session-artifact-store.js";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";

class SessionCrudMethods {
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
    const sessionIds = [];
    const visit = async (directory, relativeSegments = []) => {
      const directoryEntries =
        directory === this._sessionRoot(userId)
          ? entries
          : await fsReaddir(directory, { withFileTypes: true });
      for (const entry of directoryEntries) {
        if (!entry.isDirectory() || String(entry.name || "").startsWith(".")) continue;
        if (
          String(entry.name || "").includes(".repair-") ||
          String(entry.name || "").endsWith(".mutation-lock")
        )
          continue;
        const childDir = path.join(directory, entry.name);
        const childSegments = [...relativeSegments, entry.name];
        if (await this.storageService.exists(path.join(childDir, "session.json"))) {
          const sessionId = String(entry.name || "").trim();
          if (sessionId && !deletedSet.has(sessionId)) sessionIds.push(sessionId);
        }
        await visit(childDir, childSegments);
      }
    };
    await visit(this._sessionRoot(userId));
    return [...new Set(sessionIds)];
  }

  async ensureSession({
    userId,
    sessionId,
    parentSessionId = "",
    meta = {},
    persistenceContext = null,
  }) {
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const basePath = this._basePath(userId);
        await this.storageService.ensureRuntimeDirsByBasePath(basePath);
        const { resolvedParentSessionId, sessionDir, sessionFile } = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );

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
              selectedConnectorIds: [],
            },
            { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
          );
          await writeSessionArtifact({
            storageService: this.storageService,
            sessionDir,
            sessionPayload: payload,
            atomic: true,
          });
          if (!persistenceContext) {
            await this.upsertSessionSummary(userId, payload);
          }
        }
        return true;
      },
      persistenceContext,
    );
  }

  createInitialSession({ sessionId, parentSessionId = "", meta = {} } = {}) {
    return normalizeSessionEntity(
      {
        sessionId,
        parentSessionId,
        caller: meta?.caller || "user",
        modelAlias: meta?.modelAlias || "",
        currentTaskId: "",
        shortMemoryCheckpoint: 0,
        messages: [],
        selectedConnectorIds: [],
      },
      { now: this.now, sessionId, parentSessionId },
    );
  }

  async findById(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const { resolvedParentSessionId, sessionFile, sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!(await this.storageService.exists(sessionFile))) return null;

    const lifecycle = await this._readSessionLifecycleRecord(userId, sessionId);
    if (lifecycle?.repair?.status === "failed") {
      const error = new Error(
        String(lifecycle.repair.message || "Session repair previously failed"),
      );
      error.code = String(lifecycle.repair.errorCode || "SESSION_REPAIR_PREVIOUSLY_FAILED");
      error.repairSkipped = true;
      throw error;
    }

    const scope = { resolvedParentSessionId, sessionFile, sessionDir };
    try {
      return await this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
    } catch {
      await this._repairSessionToCurrentProtocol(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      return this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
    }
  }

  async save(
    userId,
    session = {},
    parentSessionId = "",
    { expectedAggregateVersion, createOnly = false, persistenceContext = null } = {},
  ) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId || session?.parentSessionId || "",
      async () => {
        const { resolvedParentSessionId, sessionDir } = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId || session?.parentSessionId || "",
          persistenceContext,
        );
        const persistedForChecks =
          createOnly ||
          (expectedAggregateVersion !== undefined && expectedAggregateVersion !== null)
            ? await this.findById(userId, sessionId, resolvedParentSessionId, persistenceContext)
            : null;
        if (createOnly && persistedForChecks) {
          const error = new Error("session already exists");
          error.statusCode = 409;
          error.errorCode = "SESSION_ALREADY_EXISTS";
          throw error;
        }
        if (expectedAggregateVersion !== undefined && expectedAggregateVersion !== null) {
          const actualVersion = Number(persistedForChecks?.aggregateVersion || 0);
          if (actualVersion !== Number(expectedAggregateVersion)) {
            const error = new Error("session aggregate version conflict");
            error.statusCode = 409;
            error.errorCode = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
            error.currentVersion = actualVersion;
            throw error;
          }
        }
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
        await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        try {
          await this.upsertSessionSummary(userId, payload);
        } catch (summaryError) {
          try {
            if (!persistenceContext) {
              await this.rebuildSessionsSummary(userId);
            }
          } catch (rebuildError) {
            rebuildError.cause = rebuildError.cause || summaryError;
            throw rebuildError;
          }
        }
        return true;
      },
      persistenceContext,
    );
  }

  async delete(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await fsRm(sessionDir, { recursive: true, force: true });
    if (!persistenceContext) {
      await this.removeSessionSummaries(userId, [sessionId]);
      await this.removeSessionDisplaySummaries(userId, [sessionId]);
    }
    return true;
  }
}

export const sessionCrudMethods = SessionCrudMethods.prototype;
