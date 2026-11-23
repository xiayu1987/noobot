/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";
import { AGENT_SCOPED_SESSION_ROOTS, isWorkspacePathSegment, WORKSPACE_LAYOUT } from "./layout.js";

export const SESSION_TOMBSTONE_ERROR = Object.freeze({
  INVALID: "SESSION_TOMBSTONE_INVALID",
  DELETION_CONFLICT: "SESSION_BRANCH_DELETION_CONFLICT",
});

export const SESSION_DELETION_STAGE = Object.freeze({
  DIRECTORIES: "directories",
  TREE: "tree",
  PLAN_PLUGINS: "plan_plugins",
  PLUGINS: "plugins",
  ATTACHMENTS: "attachments",
  SHORT_MEMORY: "short_memory",
  COMPLETE: "complete",
});

const stages = Object.values(SESSION_DELETION_STAGE).filter(
  (stage) => stage !== SESSION_DELETION_STAGE.PLAN_PLUGINS,
);
const treeRoot = WORKSPACE_LAYOUT.SESSION_DIR.split("/");
const agentRoots = AGENT_SCOPED_SESSION_ROOTS.map((root) => root.split("/"));
const pluginRoot = WORKSPACE_LAYOUT.PLUGIN_DATA_DIR.split("/");
const deletionStagingPrefix = ".session-deletion-";

export function sessionDeletionStagingName(directoryName) {
  if (!isWorkspacePathSegment(directoryName))
    throw new TypeError("branch deletion staging requires a workspace directory name");
  return `${deletionStagingPrefix}${directoryName}`;
}

export function isSessionDeletionStagingName(name) {
  return (
    name.startsWith(deletionStagingPrefix) &&
    isWorkspacePathSegment(name.slice(deletionStagingPrefix.length))
  );
}

export function requireSessionBranchDeletionExecutor(executeCleanupStage) {
  if (!isFunction(executeCleanupStage))
    throw new TypeError("branch deletion requires a cleanup executor");
}

export function sessionBranchDeletionKey(rootSessionIds) {
  if (
    !Array.isArray(rootSessionIds) ||
    !rootSessionIds.length ||
    !Array.from(rootSessionIds).every(isWorkspacePathSegment)
  )
    throw new TypeError("branch deletion requires workspace session ids");
  return JSON.stringify([...new Set(rootSessionIds)].sort());
}

export function advanceSessionBranchDeletion(operation, completedStage) {
  if (!isPlainObject(operation)) {
    throw Object.assign(new TypeError("branch deletion operation is missing"), {
      code: SESSION_TOMBSTONE_ERROR.INVALID,
    });
  }
  if (operation.nextStage !== completedStage) {
    throw Object.assign(new Error("branch deletion stage does not match the persisted operation"), {
      code: SESSION_TOMBSTONE_ERROR.DELETION_CONFLICT,
      statusCode: 409,
      details: { completedStage, nextStage: operation.nextStage },
    });
  }
  const index = stages.indexOf(operation.nextStage);
  const nextStage = stages[index + 1];
  if (index < 0 || nextStage === undefined)
    throw new TypeError("branch deletion stage cannot advance");
  return { ...operation, nextStage };
}

function isDeletionTarget(target) {
  if (!isPlainObject(target) || Object.keys(target).length !== 2) return false;
  const { sessionId, directory } = target;
  if (
    !Array.isArray(directory) ||
    !Array.from(directory).every(isWorkspacePathSegment) ||
    !isWorkspacePathSegment(sessionId)
  )
    return false;
  const inCore =
    directory.at(-1) === sessionId &&
    [treeRoot, ...agentRoots].some(
      (root) =>
        directory.length > root.length &&
        root.every((segment, index) => directory[index] === segment) &&
        (root === treeRoot || directory.length === root.length + 1),
    );
  const inPlugin =
    directory.length >= pluginRoot.length + 3 &&
    pluginRoot.every((segment, index) => directory[index] === segment);
  return inCore || inPlugin;
}

function isBranchDeletion(key, operation, sessions) {
  if (!isPlainObject(operation)) return false;
  const { targets, nextStage, pluginHandlerIds } = operation;
  if (
    !stages.includes(nextStage) ||
    Object.keys(operation).length !== 3 ||
    !Array.isArray(targets) ||
    !Array.from(targets).every(isDeletionTarget)
  )
    return false;
  if (
    !Array.isArray(pluginHandlerIds) ||
    !Array.from(pluginHandlerIds).every(isCanonicalText) ||
    new Set(pluginHandlerIds).size !== pluginHandlerIds.length
  )
    return false;
  const targetsById = new Set(targets.map(({ sessionId }) => sessionId));
  if (
    targetsById.size !== targets.length ||
    new Set(targets.map(({ directory }) => directory.join("/"))).size !== targets.length ||
    [...targetsById].some((id) => !Object.hasOwn(sessions, id))
  )
    return false;
  try {
    const roots = JSON.parse(key);
    return sessionBranchDeletionKey(roots) === key && roots.every((id) => targetsById.has(id));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return false;
    throw error;
  }
}

export function sessionTombstoneBranchDeletions(tombstone) {
  return Object.hasOwn(tombstone, "branchDeletions") ? tombstone.branchDeletions : {};
}

export function requireBranchDeletionDirectoriesAvailable(state, targets) {
  for (const [deletionKey, operation] of Object.entries(sessionTombstoneBranchDeletions(state))) {
    if (operation.nextStage !== SESSION_DELETION_STAGE.DIRECTORIES) continue;
    assertNoDirectoryOverlap(targets, operation.targets, deletionKey);
  }
}

function assertNoDirectoryOverlap(targets, pendingTargets, deletionKey) {
  for (const { sessionId, directory } of targets) {
    const existing = pendingTargets.find(({ directory: pending }) => {
      const sharedLength = Math.min(directory.length, pending.length);
      return directory.slice(0, sharedLength).every((segment, index) => segment === pending[index]);
    });
    if (!existing) continue;
    throw Object.assign(new Error("An unfinished branch deletion owns the requested directory"), {
      code: SESSION_TOMBSTONE_ERROR.DELETION_CONFLICT,
      statusCode: 409,
      details: { sessionId, deletionKey, pendingSessionId: existing.sessionId },
    });
  }
}

export function requireSessionTombstoneSessions(tombstone, details) {
  const sessions = isPlainObject(tombstone) ? tombstone.sessions : undefined;
  const valid =
    isPlainObject(sessions) &&
    Object.entries(sessions).every(
      ([sessionId, deletedAt]) => isWorkspacePathSegment(sessionId) && Number.isFinite(deletedAt),
    ) &&
    isPlainObject(sessionTombstoneBranchDeletions(tombstone)) &&
    Object.entries(sessionTombstoneBranchDeletions(tombstone)).every(([key, operation]) =>
      isBranchDeletion(key, operation, sessions),
    );
  if (!valid) {
    const error = new TypeError(
      "session tombstone has invalid deletion markers or branch operations",
    );
    error.code = SESSION_TOMBSTONE_ERROR.INVALID;
    error.details = details;
    throw error;
  }
  return sessions;
}
