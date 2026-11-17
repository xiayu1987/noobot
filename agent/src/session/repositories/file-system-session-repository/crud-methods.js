/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  IMMUTABLE_SESSION_FORMAT_FILE,
  IMMUTABLE_SESSION_HEAD_FILE,
} from "@noobot/session-protocol/immutable-storage";
import {
  initializeImmutableSession,
  publishImmutableSessionFormat,
} from "../../session-artifact-session/immutable-session-bootstrap.js";
import { openImmutableSessionReader } from "../../session-artifact-session/immutable-session-reader.js";
import { fsMkdir, fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import {
  assertSessionScopeIdentity,
  createEmptyTurnLifecycle,
  createSessionDeletedError,
  createSessionNotFoundError,
} from "@noobot/session-protocol";
import { requireSessionCaller } from "@noobot/shared/session-caller";

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
        await using recovered = await this.recoverImmutableSessionPlacement(userId, sessionId, {
          scope,
          persistenceContext,
        });
        if (recovered) return true;
        await fsMkdir(scope.sessionDir, { recursive: true });
        const payload = this.createInitialSession({
          sessionId,
          parentSessionId: scope.resolvedParentSessionId,
          caller,
        });
        await this.createImmutableSession(userId, payload, {
          sessionId,
          scope,
          persistenceContext,
        });
        return true;
      },
      { persistenceContext },
    );
  }

  async recoverImmutableSessionPlacement(userId, sessionId, { scope, persistenceContext }) {
    const marked = await this.storageService.exists(
      path.join(scope.sessionDir, IMMUTABLE_SESSION_FORMAT_FILE),
    );
    if (
      !marked &&
      !(await this.storageService.exists(path.join(scope.sessionDir, IMMUTABLE_SESSION_HEAD_FILE)))
    ) {
      if (await this.storageService.exists(scope.sessionFile)) {
        throw Object.assign(new Error("Session storage requires an offline workspace upgrade"), {
          code: "SESSION_IMMUTABLE_STORAGE_UPGRADE_REQUIRED",
        });
      }
      return null;
    }
    const reader = await openImmutableSessionReader({
      sessionDir: scope.sessionDir,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    try {
      if (!marked) await publishImmutableSessionFormat(scope.sessionDir);
      if (!scope.registered) {
        const metadata = await reader.readMetadata();
        await this.commitSessionPlacement(userId, metadata, persistenceContext);
      }
      return reader;
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  async createImmutableSession(
    userId,
    session,
    { sessionId, scope, persistenceContext, authorityEvents = [], scopedMetadata = null },
  ) {
    assertSessionScopeIdentity({
      session,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    await initializeImmutableSession({
      sessionDir: scope.sessionDir,
      session,
      operationId: "create-session-immutable-v1",
      authorityEvents,
      outbox: authorityEvents,
      scopedMetadata,
    });
    await this.commitSessionPlacement(userId, session, persistenceContext);
  }

  createInitialSession({ sessionId, parentSessionId, caller }) {
    const createdAt = this.now();
    return normalizeSessionEntity({
      sessionId,
      parentSessionId,
      aggregateVersion: 0,
      caller: requireSessionCaller(caller),
      modelAlias: "",
      shortMemoryCheckpoint: 0,
      messages: [],
      sessionArtifactEvents: [],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      selectedConnectorIds: [],
      createdAt,
      updatedAt: createdAt,
    });
  }

  async findById(userId, sessionId, { persistenceContext } = {}) {
    return this._findCanonicalSession(userId, sessionId, {
      persistenceContext,
      read: (reader) => reader.exportSession(),
    });
  }

  async requireById(userId, sessionId, { persistenceContext }) {
    const session = await this.findById(userId, sessionId, { persistenceContext });
    if (session) return session;
    return this._throwSessionUnavailable(userId, sessionId);
  }

  async requireTurnView(userId, sessionId, { turnScopeIds, messageUids, persistenceContext }) {
    const view = await this.findTurnView(userId, sessionId, {
      turnScopeIds,
      messageUids,
      persistenceContext,
    });
    if (view) return view;
    return this._throwSessionUnavailable(userId, sessionId);
  }

  async _throwSessionUnavailable(userId, sessionId) {
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw createSessionDeletedError({ userId, sessionId });
    }
    throw createSessionNotFoundError({ userId, sessionId });
  }

  async findTurnView(userId, sessionId, { turnScopeIds, messageUids, persistenceContext }) {
    return this._findCanonicalSession(userId, sessionId, {
      persistenceContext,
      read: (reader) => reader.readTurnView({ turnScopeIds, messageUids }),
    });
  }

  async _findCanonicalSession(userId, sessionId, { persistenceContext, read }) {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope) return null;
    await using reader = await openImmutableSessionReader({
      sessionDir: scope.sessionDir,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    return await read(reader);
  }

  async readSelectedConnectorIds(userId, sessionId, { persistenceContext } = {}) {
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw createSessionDeletedError({ userId, sessionId });
    }
    const selected = await this._findCanonicalSession(userId, sessionId, {
      persistenceContext,
      read: async (reader) =>
        this.normalizeSelectedConnectorIds((await reader.readMetadata()).selectedConnectorIds),
    });
    if (selected === null) throw createSessionNotFoundError({ userId, sessionId });
    return selected;
  }

  async delete(userId, sessionId, { persistenceContext } = {}) {
    const scope = await this.requireSessionScope(userId, sessionId, persistenceContext);
    await fsRm(scope.sessionDir, { recursive: true, force: true });
    if (scope.indexed) {
      await this.removeSessionDisplaySummaries(userId, [sessionId]);
    }
  }
}

export const sessionCrudMethods = SessionCrudMethods.prototype;
