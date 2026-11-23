/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { collectSessionTreeBranches } from "@noobot/workspace-protocol/session-tree";
import {
  requireSessionBranchDeletionExecutor,
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";

const STAGE = SESSION_DELETION_STAGE;

function deletionDirectories(targets) {
  return targets
    .map(({ directory }) => directory)
    .sort((left, right) => right.length - left.length);
}

export class SessionTreeService {
  constructor({ sessionRepo, treeRepo, scopedSessionRoots } = {}) {
    this.sessionRepo = sessionRepo;
    this.treeRepo = treeRepo;
    this.scopedSessionRoots = scopedSessionRoots;
  }

  async getSessionTree({ userId }) {
    return this.treeRepo.getTree(userId);
  }

  async getRootSessionId({ userId, sessionId }) {
    const tree = await this.treeRepo.getTree(userId);
    return this.treeRepo.resolveRootSessionIdFromTree(sessionId, tree);
  }

  async planSessionBranchDeletion(userId, rootSessionIds) {
    const sessionTree = await this.treeRepo.getTree(userId);
    const agentScopes = await this.sessionRepo.listDeclaredSessionScopes(
      userId,
      this.scopedSessionRoots,
    );
    const scopedSessions = Array.from(agentScopes, ([sessionId, { parentSessionId }]) => ({
      sessionId,
      parentSessionId,
    }));
    const ids = collectSessionTreeBranches(sessionTree, rootSessionIds, scopedSessions);
    return new Map(
      ids.map((id) => [
        id,
        this.sessionRepo.resolveSessionPersistenceContext(userId, id, { sessionTree, agentScopes }),
      ]),
    );
  }

  async recordBranchDeletion(userId, key, roots, executeCleanupStage) {
    for (const root of roots) await this.sessionRepo.assertSessionWritable(userId, root);
    let branch = await this.planSessionBranchDeletion(userId, roots);
    for (;;) {
      const planned = [...branch.keys()];
      const recorded = await this.sessionRepo.withSessionLifecycleMutations(
        userId,
        planned,
        async () => {
          for (const root of roots) await this.sessionRepo.assertSessionWritable(userId, root);
          const locked = await this.planSessionBranchDeletion(userId, roots);
          if (branch.size !== locked.size || [...locked.keys()].some((id) => !branch.has(id))) {
            branch = locked;
            return null;
          }
          const targets = [];
          for (const [sessionId, persistenceContext] of locked) {
            targets.push(
              await this.sessionRepo.resolveSessionDeletionTarget(
                userId,
                sessionId,
                persistenceContext,
              ),
            );
          }
          const pluginHandlerIds = await executeCleanupStage({
            userId,
            deletionKey: key,
            stage: STAGE.PLAN_PLUGINS,
            deletedSessionIds: planned,
          });
          return this.sessionRepo.recordSessionBranchDeletion(
            userId,
            key,
            targets,
            pluginHandlerIds,
          );
        },
      );
      if (recorded) return recorded;
    }
  }

  async deleteSessionBranch({ userId, sessionIds }, executeCleanupStage) {
    requireSessionBranchDeletionExecutor(executeCleanupStage);
    if (!Array.isArray(sessionIds) || !sessionIds.length) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    const key = sessionBranchDeletionKey(sessionIds);
    return this.sessionRepo.withSessionBranchDeletion(userId, key, async () => {
      let operation = await this.sessionRepo.readSessionBranchDeletion(userId, key);
      if (!operation)
        operation = await this.recordBranchDeletion(
          userId,
          key,
          [...new Set(sessionIds)],
          executeCleanupStage,
        );
      const deletedSessionIds = operation.targets.map(({ sessionId }) => sessionId);
      if (operation.nextStage === STAGE.DIRECTORIES) {
        await this.sessionRepo.releaseDeletedSessionReads(userId, operation.targets);
        for (const directory of deletionDirectories(operation.targets)) {
          await this.sessionRepo.removeDeletedSessionDirectory(userId, directory);
        }
        operation = await this.sessionRepo.advanceSessionBranchDeletion(
          userId,
          key,
          operation.nextStage,
        );
      }
      if (operation.nextStage === STAGE.TREE) {
        const deleting = new Set(deletedSessionIds);
        await this.treeRepo.updateTree(userId, ({ nodes }) => ({
          nodes: Object.fromEntries(Object.entries(nodes).filter(([id]) => !deleting.has(id))),
        }));
        operation = await this.sessionRepo.advanceSessionBranchDeletion(
          userId,
          key,
          operation.nextStage,
        );
      }
      while (operation.nextStage !== STAGE.COMPLETE) {
        await executeCleanupStage({
          userId,
          deletionKey: key,
          stage: operation.nextStage,
          deletedSessionIds,
          pluginHandlerIds: operation.pluginHandlerIds,
        });
        operation = await this.sessionRepo.advanceSessionBranchDeletion(
          userId,
          key,
          operation.nextStage,
        );
      }
      return { ok: true, deletedSessionIds };
    });
  }
}
