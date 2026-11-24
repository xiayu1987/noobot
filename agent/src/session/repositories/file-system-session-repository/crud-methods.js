/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsLstat, fsMkdir, fsRename, fsRm } from "../../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../../shared/storage/durable-file.js";
import { filePath as path } from "@noobot/path-resolver";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import { assertSessionScopeIdentity, createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { requireSessionCaller } from "@noobot/shared/session-caller";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { sessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import { withSessionEventRetirement } from "@noobot/runtime-events";
import { resolveSessionArtifactMutationLock } from "../../session-artifact-files.js";

async function deletionDirectoryExists(directory) {
  try {
    if (!(await fsLstat(directory)).isDirectory())
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Deletion path is not a directory");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeSessionArtifactMutationLock(sessionDir) {
  const lock = resolveSessionArtifactMutationLock(sessionDir);
  try {
    if ((await fsLstat(lock)).isFile()) await fsRm(lock);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

class SessionCrudMethods {
  async listSessionIds(userId) {
    return (await this.listLiveSessionTreeNodes(userId)).map(({ sessionId }) => sessionId);
  }

  async listLiveSessionTreeNodes(userId) {
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const deletedSessions = await this._readDeletedSessions(userId);
    return Object.values(sessionTree.nodes).filter(
      ({ sessionId }) => !Object.hasOwn(deletedSessions.sessions, sessionId),
    );
  }

  async ensureSession({ userId, sessionId, parentSessionId, caller, persistenceContext }) {
    return this.withSessionPlacementMutation(
      userId,
      { sessionId, parentSessionId },
      async (scope) => {
        await using recovered = await this.recoverSessionPlacement(userId, sessionId, {
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
        await this.createStoredSession(userId, payload, {
          sessionId,
          scope,
          persistenceContext,
        });
        return true;
      },
      { persistenceContext },
    );
  }

  async recoverSessionPlacement(userId, sessionId, { scope, persistenceContext }) {
    const reader = await this.sessionReaderAccess.recover({
      sessionDir: scope.sessionDir,
      sessionFile: scope.sessionFile,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    if (reader === null) return null;
    try {
      if (!scope.registered) {
        const metadata = await reader.readMetadata();
        await this.commitSessionPlacement(userId, metadata, persistenceContext);
      }
      return reader;
    } catch (error) {
      return withStorageCleanup(async () => {
        throw error;
      }, reader[Symbol.asyncDispose]);
    }
  }

  async createStoredSession(
    userId,
    session,
    { sessionId, scope, persistenceContext, initialTurn = null, scopedMetadata = null },
  ) {
    assertSessionScopeIdentity({
      session,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    const committed = await this.sessionReaderAccess.create(
      {
        sessionDir: scope.sessionDir,
        sessionFile: scope.sessionFile,
        sessionId,
        parentSessionId: scope.resolvedParentSessionId,
      },
      {
        session,
        operationId: "create-session-v1",
        initialTurn,
        scopedMetadata,
      },
    );
    if (!committed.aborted)
      await this.commitSessionPlacement(userId, committed.result.metadata, persistenceContext);
    return committed;
  }

  createInitialSession({ sessionId, parentSessionId, caller }) {
    const createdAt = this.now();
    return normalizeSessionEntity({
      sessionId,
      parentSessionId,
      aggregateVersion: 0,
      caller: requireSessionCaller(caller),
      modelAlias: "",
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
    await using reader = await this.findSessionReader(userId, sessionId, { persistenceContext });
    return reader ? await reader.exportSession() : null;
  }

  async requireById(userId, sessionId, { persistenceContext }) {
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    return await reader.exportSession();
  }

  async readSelectedConnectorIds(userId, sessionId, { persistenceContext } = {}) {
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    return this.normalizeSelectedConnectorIds((await reader.readMetadata()).selectedConnectorIds);
  }

  async removeDeletedSessionDirectory(userId, directory) {
    const workspacePath = this._basePath(userId);
    const sessionDir = path.join(workspacePath, ...directory);
    const parent = path.dirname(sessionDir);
    if (!(await deletionDirectoryExists(parent))) return;
    const staged = path.join(parent, sessionDeletionStagingName(directory.at(-1)));
    if (await deletionDirectoryExists(sessionDir)) {
      if (await deletionDirectoryExists(staged))
        throw partitionJournalError(
          "SESSION_STORAGE_CORRUPT",
          "Deletion has both live and staged directories",
        );
      await withSessionEventRetirement(workspacePath, () =>
        this.sessionReaderAccess.withRemoval({ sessionDir }, () => fsRename(sessionDir, staged)),
      );
    }
    if (await deletionDirectoryExists(staged)) {
      await syncStorageDirectory(parent);
      await fsRm(staged, { recursive: true });
    }
    await removeSessionArtifactMutationLock(sessionDir);
    await syncStorageDirectory(parent);
  }

  async resolveSessionDeletionTarget(userId, sessionId, persistenceContext) {
    const scope = await this.requireSessionScope(userId, sessionId, persistenceContext);
    return {
      sessionId,
      directory: path.relative(this._basePath(userId), scope.sessionDir).split(path.sep),
    };
  }
}

export const sessionCrudMethods = SessionCrudMethods.prototype;
