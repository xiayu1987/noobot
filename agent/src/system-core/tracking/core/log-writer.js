/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Log writer - low-level file I/O for all log types.
 * Pure infrastructure: path resolution, record building, append.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";

function nowIso() {
  return new Date().toISOString();
}

function assertBasePath(basePath) {
  if (!basePath) {
    throw fatalSystemError(tSystem("common.basePathRequired"), {
      code: ERROR_CODE.FATAL_BASE_PATH_REQUIRED,
    });
  }
}

export function resolveLogFilePath({ basePath, fileName = "" } = {}) {
  assertBasePath(basePath);
  return path.join(basePath, fileName);
}

function resolveWorkspaceRootLogFilePath({
  workspaceRoot = "",
  fileName = "",
} = {}) {
  const root = path.resolve(String(workspaceRoot || "").trim());
  return path.join(root, fileName);
}

export function resolveTargetLogFiles({
  basePath,
  workspaceRoot = "",
  fileName = "",
} = {}) {
  const logFile = resolveLogFilePath({ basePath, fileName });
  const targetFiles = new Set([logFile]);
  if (String(workspaceRoot || "").trim()) {
    targetFiles.add(
      resolveWorkspaceRootLogFilePath({
        workspaceRoot,
        fileName,
      }),
    );
  }
  return targetFiles;
}

export async function appendRecordToFiles({
  targetFiles = new Set(),
  record = {},
} = {}) {
  for (const targetFile of targetFiles) {
    await mkdir(path.dirname(targetFile), { recursive: true });
    await appendFile(targetFile, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export function buildBaseRecord({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  source = "",
  event = "",
  message = "",
  stack = "",
} = {}) {
  return {
    ts: nowIso(),
    userId: String(userId || ""),
    sessionId: String(sessionId || ""),
    parentSessionId: normalizeParentSessionId(parentSessionId),
    source: String(source || ""),
    event: String(event || ""),
    message: String(message || ""),
    stack: String(stack || ""),
  };
}
