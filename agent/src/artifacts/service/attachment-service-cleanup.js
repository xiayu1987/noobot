/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { readdir } from "node:fs/promises";

import { fsRm } from "../../shared/storage/fs-adapter.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { attachScopedRoot } from "./attachment-storage-layout.js";

export async function deleteScopedAttachmentsBySessionIds(
  service,
  { userId, sessionIds = [] } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopedRoot = attachScopedRoot(basePath);
  const normalizedIds = [
    ...new Set(
      (Array.isArray(sessionIds) ? sessionIds : []).map((sid) => safeStr(sid)).filter(Boolean),
    ),
  ];
  if (!normalizedIds.length) return { deletedSessionIds: [], deletedCount: 0 };

  const deleted = [];
  for (const sid of normalizedIds) {
    await fsRm(path.join(scopedRoot, sid), { recursive: true, force: true });
    deleted.push(sid);
  }
  return { deletedSessionIds: deleted, deletedCount: deleted.length };
}

export async function pruneOrphanScopedAttachments(
  service,
  { userId, keepSessionIds = [], attachmentSources = [] } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopedRoot = attachScopedRoot(basePath);
  const sourceSet = new Set(
    (Array.isArray(attachmentSources) ? attachmentSources : [])
      .map((source) => safeStr(source).toLowerCase())
      .filter(Boolean),
  );
  const keepSet = new Set(
    (Array.isArray(keepSessionIds) ? keepSessionIds : [])
      .map((sid) => safeStr(sid))
      .filter(Boolean),
  );

  let sessionEntries = [];
  try {
    sessionEntries = await readdir(scopedRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return { deletedSessionIds: [], deletedCount: 0 };
    }
    throw error;
  }

  const deletedSessionIds = [];
  for (const entry of sessionEntries) {
    if (!entry?.isDirectory?.()) continue;
    const sessionId = safeStr(entry?.name);
    if (!sessionId || keepSet.has(sessionId)) continue;
    const sessionPath = path.join(scopedRoot, sessionId);
    if (!sourceSet.size) {
      await fsRm(sessionPath, { recursive: true, force: true });
      deletedSessionIds.push(sessionId);
      continue;
    }

    let sourceEntries = [];
    try {
      sourceEntries = await readdir(sessionPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        continue;
      }
      throw error;
    }
    let deletedAnySource = false;
    for (const sourceEntry of sourceEntries) {
      if (!sourceEntry?.isDirectory?.()) continue;
      const sourceName = safeStr(sourceEntry?.name).toLowerCase();
      if (!sourceName || !sourceSet.has(sourceName)) continue;
      await fsRm(path.join(sessionPath, sourceEntry.name), { recursive: true, force: true });
      deletedAnySource = true;
    }
    if (deletedAnySource) {
      await fsRm(sessionPath, { recursive: false, force: true });
      deletedSessionIds.push(sessionId);
    }
  }

  return { deletedSessionIds, deletedCount: deletedSessionIds.length };
}
