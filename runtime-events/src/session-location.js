/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_HEAD_FILE,
  decodePartitionJournalHead,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  readPartitionAuthorityPublication,
  readSessionStorageAuthorityFacts,
  requirePartitionSessionAuthority,
} from "@noobot/session-protocol/session-reader";
import { lstat } from "node:fs/promises";
import { requireSessionLocationResolver } from "@noobot/session-protocol/persistence-scope";
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
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { readSessionStore } from "./session-store-reader.js";
import { resolveSessionEventWorkspace } from "./session-publication.js";

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
  const userRoot = resolveSessionEventWorkspace({ workspaceRoot, userId });
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
  const facts = await readSessionStorageAuthorityFacts({
    stat: (file) => lstat(path.join(sessionDir, file)),
    readPrefix: (file, max) => readFilePrefix(path.join(sessionDir, file), max),
  });
  if (requirePartitionSessionAuthority(facts)) {
    const { head } = await readPartitionAuthorityPublication(facts.migration, async (directory) =>
      decodePartitionJournalHead(
        await readFilePrefix(
          path.join(sessionDir, ...directory, PARTITION_JOURNAL_HEAD_FILE),
          PARTITION_JOURNAL_FRAME.controlBytes + 1,
        ),
      ),
    );
    if (head.sessionId !== sessionId)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Published partition head has the wrong session identity",
      );
    return;
  }
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Registered session authority is missing");
}
