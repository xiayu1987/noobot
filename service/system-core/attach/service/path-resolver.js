/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { readdir } from "node:fs/promises";

import {
  VALID_ATTACHMENT_SOURCES,
  DEFAULT_ATTACHMENT_SESSION_ID,
  DEFAULT_ATTACHMENT_SOURCE,
} from "../constants.js";
import { safeStr } from "../../utils/shared-utils.js";
import { fatalSystemError, recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { readAttachIndex } from "../index-manager.js";
import { ERROR_CODE } from "../../error/constants.js";

/**
 * 解析用户工作区根路径。
 *
 * @param {object} globalConfig - 全局配置。
 * @param {string} userId - 用户 ID。
 * @returns {string} 绝对路径。
 */
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

/**
 * 规范化附件来源。
 *
 * @param {string} source - 来源字符串。
 * @returns {string} 规范化来源。
 */
export function normalizeSource(source) {
  const normalized = safeStr(source).toLowerCase();
  return VALID_ATTACHMENT_SOURCES.has(normalized) ? normalized : DEFAULT_ATTACHMENT_SOURCE;
}

/**
 * 解析附件 Scope。
 *
 * @param {object} [options] - Scope 参数。
 * @param {string} [options.sessionId] - 会话 ID。
 * @param {string} [options.attachmentSource] - 附件来源。
 * @param {boolean} [options.requireSessionId] - 是否要求必须有 sessionId。
 * @returns {{sessionId: string, attachmentSource: string}}
 */
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

/**
 * 获取附件 scoped 根目录。
 *
 * @param {string} basePath - 用户根路径。
 * @returns {string}
 */
export function attachScopedRoot(basePath) {
  return path.join(basePath, "runtime/attach/scoped");
}

/**
 * 获取单个 scope 的附件目录。
 *
 * @param {string} basePath - 用户根路径。
 * @param {{sessionId: string, attachmentSource: string}} scope - 附件范围。
 * @returns {string}
 */
export function attachScopeRoot(basePath, scope) {
  return path.join(attachScopedRoot(basePath), scope.sessionId, scope.attachmentSource);
}

/**
 * 在所有 scope 的索引中查找附件记录。
 *
 * @param {string} basePath - 用户根路径。
 * @param {string} attachmentId - 附件 ID。
 * @returns {Promise<object|null>}
 */
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
