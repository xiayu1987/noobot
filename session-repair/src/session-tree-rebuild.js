/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "./repair-primitives.js";

export const SESSION_TREE_UNRECOVERABLE = "SESSION_TREE_UNRECOVERABLE";

function unrecoverable(message) {
  const failure = new Error(message);
  failure.code = SESSION_TREE_UNRECOVERABLE;
  return failure;
}

function treeNodes(tree) {
  return tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
}

export function isLegacySessionTree(tree) {
  return (
    Boolean(tree) &&
    ("roots" in tree ||
      "updatedAt" in tree ||
      Object.values(treeNodes(tree)).some(
        (node) => node && ("children" in node || "createdAt" in node || "updatedAt" in node),
      ))
  );
}

export function mapLegacySessionTree(tree) {
  return {
    nodes: Object.fromEntries(
      Object.entries(treeNodes(tree)).map(([sessionId, node]) => [
        sessionId,
        { sessionId, parentSessionId: text(node?.parentSessionId) },
      ]),
    ),
  };
}

export function rebuildSessionTree(sessionDocuments = []) {
  const nodes = {};
  for (const { directoryName, document } of sessionDocuments) {
    const sessionId = text(document?.sessionId);
    if (!sessionId || sessionId !== text(directoryName)) {
      throw unrecoverable(`session document identity does not match directory: ${directoryName}`);
    }
    if (typeof (document.parentSessionId ?? "") !== "string") {
      throw unrecoverable(`session document parentSessionId is invalid: ${sessionId}`);
    }
    nodes[sessionId] = { sessionId, parentSessionId: text(document.parentSessionId) };
  }
  for (const node of Object.values(nodes)) {
    if (node.parentSessionId && !nodes[node.parentSessionId]) {
      throw unrecoverable(
        `session parent is missing: ${node.sessionId} -> ${node.parentSessionId}`,
      );
    }
  }
  return { nodes };
}
