/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT, isWorkspacePathSegment } from "./layout.js";

export const SESSION_TREE_ERROR = Object.freeze({
  LEGACY_SCHEMA: "SESSION_TREE_LEGACY_SCHEMA",
  SESSION_ID_REQUIRED: "SESSION_TREE_SESSION_ID_REQUIRED",
  INVALID_SESSION_ID: "SESSION_TREE_INVALID_SESSION_ID",
  NODE_MISSING: "SESSION_TREE_NODE_MISSING",
  CYCLE: "SESSION_TREE_CYCLE",
  PARENT_MISMATCH: "SESSION_TREE_PARENT_MISMATCH",
});

function sessionTreeError(code, message, details = {}, ErrorType = Error) {
  const error = new ErrorType(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeId(value) {
  return String(value ?? "").trim();
}

function assertSessionTreeSchema(tree, nodes) {
  const legacyNode = Object.values(nodes).some(
    (node) => node && ("children" in node || "createdAt" in node || "updatedAt" in node),
  );
  if (tree && ("roots" in tree || "updatedAt" in tree || legacyNode)) {
    throw sessionTreeError(
      SESSION_TREE_ERROR.LEGACY_SCHEMA,
      "legacy session tree fields roots/children/createdAt/updatedAt are not supported; the workspace layout upgrade maps them to parentSessionId",
      {},
      TypeError,
    );
  }
}

export function normalizeSessionTree(tree = {}) {
  const sourceNodes = tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
  assertSessionTreeSchema(tree, sourceNodes);
  const nodes = {};
  for (const [nodeId, node] of Object.entries(sourceNodes)) {
    const sessionId = normalizeId(nodeId);
    if (!sessionId) continue;
    nodes[sessionId] = { sessionId, parentSessionId: normalizeId(node?.parentSessionId) };
  }
  return { nodes };
}

export function isSessionTreeSessionId(value) {
  return isWorkspacePathSegment(normalizeId(value));
}

function requireSessionId(value) {
  const sessionId = normalizeId(value);
  if (!sessionId) {
    throw sessionTreeError(SESSION_TREE_ERROR.SESSION_ID_REQUIRED, "sessionId is required");
  }
  if (!isWorkspacePathSegment(sessionId)) {
    throw sessionTreeError(
      SESSION_TREE_ERROR.INVALID_SESSION_ID,
      `invalid sessionId: ${sessionId}`,
      {
        sessionId,
      },
    );
  }
  return sessionId;
}

export function resolveSessionTreeChain(tree, sessionId) {
  const leafId = requireSessionId(sessionId);
  const nodes = tree?.nodes || {};
  const chain = [];
  const visited = new Set();
  let currentId = leafId;
  while (currentId) {
    if (visited.has(currentId)) {
      throw sessionTreeError(SESSION_TREE_ERROR.CYCLE, `session tree cycle at ${currentId}`, {
        sessionId: leafId,
        cycleSessionId: currentId,
      });
    }
    requireSessionId(currentId);
    const node = nodes[currentId];
    if (!node) {
      throw sessionTreeError(
        SESSION_TREE_ERROR.NODE_MISSING,
        `session tree node missing: ${currentId}`,
        { sessionId: leafId, missingSessionId: currentId },
      );
    }
    visited.add(currentId);
    chain.push(currentId);
    currentId = normalizeId(node.parentSessionId);
  }
  return chain.reverse();
}

export function resolveSessionTreeRootId(tree, sessionId) {
  return resolveSessionTreeChain(tree, sessionId)[0];
}

export function resolveSessionTreeDepth(tree, sessionId) {
  return resolveSessionTreeChain(tree, sessionId).length;
}

export function collectSessionTreeBranch(tree, sessionId) {
  const rootId = normalizeId(sessionId);
  if (!rootId) return [];
  const nodes = Object.values(tree?.nodes || {});
  const branch = [];
  const visited = new Set();
  const queue = [rootId];
  while (queue.length) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    branch.push(currentId);
    for (const node of nodes) {
      if (node.parentSessionId === currentId) queue.push(node.sessionId);
    }
  }
  return branch;
}

export function resolveSessionTreePlacement(tree, sessionId, parentSessionId = "") {
  const leafId = requireSessionId(sessionId);
  const parentId = normalizeId(parentSessionId);
  const node = tree?.nodes?.[leafId];
  if (node) {
    if (parentId && parentId !== node.parentSessionId) {
      throw sessionTreeError(
        SESSION_TREE_ERROR.PARENT_MISMATCH,
        `session ${leafId} is registered under "${node.parentSessionId}", not "${parentId}"`,
        { sessionId: leafId, parentSessionId: parentId, treeParentSessionId: node.parentSessionId },
      );
    }
    return resolveSessionTreeChain(tree, leafId);
  }
  if (!parentId) return [leafId];
  requireSessionId(parentId);
  return [...resolveSessionTreeChain(tree, parentId), leafId];
}

export function resolveSessionDirSegments(tree, sessionId) {
  return [WORKSPACE_LAYOUT.SESSION_DIR, ...resolveSessionTreeChain(tree, sessionId)];
}
