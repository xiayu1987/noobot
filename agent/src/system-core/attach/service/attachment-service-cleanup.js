/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { readdir } from "node:fs/promises";

import { fsRm } from "../../store/fs-adapter.js";
import { safeStr } from "../../utils/shared-utils.js";
import { DEFAULT_ATTACHMENT_SESSION_ID } from "../constants.js";
import { attachScopedRoot, resolveBasePath } from "./path-resolver.js";

/**
 * 批量删除指定会话的 scoped 附件目录。
 */
export async function deleteScopedAttachmentsBySessionIds(service, { userId, sessionIds = [] } = {}) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopedRoot = attachScopedRoot(basePath);
  const normalizedIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map((sid) => safeStr(sid)).filter(Boolean))];
  if (!normalizedIds.length) return { deletedSessionIds: [], deletedCount: 0 };

  const deleted = [];
  for (const sid of normalizedIds) {
    try {
      await fsRm(path.join(scopedRoot, sid), { recursive: true, force: true });
      deleted.push(sid);
    } catch {
      // ignore per-session delete error
    }
  }
  return { deletedSessionIds: deleted, deletedCount: deleted.length };
}

/**
 * 清理已不存在会话的 scoped 附件目录（孤儿目录）。
 */
export async function pruneOrphanScopedAttachments(
  service,
  {
    userId,
    keepSessionIds = [],
    attachmentSources = [],
  } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopedRoot = attachScopedRoot(basePath);
  const sourceSet = new Set((Array.isArray(attachmentSources) ? attachmentSources : []).map((source) => safeStr(source).toLowerCase()).filter(Boolean));
  const keepSet = new Set([DEFAULT_ATTACHMENT_SESSION_ID, ...(Array.isArray(keepSessionIds) ? keepSessionIds : []).map((sid) => safeStr(sid)).filter(Boolean)]);

  let sessionEntries = [];
  try {
    sessionEntries = await readdir(scopedRoot, { withFileTypes: true });
  } catch {
    return { deletedSessionIds: [], deletedCount: 0 };
  }

  const deletedSessionIds = [];
  for (const entry of sessionEntries) {
    if (!entry?.isDirectory?.()) continue;
    const sessionId = safeStr(entry?.name);
    if (!sessionId || keepSet.has(sessionId)) continue;
    try {
      const sessionPath = path.join(scopedRoot, sessionId);
      if (!sourceSet.size) {
        await fsRm(sessionPath, { recursive: true, force: true });
        deletedSessionIds.push(sessionId);
        continue;
      }

      let sourceEntries = [];
      try {
        sourceEntries = await readdir(sessionPath, { withFileTypes: true });
      } catch {
        continue;
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
    } catch {
      // ignore per-session prune failures
    }
  }

  return { deletedSessionIds, deletedCount: deletedSessionIds.length };
}
