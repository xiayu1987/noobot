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

export async function appendSystemErrorLog({
  basePath,
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
  await mkdir(path.dirname(logFile), { recursive: true });
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
  await appendFile(logFile, `${JSON.stringify(record)}\n`, "utf8");
  // 同时输出到服务端日志，便于线上排查
  // eslint-disable-next-line no-console
  console.error(`[system_error] ${record.ts} ${record.message}`, record);
  return record;
}
