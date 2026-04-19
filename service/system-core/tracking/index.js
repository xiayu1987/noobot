/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fatalSystemError } from "../error/index.js";

function nowIso() {
  return new Date().toISOString();
}

export function getSystemErrorLogFilePath({ basePath }) {
  return path.join(basePath, "system-error.log");
}

function resolveWorkspaceRootLogFilePath({ workspaceRoot = "" }) {
  const root = path.resolve(String(workspaceRoot || "").trim());
  return path.join(root, "system-error.log");
}

export async function appendSystemErrorLog({
  basePath,
  workspaceRoot = "",
  userId = "",
  sessionId = "",
  parentSessionId = "",
  source = "bot-manage",
  event = "system_error",
  message = "",
  stack = "",
  extra = {},
}) {
  if (!basePath) {
    throw fatalSystemError("basePath required", {
      code: "FATAL_BASE_PATH_REQUIRED",
    });
  }
  const logFile = getSystemErrorLogFilePath({ basePath });
  const record = {
    ts: nowIso(),
    userId: String(userId || ""),
    sessionId: String(sessionId || ""),
    parentSessionId: String(parentSessionId || ""),
    source: String(source || "bot-manage"),
    event: String(event || "system_error"),
    message: String(message || ""),
    stack: String(stack || ""),
    extra: extra && typeof extra === "object" ? extra : {},
  };
  const targetFiles = new Set([logFile]);
  if (String(workspaceRoot || "").trim()) {
    targetFiles.add(resolveWorkspaceRootLogFilePath({ workspaceRoot }));
  }
  for (const targetFile of targetFiles) {
    await mkdir(path.dirname(targetFile), { recursive: true });
    await appendFile(targetFile, `${JSON.stringify(record)}\n`, "utf8");
  }
  // 同时输出到服务端日志，便于线上排查
  // eslint-disable-next-line no-console
  console.error(`[system_error] ${record.ts} ${record.message}`, record);
  return record;
}
