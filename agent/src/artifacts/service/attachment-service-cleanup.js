/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { withAttachmentSessionStorage } from "../index-manager.js";
import { fsRm } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory } from "../../shared/storage/durable-file.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { attachScopedRoot, attachSessionRoot } from "./attachment-storage-layout.js";

export async function deleteScopedAttachmentsBySessionIds(
  service,
  { userId, sessionIds = [] } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const normalizedIds = [
    ...new Set(
      (Array.isArray(sessionIds) ? sessionIds : []).map((sid) => safeStr(sid)).filter(Boolean),
    ),
  ];
  if (!normalizedIds.length) return { deletedSessionIds: [], deletedCount: 0 };

  const targets = normalizedIds.map((sid) => [sid, attachSessionRoot(basePath, sid)]);
  const deleted = [];
  for (const [sid, directory] of targets) {
    await withAttachmentSessionStorage(basePath, sid, () =>
      fsRm(directory, { recursive: true, force: true }),
    );
    deleted.push(sid);
  }
  try {
    await syncStorageDirectory(attachScopedRoot(basePath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { deletedSessionIds: deleted, deletedCount: deleted.length };
}
