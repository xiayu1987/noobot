/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { collectSessionTreeBranch } from "@noobot/workspace-protocol/session-tree";
import { text } from "@noobot/shared/value";

export class SessionTreeService {
  constructor({ sessionRepo, treeRepo } = {}) {
    this.sessionRepo = sessionRepo;
    this.treeRepo = treeRepo;
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

  collectBranchesSessionIds(rootSessionIds = [], sessionTree = null) {
    const collected = new Set();
    for (const rootSessionId of rootSessionIds) {
      for (const id of this.collectBranchSessionIds(rootSessionId, sessionTree)) {
        collected.add(id);
      }
    }
    return [...collected];
  }

  async deleteSessionBranch({ userId, sessionIds }) {
    const rootSessionIds = Array.isArray(sessionIds)
      ? [...new Set(sessionIds.map((id) => text(id)))]
      : [];
    if (!rootSessionIds.length || rootSessionIds.some((id) => !id)) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }

    let toDelete = this.collectBranchesSessionIds(
      rootSessionIds,
      await this.treeRepo.getTree(userId),
    );
    let deletedSessionIds = null;
    while (!deletedSessionIds) {
      const planned = toDelete;
      deletedSessionIds = await this.sessionRepo.withSessionLifecycleMutations(
        userId,
        planned,
        async () => {
          const lockedBranch = this.collectBranchesSessionIds(
            rootSessionIds,
            await this.treeRepo.getTree(userId),
          );
          const plannedSet = new Set(planned);
          if (lockedBranch.some((id) => !plannedSet.has(id))) {
            toDelete = [...new Set([...planned, ...lockedBranch])];
            return null;
          }
          await this.sessionRepo.markSessionsDeleted(userId, planned);
          for (const id of planned) {
            await this.sessionRepo.delete(userId, id, {
              persistenceContext: this.sessionRepo.treePersistenceContext(userId, id),
            });
          }
          await this.treeRepo.withLock(userId, async () => {
            const sessionTree = await this.treeRepo.getTree(userId);
            const nextNodes = {};
            for (const [id, node] of Object.entries(sessionTree.nodes)) {
              if (!plannedSet.has(id)) nextNodes[id] = node;
            }
            await this.treeRepo.saveTree(userId, { nodes: nextNodes });
          });
          return planned;
        },
      );
    }

    return {
      ok: true,
      deletedSessionIds,
    };
  }
}
