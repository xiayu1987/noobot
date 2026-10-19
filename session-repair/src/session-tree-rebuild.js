/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import {
  createSessionTreeNode,
  resolveSessionDirSegments,
} from "@noobot/workspace-protocol/session-tree";
import { resolveRepairedSessionCaller } from "./session-caller-migration.js";

export const SESSION_TREE_UNRECOVERABLE = "SESSION_TREE_UNRECOVERABLE";

export const SESSION_TREE_SHAPE = Object.freeze({
  INVALID: "invalid",
  LEGACY: "legacy",
  PARENT_ONLY: "parent-only",
  CURRENT: "current",
});

const LEGACY_NODE_FIELDS = Object.freeze(["children", "createdAt", "updatedAt"]);

function unrecoverable(message, cause) {
  const failure = new Error(message, cause ? { cause } : undefined);
  failure.code = SESSION_TREE_UNRECOVERABLE;
  return failure;
}

export function classifySessionTree(tree) {
  if (!isPlainObject(tree) || !isPlainObject(tree.nodes)) return SESSION_TREE_SHAPE.INVALID;
  const nodes = Object.values(tree.nodes);
  if (!nodes.every(isPlainObject)) return SESSION_TREE_SHAPE.INVALID;
  const legacy =
    "roots" in tree ||
    "updatedAt" in tree ||
    nodes.some((node) => LEGACY_NODE_FIELDS.some((field) => field in node));
  if (legacy) return SESSION_TREE_SHAPE.LEGACY;
  if (nodes.every((node) => "caller" in node)) return SESSION_TREE_SHAPE.CURRENT;
  return SESSION_TREE_SHAPE.PARENT_ONLY;
}

export function listSessionTreePlacements(tree) {
  const placements = [];
  for (const [sessionId, node] of Object.entries(tree.nodes)) {
    if (typeof node.parentSessionId !== "string") {
      throw unrecoverable(`session tree parentSessionId is invalid: ${sessionId}`);
    }
    placements.push({ sessionId, parentSessionId: node.parentSessionId });
  }
  const parents = {
    nodes: Object.fromEntries(
      placements.map(({ sessionId, parentSessionId }) => [sessionId, { parentSessionId }]),
    ),
  };
  return placements.map((placement) => {
    try {
      return { ...placement, segments: resolveSessionDirSegments(parents, placement.sessionId) };
    } catch (error) {
      throw unrecoverable(`session tree placement is invalid: ${placement.sessionId}`, error);
    }
  });
}

export function buildSessionTree(entries) {
  const nodes = {};
  const repairedCallers = [];
  for (const { sessionId, parentSessionId, document } of entries) {
    const { caller, repaired } = resolveRepairedSessionCaller(document);
    if (repaired) repairedCallers.push(sessionId);
    try {
      nodes[sessionId] = createSessionTreeNode({ sessionId, parentSessionId, caller });
    } catch (error) {
      throw unrecoverable(`session tree node is invalid: ${sessionId}`, error);
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.parentSessionId && !nodes[node.parentSessionId]) {
      throw unrecoverable(
        `session parent is missing: ${node.sessionId} -> ${node.parentSessionId}`,
      );
    }
  }
  return { tree: { nodes }, repairedCallers };
}

export function rebuildSessionTree(sessionDocuments) {
  const entries = sessionDocuments.map(({ directoryName, document }) => {
    if (!isPlainObject(document) || document.sessionId !== directoryName) {
      throw unrecoverable(`session document identity does not match directory: ${directoryName}`);
    }
    if (typeof document.parentSessionId !== "string") {
      throw unrecoverable(`session document parentSessionId is invalid: ${directoryName}`);
    }
    return { sessionId: directoryName, parentSessionId: document.parentSessionId, document };
  });
  return buildSessionTree(entries);
}
