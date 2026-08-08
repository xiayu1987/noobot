/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { readdir } from "node:fs/promises";

import {
  VALID_ATTACHMENT_SOURCES,
  DEFAULT_ATTACHMENT_SESSION_ID,
  DEFAULT_ATTACHMENT_SOURCE,
} from "../constants.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { fatalSystemError, recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { readAttachIndex } from "../index-manager.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";

export function resolveBasePath(globalConfig, userId) {
  const uid = safeStr(userId);
  const root = safeStr(globalConfig?.workspaceRoot);
  if (!uid || !root) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
    });
  }
  return path.resolve(root, uid);
}

export function normalizeSource(source) {
  const normalized = safeStr(source).toLowerCase();
  return VALID_ATTACHMENT_SOURCES.has(normalized) ? normalized : DEFAULT_ATTACHMENT_SOURCE;
}

export function resolveAttachmentScope({ sessionId = "", attachmentSource = "", requireSessionId = false } = {}) {
  const normalizedSessionId = safeStr(sessionId) === DEFAULT_ATTACHMENT_SESSION_ID ? "" : safeStr(sessionId);
  if (requireSessionId && !normalizedSessionId) {
    throw recoverableToolError(tSystem("attach.sessionIdRequiredForPersistence"), {
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_SESSION_ID_REQUIRED,
      details: { hint: tSystem("attach.sessionIdPersistenceHint") },
    });
  }
  return {
    sessionId: normalizedSessionId || DEFAULT_ATTACHMENT_SESSION_ID,
    attachmentSource: normalizeSource(attachmentSource),
  };
}

export function attachScopedRoot(basePath) {
  return path.join(basePath, "runtime/attach/scoped");
}

export function attachScopeRoot(basePath, scope) {
  return path.join(attachScopedRoot(basePath), scope.sessionId, scope.attachmentSource);
}

export async function findRecordAcrossScopedIndexes(basePath, attachmentId) {
  const id = safeStr(attachmentId);
  if (!id) return null;

  const scopedRoot = attachScopedRoot(basePath);
  let sessionEntries;
  try {
    sessionEntries = await readdir(scopedRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const sessionEntry of sessionEntries) {
    if (!sessionEntry?.isDirectory?.()) continue;
    const sessionRoot = path.join(scopedRoot, sessionEntry.name);
    let sourceEntries;
    try {
      sourceEntries = await readdir(sessionRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sourceEntry of sourceEntries) {
      if (!sourceEntry?.isDirectory?.()) continue;
      const index = await readAttachIndex(basePath, {
        sessionId: sessionEntry.name,
        attachmentSource: sourceEntry.name,
      });
      const hit = index?.attachments?.[id];
      if (hit) return hit;
    }
  }

  return null;
}
