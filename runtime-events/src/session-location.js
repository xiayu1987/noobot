/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  normalizeSessionTree,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
} from "@noobot/workspace-protocol/session-tree";

function normalizeId(value) {
  return String(value ?? "").trim();
}

function userRootOf({ workspaceRoot, userId } = {}) {
  const normalizedWorkspaceRoot = normalizeId(workspaceRoot);
  const normalizedUserId = normalizeId(userId);
  if (!normalizedWorkspaceRoot || !normalizedUserId) {
    throw new TypeError("workspace session location requires workspaceRoot and userId");
  }
  return path.join(path.resolve(normalizedWorkspaceRoot), normalizedUserId);
}

async function readJsonFile(file, fallback) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
  return JSON.parse(raw);
}

async function readWorkspaceSessionTree(context = {}) {
  const userRoot = userRootOf(context);
  return normalizeSessionTree(
    await readJsonFile(path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TREE_FILE), { nodes: {} }),
  );
}

async function readWorkspaceSessionTombstones(context = {}) {
  const userRoot = userRootOf(context);
  const marker = await readJsonFile(path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE), {
    sessions: {},
  });
  return marker?.sessions && typeof marker.sessions === "object" ? marker.sessions : {};
}

export async function resolveWorkspaceSessionLocation({
  workspaceRoot,
  userId,
  sessionId,
  parentSessionId = "",
} = {}) {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId) throw new TypeError("workspace session location requires sessionId");
  const context = { workspaceRoot, userId };
  const userRoot = userRootOf(context);
  const tombstones = await readWorkspaceSessionTombstones(context);
  const tree = await readWorkspaceSessionTree(context);
  const node = tree.nodes[normalizedSessionId];
  const normalizedParentSessionId = normalizeId(parentSessionId);
  if (!node) {
    const declared = [normalizedSessionId, normalizedParentSessionId].filter(Boolean);
    return declared.some((declaredId) => Object.hasOwn(tombstones, declaredId))
      ? { deleted: true }
      : { missingSession: true };
  }
  const chain = resolveSessionTreeChain(tree, normalizedSessionId);
  if (chain.some((chainSessionId) => Object.hasOwn(tombstones, chainSessionId))) {
    return { deleted: true };
  }
  if (normalizedParentSessionId && normalizedParentSessionId !== node.parentSessionId) {
    throw new Error(
      `session ${normalizedSessionId} is registered under "${node.parentSessionId}", not "${normalizedParentSessionId}"`,
    );
  }
  const sessionDir = path.join(userRoot, ...resolveSessionDirSegments(tree, normalizedSessionId));
  if (!(await isPersistedSessionDir(sessionDir))) return { missingSession: true };
  return { sessionDir };
}

async function isPersistedSessionDir(sessionDir) {
  try {
    return (await fs.stat(path.join(sessionDir, "session.json"))).isFile();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}
