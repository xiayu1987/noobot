/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import {
  createSessionTreeNode,
  createSessionTreePlacement,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
} from "@noobot/workspace-protocol/session-tree";
import { resolveRepairedSessionCaller } from "./session-caller-migration.js";

export const SESSION_TREE_SHAPE = Object.freeze({
  INVALID: "invalid",
  LEGACY: "legacy",
  PARENT_ONLY: "parent-only",
  CURRENT: "current",
});

export const SESSION_TREE_REJECTION = Object.freeze({
  DOCUMENT_INVALID: "document-invalid",
  IDENTITY_MISMATCH: "identity-mismatch",
  DUPLICATE_SESSION: "duplicate-session",
  PLACEMENT_INVALID: "placement-invalid",
  PARENT_MISSING: "parent-missing",
  PARENT_REJECTED: "parent-rejected",
  CYCLE: "cycle",
  DIRECTORY_MISMATCH: "directory-mismatch",
});

const LEGACY_NODE_FIELDS = Object.freeze(["children", "createdAt", "updatedAt"]);

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

function createRejections() {
  const entries = [];
  const sessionIds = new Set();
  return {
    entries,
    add(sessionId, reason, details = {}) {
      entries.push({ sessionId, reason, ...details });
      sessionIds.add(sessionId);
    },
    has: (sessionId) => sessionIds.has(sessionId),
  };
}

function rejectBrokenChains(placements, rejections, detailsOf) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [sessionId, placement] of placements) {
      const { parentSessionId } = placement;
      if (!parentSessionId || placements.has(parentSessionId)) continue;
      const reason = rejections.has(parentSessionId)
        ? SESSION_TREE_REJECTION.PARENT_REJECTED
        : SESSION_TREE_REJECTION.PARENT_MISSING;
      rejections.add(sessionId, reason, detailsOf(sessionId));
      placements.delete(sessionId);
      changed = true;
    }
  }
  const tree = { nodes: Object.fromEntries(placements) };
  const cyclic = [...placements.keys()].filter((sessionId) => {
    try {
      resolveSessionTreeChain(tree, sessionId);
      return false;
    } catch {
      return true;
    }
  });
  for (const sessionId of cyclic) {
    rejections.add(sessionId, SESSION_TREE_REJECTION.CYCLE, detailsOf(sessionId));
    placements.delete(sessionId);
  }
  if (cyclic.length) rejectBrokenChains(placements, rejections, detailsOf);
}

function acceptPlacement(placements, rejections, candidate, details = {}) {
  try {
    const placement = createSessionTreePlacement(candidate);
    placements.set(placement.sessionId, placement);
  } catch {
    rejections.add(candidate.sessionId, SESSION_TREE_REJECTION.PLACEMENT_INVALID, details);
  }
}

export function listSessionTreePlacements(tree) {
  const placements = new Map();
  const rejections = createRejections();
  for (const [sessionId, node] of Object.entries(tree.nodes)) {
    acceptPlacement(placements, rejections, { sessionId, parentSessionId: node.parentSessionId });
  }
  rejectBrokenChains(placements, rejections, () => ({}));
  const placed = { nodes: Object.fromEntries(placements) };
  return {
    placements: [...placements.values()].map((placement) => ({
      ...placement,
      segments: resolveSessionDirSegments(placed, placement.sessionId),
    })),
    rejected: rejections.entries,
  };
}

export function buildSessionTree(entries) {
  const nodes = {};
  const repairedCallers = [];
  for (const { sessionId, parentSessionId, document } of entries) {
    const { caller, repaired } = resolveRepairedSessionCaller(document);
    if (repaired) repairedCallers.push(sessionId);
    nodes[sessionId] = createSessionTreeNode({ sessionId, parentSessionId, caller });
  }
  return { tree: { nodes }, repairedCallers };
}

function sameSegments(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function rebuildSessionTree(sessionDocuments) {
  const rejections = createRejections();
  const located = new Map();
  for (const { segments, document } of sessionDocuments) {
    const sessionId = segments.at(-1);
    if (!isPlainObject(document)) {
      rejections.add(sessionId, SESSION_TREE_REJECTION.DOCUMENT_INVALID, { segments });
    } else if (document.sessionId !== sessionId) {
      rejections.add(sessionId, SESSION_TREE_REJECTION.IDENTITY_MISMATCH, { segments });
    } else if (located.has(sessionId) || rejections.has(sessionId)) {
      rejections.add(sessionId, SESSION_TREE_REJECTION.DUPLICATE_SESSION, { segments });
      const first = located.get(sessionId);
      if (first) {
        rejections.add(sessionId, SESSION_TREE_REJECTION.DUPLICATE_SESSION, {
          segments: first.segments,
        });
        located.delete(sessionId);
      }
    } else {
      located.set(sessionId, { segments, document });
    }
  }
  const detailsOf = (sessionId) => ({ segments: located.get(sessionId).segments });
  const placements = new Map();
  for (const [sessionId, { document }] of located) {
    acceptPlacement(
      placements,
      rejections,
      { sessionId, parentSessionId: document.parentSessionId },
      detailsOf(sessionId),
    );
  }
  rejectBrokenChains(placements, rejections, detailsOf);
  const placed = { nodes: Object.fromEntries(placements) };
  const misplaced = [...placements.keys()].filter(
    (sessionId) =>
      !sameSegments(resolveSessionTreeChain(placed, sessionId), detailsOf(sessionId).segments),
  );
  for (const sessionId of misplaced) {
    rejections.add(sessionId, SESSION_TREE_REJECTION.DIRECTORY_MISMATCH, detailsOf(sessionId));
    placements.delete(sessionId);
  }
  rejectBrokenChains(placements, rejections, detailsOf);
  const entries = [...placements.values()].map((placement) => ({
    ...placement,
    document: located.get(placement.sessionId).document,
  }));
  return { ...buildSessionTree(entries), rejected: rejections.entries };
}
