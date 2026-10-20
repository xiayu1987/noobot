/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import {
  parseWorkspaceSessionTombstones,
  parseWorkspaceSessionTree,
} from "@noobot/workspace-protocol/session-store";
import {
  isSessionTreeNodeRegistered,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
} from "@noobot/workspace-protocol/session-tree";
import { text } from "@noobot/shared/value";

function userRootOf({ workspaceRoot, userId }) {
  const normalizedWorkspaceRoot = text(workspaceRoot);
  const normalizedUserId = text(userId);
  if (!normalizedWorkspaceRoot || !normalizedUserId) {
    throw new TypeError("workspace session location requires workspaceRoot and userId");
  }
  return path.join(path.resolve(normalizedWorkspaceRoot), normalizedUserId);
}

async function readTextOrNull(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

export async function readWorkspaceSessionTree(userRoot) {
  const file = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  return parseWorkspaceSessionTree({ raw: await readTextOrNull(file), file });
}

export async function readWorkspaceSessionTombstones(userRoot) {
  const file = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  return parseWorkspaceSessionTombstones({ raw: await readTextOrNull(file), file });
}

export async function resolveWorkspaceSessionLocation({ workspaceRoot, userId, sessionId }) {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) throw new TypeError("workspace session location requires sessionId");
  const userRoot = userRootOf({ workspaceRoot, userId });
  const tree = await readWorkspaceSessionTree(userRoot);
  const tombstones = await readWorkspaceSessionTombstones(userRoot);
  if (Object.hasOwn(tombstones, normalizedSessionId)) return { deleted: true };
  if (!isSessionTreeNodeRegistered(tree, normalizedSessionId)) return { missingSession: true };
  const chain = resolveSessionTreeChain(tree, normalizedSessionId);
  if (chain.some((chainSessionId) => Object.hasOwn(tombstones, chainSessionId))) {
    return { deleted: true };
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
