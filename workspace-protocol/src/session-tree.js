/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireSessionCaller } from "@noobot/shared/session-caller";
import { isPlainObject } from "@noobot/shared/value";
import { WORKSPACE_LAYOUT, isWorkspacePathSegment } from "./layout.js";

export const SESSION_TREE_ERROR = Object.freeze({
  INVALID_SHAPE: "SESSION_TREE_INVALID_SHAPE",
  LEGACY_SCHEMA: "SESSION_TREE_LEGACY_SCHEMA",
  SESSION_ID_REQUIRED: "SESSION_TREE_SESSION_ID_REQUIRED",
  INVALID_SESSION_ID: "SESSION_TREE_INVALID_SESSION_ID",
  NODE_MISSING: "SESSION_TREE_NODE_MISSING",
  PARENT_MISSING: "SESSION_TREE_PARENT_MISSING",
  CYCLE: "SESSION_TREE_CYCLE",
  PARENT_MISMATCH: "SESSION_TREE_PARENT_MISMATCH",
});

export const SESSION_TREE_NODE_FIELDS = Object.freeze(["sessionId", "parentSessionId", "caller"]);

function sessionTreeError(code, message, details = {}, ErrorType = Error) {
  const error = new ErrorType(message);
  error.code = code;
  error.details = details;
  return error;
}

function invalidShape(message, details = {}) {
  return sessionTreeError(SESSION_TREE_ERROR.INVALID_SHAPE, message, details, TypeError);
}

function hasExactNodeFields(node) {
  const keys = Object.keys(node);
  return (
    keys.length === SESSION_TREE_NODE_FIELDS.length &&
    SESSION_TREE_NODE_FIELDS.every((field) => keys.includes(field))
  );
}

function assertSessionTreeSchema(tree) {
  const validShape =
    isPlainObject(tree) &&
    isPlainObject(tree.nodes) &&
    Object.values(tree.nodes).every(isPlainObject);
  if (!validShape) {
    throw invalidShape(
      "session tree must be { nodes: { [sessionId]: { sessionId, parentSessionId, caller } } }",
    );
  }
  const legacyNode = Object.values(tree.nodes).some(
    (node) => "children" in node || "createdAt" in node || "updatedAt" in node,
  );
  if ("roots" in tree || "updatedAt" in tree || legacyNode) {
    throw sessionTreeError(
      SESSION_TREE_ERROR.LEGACY_SCHEMA,
      "legacy session tree fields roots/children/createdAt/updatedAt are not supported; the workspace layout upgrade maps them to parentSessionId",
      {},
      TypeError,
    );
  }
  if (Object.keys(tree).length !== 1) throw invalidShape("session tree only contains nodes");
}

function requireSessionId(value) {
  if (typeof value !== "string" || !value) {
    throw sessionTreeError(SESSION_TREE_ERROR.SESSION_ID_REQUIRED, "sessionId is required");
  }
  if (!isWorkspacePathSegment(value)) {
    throw sessionTreeError(SESSION_TREE_ERROR.INVALID_SESSION_ID, `invalid sessionId: ${value}`, {
      sessionId: value,
    });
  }
  return value;
}

function requireParentSessionId(value) {
  return value === "" ? value : requireSessionId(value);
}

export function createSessionTreePlacement({ sessionId, parentSessionId }) {
  return {
    sessionId: requireSessionId(sessionId),
    parentSessionId: requireParentSessionId(parentSessionId),
  };
}

export function createSessionTreeNode({ sessionId, parentSessionId, caller }) {
  return {
    ...createSessionTreePlacement({ sessionId, parentSessionId }),
    caller: requireSessionCaller(caller),
  };
}

export function createEmptySessionTree() {
  return { nodes: {} };
}

export function normalizeSessionTree(tree) {
  assertSessionTreeSchema(tree);
  const nodes = {};
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    if (!hasExactNodeFields(node)) {
      throw invalidShape(`session tree node must only contain ${SESSION_TREE_NODE_FIELDS}`, {
        sessionId: nodeId,
      });
    }
    if (node.sessionId !== nodeId) {
      throw invalidShape(`session tree node key must equal its sessionId: ${nodeId}`, {
        sessionId: nodeId,
      });
    }
    nodes[nodeId] = createSessionTreeNode(node);
  }
  return { nodes };
}

export function resolveSessionTreeChain(tree, sessionId) {
  const leafId = requireSessionId(sessionId);
  const nodes = tree.nodes;
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
    currentId = node.parentSessionId;
  }
  return chain.reverse();
}

export function isSessionTreeNodeRegistered(tree, sessionId) {
  return Object.hasOwn(tree.nodes, requireSessionId(sessionId));
}

export function requireSessionTreeNode(tree, sessionId) {
  const node = tree.nodes[requireSessionId(sessionId)];
  if (!node) {
    throw sessionTreeError(
      SESSION_TREE_ERROR.NODE_MISSING,
      `session tree node missing: ${sessionId}`,
      {
        sessionId,
        missingSessionId: sessionId,
      },
    );
  }
  return node;
}

export function resolveSessionTreeDepth(tree, sessionId) {
  return resolveSessionTreeChain(tree, sessionId).length;
}

export function collectSessionTreeBranch(tree, sessionId) {
  const nodes = Object.values(tree.nodes);
  const branch = [];
  const visited = new Set();
  const queue = [requireSessionId(sessionId)];
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

export function placeSessionTreeChain(tree, placement) {
  const { sessionId: leafId, parentSessionId: parentId } = createSessionTreePlacement(placement);
  const node = tree.nodes[leafId];
  if (node) {
    if (parentId !== node.parentSessionId) {
      throw sessionTreeError(
        SESSION_TREE_ERROR.PARENT_MISMATCH,
        `session ${leafId} is registered under "${node.parentSessionId}", not "${parentId}"`,
        { sessionId: leafId, parentSessionId: parentId, treeParentSessionId: node.parentSessionId },
      );
    }
    return resolveSessionTreeChain(tree, leafId);
  }
  if (!parentId) return [leafId];
  assertSessionTreeParentRegistered(tree, leafId, parentId);
  return [...resolveSessionTreeChain(tree, parentId), leafId];
}

export function assertSessionTreeParentRegistered(tree, sessionId, parentSessionId) {
  if (Object.hasOwn(tree.nodes, parentSessionId)) return;
  throw sessionTreeError(
    SESSION_TREE_ERROR.PARENT_MISSING,
    `parent session not registered: ${parentSessionId}`,
    { sessionId, parentSessionId },
  );
}

export function resolveSessionDirSegments(tree, sessionId) {
  return [WORKSPACE_LAYOUT.SESSION_DIR, ...resolveSessionTreeChain(tree, sessionId)];
}
