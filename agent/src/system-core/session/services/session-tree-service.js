/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";

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
    if (!sessionId) return;
    await this.treeRepo.withLock(userId, async () => {
      const sessionTree = await this.treeRepo.getTree(userId);
      const now = this.now();
      const normalizedSessionId = String(sessionId || "").trim();
      const normalizedParentSessionId = String(parentSessionId || "").trim();

      if (!sessionTree.nodes[normalizedSessionId]) {
        sessionTree.nodes[normalizedSessionId] = {
          sessionId: normalizedSessionId,
          parentSessionId: normalizedParentSessionId,
          children: [],
          createdAt: now,
          updatedAt: now,
        };
      } else {
        sessionTree.nodes[normalizedSessionId].parentSessionId =
          normalizedParentSessionId;
        sessionTree.nodes[normalizedSessionId].updatedAt = now;
        if (!Array.isArray(sessionTree.nodes[normalizedSessionId].children)) {
          sessionTree.nodes[normalizedSessionId].children = [];
        }
      }

      for (const [nodeId, node] of Object.entries(sessionTree.nodes || {})) {
        if (nodeId === normalizedParentSessionId) continue;
        const children = Array.isArray(node?.children) ? node.children : [];
        sessionTree.nodes[nodeId].children = children.filter(
          (childId) => String(childId || "").trim() !== normalizedSessionId,
        );
      }

      if (normalizedParentSessionId) {
        if (!sessionTree.nodes[normalizedParentSessionId]) {
          throw fatalSystemError(
            `${tSystem("session.parentSessionNotFoundPossiblyDeleted")}: ${normalizedParentSessionId}`,
            {
              code: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
              details: { normalizedParentSessionId },
            },
          );
        }
        const parentChildren = Array.isArray(
          sessionTree.nodes[normalizedParentSessionId].children,
        )
          ? sessionTree.nodes[normalizedParentSessionId].children
          : [];
        if (!parentChildren.includes(normalizedSessionId)) {
          parentChildren.push(normalizedSessionId);
        }
        sessionTree.nodes[normalizedParentSessionId].children = parentChildren;
        sessionTree.nodes[normalizedParentSessionId].updatedAt = now;
        sessionTree.roots = (sessionTree.roots || []).filter(
          (rootSessionId) => rootSessionId !== normalizedSessionId,
        );
        if (
          !sessionTree.roots.includes(normalizedParentSessionId) &&
          !String(
            sessionTree.nodes[normalizedParentSessionId].parentSessionId || "",
          )
        ) {
          sessionTree.roots.push(normalizedParentSessionId);
        }
      }

      await this.treeRepo.saveTree(userId, sessionTree);
    });
  }

  async getSessionTree({ userId }) {
    return this.treeRepo.getTree(userId);
  }

  async getRootSessionId({ userId, sessionId, sessionTree = null }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const tree = sessionTree && typeof sessionTree === "object"
      ? sessionTree
      : await this.treeRepo.getTree(userId);
    return this.treeRepo.resolveRootSessionIdFromTree(normalizedSessionId, tree);
  }

  async getSessionDepth({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return 0;
    const sessionTree = await this.treeRepo.getTree(userId);
    if (sessionTree?.nodes?.[normalizedSessionId]) {
      return this.treeRepo.loopSession(normalizedSessionId, sessionTree, []).length;
    }
    const session = await this.sessionRepo.findById(userId, normalizedSessionId);
    return session ? 1 : 0;
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

      const toDelete = [];
      if (nodeExists) {
        const queue = [normalizedSessionId];
        const visited = new Set();
        while (queue.length) {
          const currentId = String(queue.shift() || "").trim();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);
          toDelete.push(currentId);
          const children = Array.isArray(sessionTree?.nodes?.[currentId]?.children)
            ? sessionTree.nodes[currentId].children
            : [];
          for (const child of children) queue.push(child);
        }
      } else {
        toDelete.push(normalizedSessionId);
      }

      const deletedSessionIds = [];
      if (typeof this.sessionRepo?.markSessionsDeleted === "function") {
        await this.sessionRepo.markSessionsDeleted(userId, toDelete);
      }
      for (const id of toDelete) {
        await this.sessionRepo.delete(userId, id);
        deletedSessionIds.push(id);
      }

      if (nodeExists) {
        const deleteSet = new Set(deletedSessionIds);
        const nextNodes = {};
        for (const [id, node] of Object.entries(sessionTree?.nodes || {})) {
          if (deleteSet.has(id)) continue;
          nextNodes[id] = {
            ...node,
            children: Array.isArray(node?.children)
              ? node.children.filter((childId) => !deleteSet.has(String(childId || "").trim()))
              : [],
            updatedAt: this.now(),
          };
        }
        await this.treeRepo.saveTree(userId, {
          roots: (sessionTree?.roots || []).filter(
            (rootId) => !deleteSet.has(String(rootId || "").trim()),
          ),
          nodes: nextNodes,
          updatedAt: this.now(),
        });
      }

      return {
        ok: true,
        sessionId: normalizedSessionId,
        deletedSessionIds,
      };
    });
  }
}
