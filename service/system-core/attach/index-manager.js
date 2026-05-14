/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 读取附件索引文件。
 *
 * @param {string} basePath - 用户根路径。
 * @param {{sessionId: string, attachmentSource: string}} scope - 附件 scope。
 * @returns {Promise<{updatedAt: string, sessionId: string, attachmentSource: string, attachments: Record<string, any>}>}
 */
export async function readAttachIndex(basePath, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await mkdir(path.dirname(indexFile), { recursive: true });

  try {
    const raw = await readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
      sessionId: String(parsed?.sessionId || scope.sessionId),
      attachmentSource: String(parsed?.attachmentSource || scope.attachmentSource),
      attachments: isObject(parsed?.attachments) ? parsed.attachments : {},
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      sessionId: scope.sessionId,
      attachmentSource: scope.attachmentSource,
      attachments: {},
    };
  }
}

/**
 * 写入附件索引文件。
 *
 * @param {string} basePath - 用户根路径。
 * @param {{attachments?: Record<string, any>}} indexData - 附件索引对象。
 * @param {{sessionId: string, attachmentSource: string}} scope - 附件 scope。
 * @returns {Promise<void>}
 */
export async function writeAttachIndex(basePath, indexData, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await mkdir(path.dirname(indexFile), { recursive: true });

  const payload = {
    updatedAt: new Date().toISOString(),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    attachments: isObject(indexData?.attachments) ? indexData.attachments : {},
  };
  await writeFile(indexFile, JSON.stringify(payload, null, 2), "utf8");
}

function resolveIndexFile(basePath, scope) {
  return path.join(
    basePath,
    "runtime/attach/scoped",
    scope.sessionId,
    scope.attachmentSource,
    "attachments.json",
  );
}

function isObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}
