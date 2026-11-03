/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { AGENT_SCOPED_SESSION_ROOTS } from "@noobot/workspace-protocol";
import { assertSessionScopeIdentity } from "@noobot/session-protocol";
import { tSystem } from "noobot-i18n/agent/system-text";
import { fatalSystemError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { fsReaddir } from "../../../shared/storage/fs-adapter.js";
import {
  createPersistenceContext,
  ScopedSessionLocationResolver,
} from "../../session-location-resolver.js";
import { buildSessionArtifactFileMap } from "../../session-artifact-store.js";
import { sessionTreeNodeMissingError } from "./access-methods.js";

function persistenceOwnerConflictError(sessionId, owners) {
  return fatalSystemError(`${tSystem("session.persistenceOwnerConflict")}: ${sessionId}`, {
    code: ERROR_CODE.FATAL_SESSION_PERSISTENCE_OWNER_CONFLICT,
    details: { sessionId, owners },
  });
}

class AgentSessionMethods {
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
    const files = buildSessionArtifactFileMap(path.join(basePath, relativeDir));
    const session = await this.storageService.readOptionalJson(files.session);
    if (session === null) return null;
    assertSessionScopeIdentity({ session, sessionId, parentSessionId: session.parentSessionId });
    const locationResolver = new ScopedSessionLocationResolver({
      pathResolver: this.pathResolver,
      userId,
      sessionId,
      parentSessionId: session.parentSessionId,
      scopeId: `agent:${sessionId}`,
      relativeDir,
      allowedRoot,
    });
    return {
      allowedRoot,
      parentSessionId: session.parentSessionId,
      persistenceContext: createPersistenceContext({ locationResolver }),
    };
  }

  async _collectAgentRootScopes(userId, allowedRoot, scopes) {
    const entries = await this._listAgentRootEntries(userId, allowedRoot);
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const scope = await this._readAgentSessionScope(userId, allowedRoot, entry.name);
      if (scope === null) continue;
      const existing = scopes.get(entry.name);
      if (existing) {
        throw persistenceOwnerConflictError(entry.name, [existing.allowedRoot, allowedRoot]);
      }
      scopes.set(entry.name, scope);
    }
  }

  async listAgentSessionScopes(userId) {
    const scopes = new Map();
    for (const allowedRoot of AGENT_SCOPED_SESSION_ROOTS) {
      await this._collectAgentRootScopes(userId, allowedRoot, scopes);
    }
    return scopes;
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
