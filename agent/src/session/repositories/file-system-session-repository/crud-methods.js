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
import { writeSessionArtifact, writeSessionTurnArtifacts } from "../../session-artifact-store.js";
import {
  SESSION_ERROR_CODE,
  createSessionDeletedError,
  normalizeParentSessionId,
  createEmptyTurnLifecycle,
  requireSessionAggregateVersion,
} from "@noobot/session-protocol";
import { requireSessionCaller } from "@noobot/shared/session-caller";
import {
  assertSessionTreeParentRegistered,
  createSessionTreeNode,
} from "@noobot/workspace-protocol/session-tree";
import { toSessionTreeFatalError } from "../../session-path-resolver.js";
import { text } from "@noobot/shared/value";

class SessionCrudMethods {
  async registerSessionTreeNode(userId, { sessionId, parentSessionId, caller }) {
    const node = createSessionTreeNode({ sessionId, parentSessionId, caller });
    const normalizedSessionId = node.sessionId;
    const normalizedParentSessionId = node.parentSessionId;
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
      if (normalizedParentSessionId) {
        try {
          assertSessionTreeParentRegistered(
            sessionTree,
            normalizedSessionId,
            normalizedParentSessionId,
          );
        } catch (error) {
          throw toSessionTreeFatalError(error, normalizedSessionId);
        }
      }
      const currentNode = sessionTree.nodes[normalizedSessionId];
      if (currentNode) {
        if (
          currentNode.parentSessionId === normalizedParentSessionId &&
          currentNode.caller === node.caller
        ) {
          return true;
        }
        const error = new Error("session tree node conflicts with requested node");
        error.statusCode = 409;
        error.code = SESSION_ERROR_CODE.SESSION_TREE_NODE_CONFLICT;
        throw error;
      }
      sessionTree.nodes[normalizedSessionId] = node;
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

  async ensureSession({ userId, sessionId, parentSessionId, caller, persistenceContext }) {
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
        const payload = this.createInitialSession({
          sessionId,
          parentSessionId: resolvedParentSessionId,
          caller,
        });
        const { listFacts } = await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        if (!persistenceContext) {
          await this.registerSessionTreeNode(userId, payload);
        }
        await this.upsertSessionSummary(userId, payload, { listFacts, persistenceContext });
        return true;
      },
      persistenceContext,
    );
  }

  createInitialSession({ sessionId, parentSessionId, caller }) {
    return normalizeSessionEntity(
      {
        sessionId,
        parentSessionId,
        aggregateVersion: 0,
        caller: requireSessionCaller(caller),
        modelAlias: "",
        currentTaskId: "",
        shortMemoryCheckpoint: 0,
        messages: [],
        dialogOrder: [],
        turnTimings: [],
        turnLifecycle: createEmptyTurnLifecycle(),
        selectedConnectorIds: [],
      },
      { now: this.now, sessionId, parentSessionId },
    );
  }

  async findById(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    return this._findWithProtocolRepair(userId, sessionId, {
      parentSessionId,
      persistenceContext,
      read: (scope, resolvedParentSessionId) =>
        this._readNormalizedSession(scope, sessionId, resolvedParentSessionId),
    });
  }

  async findTurnView(
    userId,
    sessionId,
    parentSessionId = "",
    { turnScopeIds = [], persistenceContext = null } = {},
  ) {
    return this._findWithProtocolRepair(userId, sessionId, {
      parentSessionId,
      persistenceContext,
      read: (scope, resolvedParentSessionId) =>
        this._readNormalizedTurnView(scope, sessionId, resolvedParentSessionId, turnScopeIds),
    });
  }

  async _findWithProtocolRepair(userId, sessionId, { parentSessionId, persistenceContext, read }) {
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
      const result = await read(scope, resolvedParentSessionId);
      if (repairPreviouslyFailed) await this._clearSessionRepairFailure(userId, sessionId);
      return result;
    } catch (error) {
      if (repairPreviouslyFailed) throw this._createPreviousRepairFailureError(lifecycle, error);
      try {
        await this._repairSessionToCurrentProtocol(
          userId,
          sessionId,
          resolvedParentSessionId,
          persistenceContext,
        );
        return read(scope, resolvedParentSessionId);
      } catch (repairError) {
        try {
          await this.markSessionSummaryUnavailable(userId, sessionId, {
            error: repairError,
            persistenceContext,
          });
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
    if (text(manifest?.sessionId) !== text(sessionId)) {
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
    return this._writeScopedSession(userId, session, {
      parentSessionId,
      persistenceContext,
      write: async ({ sessionId, resolvedParentSessionId, sessionDir }) => {
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
          if (!persistedForChecks) {
            const error = new Error("session aggregate version expected for a missing session");
            error.statusCode = 409;
            error.code = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
            throw error;
          }
          const actualVersion = requireSessionAggregateVersion(persistedForChecks.aggregateVersion);
          if (actualVersion !== expectedAggregateVersion) {
            const error = new Error("session aggregate version conflict");
            error.statusCode = 409;
            error.code = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
            error.currentVersion = actualVersion;
            throw error;
          }
        }
        const payload = this._buildSavePayload(session, sessionId, resolvedParentSessionId);
        const { listFacts } = await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        if (createOnly && !persistenceContext) {
          await this.registerSessionTreeNode(userId, payload);
        }
        return { payload, listFacts };
      },
    });
  }

  async saveTurnView(
    userId,
    session = {},
    parentSessionId = "",
    { turnScopeIds = [], persistenceContext = null } = {},
  ) {
    return this._writeScopedSession(userId, session, {
      parentSessionId,
      persistenceContext,
      write: async ({ sessionId, resolvedParentSessionId, sessionDir }) => {
        const payload = this._buildSavePayload(session, sessionId, resolvedParentSessionId);
        const { listFacts } = await writeSessionTurnArtifacts({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          turnScopeIds,
          atomic: true,
        });
        return { payload, listFacts };
      },
    });
  }

  async _writeScopedSession(userId, session, { parentSessionId, persistenceContext, write }) {
    const sessionId = text(session?.sessionId);
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
        this._assertSessionParentScope(session, resolvedParentSessionId);
        const { payload, listFacts } = await write({
          sessionId,
          resolvedParentSessionId,
          sessionDir,
        });
        await this.upsertSessionSummary(userId, payload, { listFacts, persistenceContext });
        return true;
      },
      persistenceContext,
    );
  }

  _assertSessionParentScope(session, resolvedParentSessionId) {
    const entityParentSessionId = normalizeParentSessionId(session?.parentSessionId);
    if (entityParentSessionId && entityParentSessionId !== resolvedParentSessionId) {
      const error = new Error("session entity parentSessionId conflicts with resolved scope");
      error.statusCode = 409;
      error.code = SESSION_ERROR_CODE.PARENT_SESSION_SCOPE_CONFLICT;
      throw error;
    }
  }

  _buildSavePayload(session, sessionId, resolvedParentSessionId) {
    return normalizeSessionEntity(
      { ...session, sessionId, parentSessionId: resolvedParentSessionId, updatedAt: this.now() },
      { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
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
