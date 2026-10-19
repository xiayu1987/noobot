/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { requireSessionTombstoneSessions } from "@noobot/workspace-protocol/session-tombstone";
import {
  normalizeSessionTree,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
} from "@noobot/workspace-protocol/session-tree";
import { text } from "@noobot/shared/value";

function normalizeId(value) {
  return text(value);
}

function userRootOf({ workspaceRoot, userId } = {}) {
  const normalizedWorkspaceRoot = normalizeId(workspaceRoot);
  const normalizedUserId = normalizeId(userId);
  if (!normalizedWorkspaceRoot || !normalizedUserId) {
    throw new TypeError("workspace session location requires workspaceRoot and userId");
  }
  return path.join(path.resolve(normalizedWorkspaceRoot), normalizedUserId);
}

async function readOptionalJsonFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(raw);
}

async function readWorkspaceSessionTree(userRoot) {
  const treeFile = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  return normalizeSessionTree(JSON.parse(await fs.readFile(treeFile, "utf8")));
}

async function readWorkspaceSessionTombstones(userRoot) {
  const tombstoneFile = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  const tombstone = await readOptionalJsonFile(tombstoneFile);
  if (tombstone === null) return {};
  return requireSessionTombstoneSessions(tombstone, { persistencePath: tombstoneFile });
}

export async function resolveWorkspaceSessionLocation({
  workspaceRoot,
  userId,
  sessionId,
  parentSessionId = "",
} = {}) {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId) throw new TypeError("workspace session location requires sessionId");
  const userRoot = userRootOf({ workspaceRoot, userId });
  const tombstones = await readWorkspaceSessionTombstones(userRoot);
  const tree = await readWorkspaceSessionTree(userRoot);
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
