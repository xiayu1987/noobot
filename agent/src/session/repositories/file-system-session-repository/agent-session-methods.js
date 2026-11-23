/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { AGENT_SCOPED_SESSION_ROOTS, isWorkspacePathSegment } from "@noobot/workspace-protocol";
import {
  isSessionDeletionStagingName,
  SESSION_DELETION_STAGE,
  sessionTombstoneBranchDeletions,
} from "@noobot/workspace-protocol/session-tombstone";
import { readSessionDirectory } from "../../../workspace-lifecycle/session-directory-walk.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { fsReaddir } from "../../../shared/storage/fs-adapter.js";
import {
  createPersistenceContext,
  ScopedSessionLocationResolver,
} from "../../session-location-resolver.js";
import { sessionTreeNodeMissingError } from "./access-methods.js";

function persistenceOwnerConflictError(sessionId, owners) {
  return fatalSystemError(`${tSystem("session.persistenceOwnerConflict")}: ${sessionId}`, {
    code: ERROR_CODE.FATAL_SESSION_PERSISTENCE_OWNER_CONFLICT,
    details: { sessionId, owners },
  });
}

class AgentSessionMethods {
  _recordScopedSession(scopes, sessionId, scope) {
    const existing = scopes.get(sessionId);
    if (existing)
      throw persistenceOwnerConflictError(sessionId, [existing.relativeDir, scope.relativeDir]);
    scopes.set(sessionId, scope);
  }

  _createDeclaredSessionScope({ userId, sessionId, parentSessionId, relativeDir, allowedRoot }) {
    const locationResolver = new ScopedSessionLocationResolver({
      pathResolver: this.pathResolver,
      userId,
      sessionId,
      parentSessionId,
      relativeDir,
      allowedRoot,
    });
    return {
      allowedRoot,
      relativeDir,
      parentSessionId,
      persistenceContext: createPersistenceContext({ locationResolver }),
    };
  }

  async _listAgentRootEntries(userId, allowedRoot) {
    const basePath = this.pathResolver.resolveBasePath(userId);
    try {
      return await fsReaddir(path.join(basePath, allowedRoot), { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return [];
    }
  }

  async _readAgentSessionScope(userId, allowedRoot, sessionId) {
    const basePath = this.pathResolver.resolveBasePath(userId);
    const relativeDir = path.join(allowedRoot, sessionId);
    const sessionDir = path.join(basePath, relativeDir);
    const session = await this.sessionReaderAccess.readPlacement({ sessionDir, sessionId });
    if (session === null) return null;
    return this._createDeclaredSessionScope({
      userId,
      sessionId,
      parentSessionId: session.parentSessionId,
      relativeDir,
      allowedRoot,
    });
  }

  async _collectAgentRootScopes(userId, allowedRoot, scopes, excludedDirectories) {
    const entries = await this._listAgentRootEntries(userId, allowedRoot);
    for (const entry of entries) {
      if (!entry.isDirectory() || isSessionDeletionStagingName(entry.name)) continue;
      if (excludedDirectories.has(path.join(allowedRoot, entry.name))) continue;
      const scope = await this._readAgentSessionScope(userId, allowedRoot, entry.name);
      if (scope === null) continue;
      this._recordScopedSession(scopes, entry.name, scope);
    }
  }

  async listAgentSessionScopes(userId, excludedDirectories = new Set()) {
    const scopes = new Map();
    for (const allowedRoot of AGENT_SCOPED_SESSION_ROOTS) {
      await this._collectAgentRootScopes(userId, allowedRoot, scopes, excludedDirectories);
    }
    return scopes;
  }

  async listDeclaredSessionScopes(userId, scopedSessionRoots, excludedDirectories = new Set()) {
    const scopes = await this.listAgentSessionScopes(userId, excludedDirectories);
    const base = this.pathResolver.resolveBasePath(userId);
    const scan = async (allowedRoot, relativeDir) => {
      if (excludedDirectories.has(relativeDir)) return;
      const sessionDir = path.join(base, relativeDir);
      const { authority, children } = await readSessionDirectory(sessionDir);
      if (authority !== null) {
        const placement = await this.sessionReaderAccess.readPlacement({ sessionDir });
        if (placement !== null) {
          this._recordScopedSession(
            scopes,
            placement.sessionId,
            this._createDeclaredSessionScope({ userId, relativeDir, allowedRoot, ...placement }),
          );
        }
      }
      for (const child of children) {
        if (isWorkspacePathSegment(child.name))
          await scan(allowedRoot, path.join(relativeDir, child.name));
      }
    };
    for (const root of scopedSessionRoots) {
      if (!AGENT_SCOPED_SESSION_ROOTS.includes(root)) await scan(root, root);
    }
    return scopes;
  }

  async listExecutionSessionScopes(userId, scopedSessionRoots) {
    const deletionState = await this._readDeletedSessions(userId);
    const excludedDirectories = new Set(
      Object.values(sessionTombstoneBranchDeletions(deletionState))
        .filter(({ nextStage }) => nextStage === SESSION_DELETION_STAGE.DIRECTORIES)
        .flatMap(({ targets }) => targets.map(({ directory }) => path.join(...directory))),
    );
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const agentScopes = await this.listDeclaredSessionScopes(
      userId,
      scopedSessionRoots,
      excludedDirectories,
    );
    const { sessions: deleted } = deletionState;
    const ids = new Set([...Object.keys(sessionTree.nodes), ...agentScopes.keys()]);
    return Array.from(ids)
      .filter((sessionId) => !Object.hasOwn(deleted, sessionId))
      .map((sessionId) => ({
        sessionId,
        persistenceContext: this.resolveSessionPersistenceContext(userId, sessionId, {
          sessionTree,
          agentScopes,
        }),
      }));
  }

  resolveSessionPersistenceContext(userId, sessionId, { sessionTree, agentScopes }) {
    const scope = agentScopes.get(sessionId);
    const inTree = Object.hasOwn(sessionTree.nodes, sessionId);
    if (scope && inTree) {
      throw persistenceOwnerConflictError(sessionId, ["session-tree", scope.allowedRoot]);
    }
    if (scope) return scope.persistenceContext;
    if (inTree) return this.treePersistenceContext(userId, sessionId);
    throw sessionTreeNodeMissingError(sessionId);
  }
}

export const agentSessionMethods = AgentSessionMethods.prototype;
