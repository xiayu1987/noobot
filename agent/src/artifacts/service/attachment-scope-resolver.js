/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";

import { VALID_ATTACHMENT_SOURCES } from "../constants.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { fatalSystemError, recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
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

function normalizeSource(source) {
  const normalized = safeStr(source).toLowerCase();
  if (!VALID_ATTACHMENT_SOURCES.has(normalized)) {
    throw new TypeError("attachmentSource must be an explicitly supported source");
  }
  return normalized;
}

export function resolveAttachmentScope({ sessionId = "", attachmentSource = "" } = {}) {
  const normalizedSessionId = safeStr(sessionId);
  if (!normalizedSessionId) {
    throw recoverableToolError(tSystem("attach.sessionIdRequiredForPersistence"), {
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_SESSION_ID_REQUIRED,
      details: { hint: tSystem("attach.sessionIdPersistenceHint") },
    });
  }
  return {
    sessionId: normalizedSessionId,
    attachmentSource: normalizeSource(attachmentSource),
  };
}
