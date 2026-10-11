/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";

export class SessionTreeService {
  constructor({ sessionRepo, treeRepo, now = () => new Date().toISOString() } = {}) {
    this.sessionRepo = sessionRepo;
    this.treeRepo = treeRepo;
    this.now = now;
  }

  async ensureRuntimeDirs(userId) {
    await this.sessionRepo.storageService.ensureRuntimeDirsByBasePath(
      this.sessionRepo.pathResolver.resolveBasePath(userId),
    );
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    return this.treeRepo.withLock(userId, async () => {
      if (await this.sessionRepo.isSessionDeleted(userId, normalizedSessionId)) {
        return false;
      }
      const sessionTree = await this.treeRepo.getTree(userId);
      const now = this.now();
      const normalizedParentSessionId = String(parentSessionId || "").trim();

      if (
        normalizedParentSessionId &&
        (await this.sessionRepo.isSessionDeleted(userId, normalizedParentSessionId))
      ) {
        return false;
      }

      if (normalizedParentSessionId && !sessionTree.nodes[normalizedParentSessionId]) {
        throw fatalSystemError(
          `${tSystem("session.parentSessionNotFoundPossiblyDeleted")}: ${normalizedParentSessionId}`,
          {
            code: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
            details: { normalizedParentSessionId },
          },
        );
      }
      const existingNode = sessionTree.nodes[normalizedSessionId];
      sessionTree.nodes[normalizedSessionId] = {
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
        createdAt: existingNode?.createdAt || now,
        updatedAt: now,
      };

      await this.treeRepo.saveTree(userId, sessionTree);
      return true;
    });
  }

  async getSessionTree({ userId }) {
    return this.treeRepo.getTree(userId);
  }

  async getRootSessionId({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const tree = await this.treeRepo.getTree(userId);
    return this.treeRepo.resolveRootSessionIdFromTree(normalizedSessionId, tree);
  }

  collectBranchSessionIds(sessionId = "", sessionTree = null) {
    const branchSessionIds = [];
    const queue = [String(sessionId || "").trim()];
    const visited = new Set();
    while (queue.length) {
      const currentId = String(queue.shift() || "").trim();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      branchSessionIds.push(currentId);
      for (const node of Object.values(sessionTree?.nodes || {})) {
        if (node.parentSessionId === currentId) queue.push(node.sessionId);
      }
    }
    return branchSessionIds;
  }

  resolveDepthInTree(sessionId = "", sessionTree = null) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || !sessionTree?.nodes?.[normalizedSessionId]) return 0;
    return this.treeRepo.loopSession(normalizedSessionId, sessionTree, []).length;
  }

  async deleteSessionBranch({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }

    return this.treeRepo.withLock(userId, async () => {
      const sessionTree = await this.treeRepo.getTree(userId);
      const nodeExists = Boolean(sessionTree?.nodes?.[normalizedSessionId]);

      const toDelete = this.collectBranchSessionIds(normalizedSessionId, sessionTree);
      const persistedBranchIds = await this.sessionRepo.listPersistedSessionBranchIds(
        userId,
        normalizedSessionId,
      );
      for (const persistedSessionId of persistedBranchIds) {
        if (!toDelete.includes(persistedSessionId)) toDelete.push(persistedSessionId);
      }

      const deletedSessionIds = [];
      const deleteWithLifecycleLocks = async () => {
        await this.sessionRepo.markSessionsDeleted(userId, toDelete);
        for (const id of toDelete) {
          await this.sessionRepo.delete(userId, id);
          deletedSessionIds.push(id);
        }

        if (nodeExists) {
          const deleteSet = new Set(deletedSessionIds);
          const nextNodes = {};
          for (const [id, node] of Object.entries(sessionTree?.nodes || {})) {
            if (!deleteSet.has(id)) nextNodes[id] = node;
          }
          await this.treeRepo.saveTree(userId, {
            nodes: nextNodes,
            updatedAt: this.now(),
          });
        }
      };
      await this.sessionRepo.withSessionLifecycleMutations(
        userId,
        toDelete,
        deleteWithLifecycleLocks,
      );

      return {
        ok: true,
        sessionId: normalizedSessionId,
        deletedSessionIds,
      };
    });
  }
}
