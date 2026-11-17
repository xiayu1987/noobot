/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_SESSION_HEAD_FILE,
  decodeImmutableSessionHead,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { requireSessionLocationResolver } from "@noobot/session-protocol";
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
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { readSessionStore } from "./session-store-reader.js";

function userRootOf({ workspaceRoot, userId }) {
  const normalizedWorkspaceRoot = text(workspaceRoot);
  const normalizedUserId = text(userId);
  if (!normalizedWorkspaceRoot || !normalizedUserId) {
    throw new TypeError("workspace session location requires workspaceRoot and userId");
  }
  return path.join(path.resolve(normalizedWorkspaceRoot), normalizedUserId);
}

export async function readWorkspaceSessionTree(userRoot) {
  const file = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  return readSessionStore(file, parseWorkspaceSessionTree);
}

export async function readWorkspaceSessionTombstones(userRoot) {
  const file = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  return readSessionStore(file, parseWorkspaceSessionTombstones);
}

export async function resolveWorkspaceSessionLocation({
  workspaceRoot,
  userId,
  sessionId,
  locationResolver,
}) {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) throw new TypeError("workspace session location requires sessionId");
  const userRoot = userRootOf({ workspaceRoot, userId });
  const tombstones = await readWorkspaceSessionTombstones(userRoot);
  if (Object.hasOwn(tombstones, normalizedSessionId)) return { deleted: true };
  const location =
    locationResolver === undefined
      ? await locateTreeSession(userRoot, normalizedSessionId, tombstones)
      : await requireSessionLocationResolver(locationResolver).locateSessionScope(
          userId,
          normalizedSessionId,
        );
  if (location === null || location?.missingSession) return { missingSession: true };
  if (location?.deleted) return { deleted: true };
  const sessionDir = location?.sessionDir;
  if (typeof sessionDir !== "string" || !path.isAbsolute(sessionDir))
    throw new TypeError("Session location requires an absolute session directory");
  const relative = path.relative(userRoot, sessionDir);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new TypeError("Session location escapes its user workspace");
  await requirePersistedSessionDir(sessionDir, normalizedSessionId);
  return { sessionDir };
}

async function locateTreeSession(userRoot, normalizedSessionId, tombstones) {
  const tree = await readWorkspaceSessionTree(userRoot);
  if (!isSessionTreeNodeRegistered(tree, normalizedSessionId)) return { missingSession: true };
  const chain = resolveSessionTreeChain(tree, normalizedSessionId);
  if (chain.some((chainSessionId) => Object.hasOwn(tombstones, chainSessionId))) {
    return { deleted: true };
  }
  const sessionDir = path.join(userRoot, ...resolveSessionDirSegments(tree, normalizedSessionId));
  return { sessionDir };
}

async function requirePersistedSessionDir(sessionDir, sessionId) {
  let raw;
  try {
    raw = (
      await readFilePrefix(
        path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE),
        LENGTH_THRESHOLDS.immutableStorage.headBytes + 1,
      )
    ).toString("utf8");
  } catch (cause) {
    throw immutableStorageError("Registered session head cannot be read", cause);
  }
  decodeImmutableSessionHead(raw, sessionId);
}
