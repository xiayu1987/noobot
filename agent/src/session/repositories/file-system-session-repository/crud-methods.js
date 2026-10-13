/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { fsMkdir, fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import { writeSessionArtifact } from "../../session-artifact-store.js";
import {
  SESSION_ERROR_CODE,
  createSessionDeletedError,
  normalizeParentSessionId,
} from "@noobot/session-protocol";

class SessionCrudMethods {
  async registerSessionTreeNode(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    const normalizedParentSessionId = normalizeParentSessionId(parentSessionId);
    return this.sessionTreeRepository.withLock(userId, async () => {
      if (await this.isSessionDeleted(userId, normalizedSessionId)) {
        throw createSessionDeletedError({ userId, sessionId: normalizedSessionId });
      }
      if (
        normalizedParentSessionId &&
        (await this.isSessionDeleted(userId, normalizedParentSessionId))
      ) {
        throw createSessionDeletedError({ userId, sessionId: normalizedParentSessionId });
      }
      const sessionTree = await this.sessionTreeRepository.getTree(userId);
      if (normalizedParentSessionId && !sessionTree.nodes[normalizedParentSessionId]) {
        throw fatalSystemError(
          `${tSystem("session.parentSessionNotFoundPossiblyDeleted")}: ${normalizedParentSessionId}`,
          {
            code: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
            details: { normalizedParentSessionId },
          },
        );
      }
      const currentNode = sessionTree.nodes[normalizedSessionId];
      if (currentNode) {
        if (currentNode.parentSessionId === normalizedParentSessionId) return true;
        const error = new Error("session tree parent conflicts with requested parent");
        error.statusCode = 409;
        error.code = SESSION_ERROR_CODE.PARENT_SESSION_SCOPE_CONFLICT;
        throw error;
      }
      sessionTree.nodes[normalizedSessionId] = {
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
      };
      await this.sessionTreeRepository.saveTree(userId, sessionTree);
      return true;
    });
  }

  async listSessionIds(userId) {
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const deletedSessions = await this._readDeletedSessions(userId);
    return Object.keys(sessionTree.nodes).filter(
      (sessionId) => !Object.hasOwn(deletedSessions.sessions, sessionId),
    );
  }

  async ensureSession({
    userId,
    sessionId,
    parentSessionId = "",
    meta = {},
    persistenceContext = null,
  }) {
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const { resolvedParentSessionId, sessionDir, sessionFile } = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );

        if (await this.storageService.exists(sessionFile)) {
          if (!persistenceContext) {
            this.sessionTreeRepository.resolveRootSessionIdFromTree(
              sessionId,
              await this.sessionTreeRepository.getTree(userId),
            );
          }
          return true;
        }
        await fsMkdir(sessionDir, { recursive: true });
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
          await this.registerSessionTreeNode(userId, sessionId, resolvedParentSessionId);
          await this.upsertSessionSummary(userId, payload);
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

    const scope = { resolvedParentSessionId, sessionFile, sessionDir };
    const lifecycle = await this._readSessionLifecycleRecord(userId, sessionId);
    const repairPreviouslyFailed = lifecycle?.repair?.status === "failed";
    try {
      const session = await this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
      if (repairPreviouslyFailed) await this._clearSessionRepairFailure(userId, sessionId);
      return session;
    } catch (error) {
      if (repairPreviouslyFailed) throw this._createPreviousRepairFailureError(lifecycle, error);
      try {
        await this._repairSessionToCurrentProtocol(
          userId,
          sessionId,
          resolvedParentSessionId,
          persistenceContext,
        );
        return this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
      } catch (repairError) {
        try {
          await this.markSessionSummaryUnavailable(
            userId,
            sessionId,
            resolvedParentSessionId,
            repairError,
          );
        } catch (projectionError) {
          repairError.unavailableProjectionCause = projectionError;
        }
        throw repairError;
      }
    }
  }

  async readSelectedConnectorIds(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (await this.isSessionDeleted(userId, sessionId)) return [];
    const { sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!(await this.storageService.exists(sessionFile))) return [];
    const manifest = await this.storageService.readJson(sessionFile, null);
    if (String(manifest?.sessionId || "").trim() !== String(sessionId || "").trim()) {
      const error = new Error("Session manifest identity does not match its storage scope");
      error.code = "SESSION_MANIFEST_IDENTITY_MISMATCH";
      throw error;
    }
    return this.normalizeSelectedConnectorIds(manifest.selectedConnectorIds);
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
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const { resolvedParentSessionId, sessionDir } = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );
        const entityParentSessionId = normalizeParentSessionId(session?.parentSessionId);
        if (entityParentSessionId && entityParentSessionId !== resolvedParentSessionId) {
          const error = new Error("session entity parentSessionId conflicts with resolved scope");
          error.statusCode = 409;
          error.code = SESSION_ERROR_CODE.PARENT_SESSION_SCOPE_CONFLICT;
          throw error;
        }
        const persistedForChecks =
          createOnly ||
          (expectedAggregateVersion !== undefined && expectedAggregateVersion !== null)
            ? await this.findById(userId, sessionId, resolvedParentSessionId, persistenceContext)
            : null;
        if (createOnly && persistedForChecks) {
          const error = new Error("session already exists");
          error.statusCode = 409;
          error.code = "SESSION_ALREADY_EXISTS";
          throw error;
        }
        if (expectedAggregateVersion !== undefined && expectedAggregateVersion !== null) {
          const actualVersion = Number(persistedForChecks?.aggregateVersion || 0);
          if (actualVersion !== Number(expectedAggregateVersion)) {
            const error = new Error("session aggregate version conflict");
            error.statusCode = 409;
            error.code = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
            error.currentVersion = actualVersion;
            throw error;
          }
        }
        const payload = normalizeSessionEntity(
          {
            ...session,
            sessionId,
            parentSessionId: resolvedParentSessionId,
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
        if (createOnly && !persistenceContext) {
          await this.registerSessionTreeNode(userId, sessionId, resolvedParentSessionId);
        }
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
