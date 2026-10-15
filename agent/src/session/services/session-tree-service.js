/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  collectSessionTreeBranch,
  resolveSessionTreeDepth,
} from "@noobot/workspace-protocol/session-tree";
import { text } from "@noobot/shared/value";

export class SessionTreeService {
  constructor({ sessionRepo, treeRepo } = {}) {
    this.sessionRepo = sessionRepo;
    this.treeRepo = treeRepo;
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    return this.sessionRepo.registerSessionTreeNode(userId, sessionId, parentSessionId);
  }

  async getSessionTree({ userId }) {
    return this.treeRepo.getTree(userId);
  }

  async getRootSessionId({ userId, sessionId }) {
    const tree = await this.treeRepo.getTree(userId);
    return this.treeRepo.resolveRootSessionIdFromTree(sessionId, tree);
  }

  collectBranchSessionIds(sessionId = "", sessionTree = null) {
    return collectSessionTreeBranch(sessionTree, sessionId);
  }

  resolveDepthInTree(sessionId = "", sessionTree = null) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId || !sessionTree?.nodes?.[normalizedSessionId]) return 0;
    return resolveSessionTreeDepth(sessionTree, normalizedSessionId);
  }

  async deleteSessionBranch({ userId, sessionId }) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }

    const plannedTree = await this.treeRepo.getTree(userId);
    const toDelete = this.collectBranchSessionIds(normalizedSessionId, plannedTree);

    const deletedSessionIds = [];
    await this.sessionRepo.withSessionLifecycleMutations(userId, toDelete, async () => {
      await this.sessionRepo.markSessionsDeleted(userId, toDelete);
      for (const id of toDelete) {
        await this.sessionRepo.delete(userId, id);
        deletedSessionIds.push(id);
      }
      await this.treeRepo.withLock(userId, async () => {
        const sessionTree = await this.treeRepo.getTree(userId);
        const deleteSet = new Set([
          ...deletedSessionIds,
          ...this.collectBranchSessionIds(normalizedSessionId, sessionTree),
        ]);
        const nextNodes = {};
        for (const [id, node] of Object.entries(sessionTree.nodes)) {
          if (!deleteSet.has(id)) nextNodes[id] = node;
        }
        await this.treeRepo.saveTree(userId, { nodes: nextNodes });
      });
    });

    return {
      ok: true,
      sessionId: normalizedSessionId,
      deletedSessionIds,
    };
  }
}
