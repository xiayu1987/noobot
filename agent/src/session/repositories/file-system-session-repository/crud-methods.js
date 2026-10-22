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
  assertSessionScopeIdentity,
  createEmptyTurnLifecycle,
  requireSessionAggregateVersion,
} from "@noobot/session-protocol";
import { requireSessionCaller } from "@noobot/shared/session-caller";
import { sessionTreeNodeMissingError } from "./access-methods.js";
import { text } from "@noobot/shared/value";

class SessionCrudMethods {
  async listSessionIds(userId) {
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const deletedSessions = await this._readDeletedSessions(userId);
    return Object.keys(sessionTree.nodes).filter(
      (sessionId) => !Object.hasOwn(deletedSessions.sessions, sessionId),
    );
  }

  async ensureSession({ userId, sessionId, parentSessionId, caller, persistenceContext }) {
    return this.withSessionPlacementMutation(
      userId,
      { sessionId, parentSessionId },
      async (scope) => {
        if (await this.storageService.exists(scope.sessionFile)) {
          if (scope.registered) return true;
          throw sessionTreeNodeMissingError(sessionId);
        }
        await fsMkdir(scope.sessionDir, { recursive: true });
        const payload = this.createInitialSession({
          sessionId,
          parentSessionId: scope.resolvedParentSessionId,
          caller,
        });
        const { listFacts } = await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        await this.commitSessionPlacement(userId, payload, persistenceContext);
        await this.upsertSessionSummary(userId, payload, { listFacts, scope });
        return true;
      },
      { persistenceContext },
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
      { now: this.now },
    );
  }

  async findById(userId, sessionId, { persistenceContext } = {}) {
    return this._findCanonicalSession(userId, sessionId, {
      persistenceContext,
      read: (scope) => this._readNormalizedSession(scope, sessionId),
    });
  }

  async findTurnView(userId, sessionId, { turnScopeIds = [], persistenceContext } = {}) {
    return this._findCanonicalSession(userId, sessionId, {
      persistenceContext,
      read: (scope) => this._readNormalizedTurnView(scope, sessionId, turnScopeIds),
    });
  }

  async _findCanonicalSession(userId, sessionId, { persistenceContext, read }) {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope || !(await this.storageService.exists(scope.sessionFile))) return null;
    try {
      return await read(scope);
    } catch (error) {
      try {
        await this.markSessionSummaryUnavailable(userId, sessionId, { error, scope });
      } catch (projectionError) {
        error.unavailableProjectionCause = projectionError;
      }
      throw error;
    }
  }

  async readSelectedConnectorIds(userId, sessionId, { persistenceContext } = {}) {
    if (await this.isSessionDeleted(userId, sessionId)) return [];
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope || !(await this.storageService.exists(scope.sessionFile))) return [];
    const manifest = await this.storageService.readJson(scope.sessionFile, null);
    assertSessionScopeIdentity({
      session: manifest,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    return this.normalizeSelectedConnectorIds(manifest.selectedConnectorIds);
  }

  async save(
    userId,
    session = {},
    { expectedAggregateVersion, createOnly = false, persistenceContext } = {},
  ) {
    const versionExpected =
      expectedAggregateVersion !== undefined && expectedAggregateVersion !== null;
    return this._writeScopedSession(userId, session, {
      persistenceContext,
      placement: createOnly,
      write: async ({ sessionId, scope }) => {
        const persistedForChecks =
          createOnly || versionExpected
            ? await this.findById(userId, sessionId, { persistenceContext })
            : null;
        if (createOnly && persistedForChecks) {
          const error = new Error("session already exists");
          error.statusCode = 409;
          error.code = "SESSION_ALREADY_EXISTS";
          throw error;
        }
        if (versionExpected) {
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
        const payload = this._buildSavePayload(session);
        const { listFacts } = await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        if (createOnly) await this.commitSessionPlacement(userId, payload, persistenceContext);
        return { payload, listFacts };
      },
    });
  }

  async saveTurnView(userId, session = {}, { turnScopeIds = [], persistenceContext } = {}) {
    return this._writeScopedSession(userId, session, {
      persistenceContext,
      placement: false,
      write: async ({ scope }) => {
        const payload = this._buildSavePayload(session);
        const { listFacts } = await writeSessionTurnArtifacts({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionPayload: payload,
          turnScopeIds,
          atomic: true,
        });
        return { payload, listFacts };
      },
    });
  }

  async _writeScopedSession(userId, session, { persistenceContext, placement, write }) {
    const sessionId = text(session?.sessionId);
    if (!sessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    const operation = async (scope) => {
      assertSessionScopeIdentity({
        session,
        sessionId,
        parentSessionId: scope.resolvedParentSessionId,
      });
      const { payload, listFacts } = await write({ sessionId, scope });
      await this.upsertSessionSummary(userId, payload, { listFacts, scope });
      return true;
    };
    if (placement) {
      return this.withSessionPlacementMutation(
        userId,
        { sessionId, parentSessionId: session.parentSessionId },
        operation,
        { persistenceContext },
      );
    }
    return this.withSessionMutation(userId, sessionId, operation, { persistenceContext });
  }

  _buildSavePayload(session) {
    return normalizeSessionEntity({ ...session, updatedAt: this.now() }, { now: this.now });
  }

  async delete(userId, sessionId, { persistenceContext } = {}) {
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope) return false;
    await fsRm(scope.sessionDir, { recursive: true, force: true });
    if (scope.indexed) {
      await this.removeSessionSummaries(userId, [sessionId]);
      await this.removeSessionDisplaySummaries(userId, [sessionId]);
    }
    return true;
  }
}

export const sessionCrudMethods = SessionCrudMethods.prototype;
