/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  appendRecordToFiles,
  buildBaseRecord,
  resolveLogFilePath,
  resolveTargetLogFiles,
} from "./log-writer.js";

const SYSTEM_ERROR_LOG_FILE_NAME = "system-error.log";

export function getSystemErrorLogFilePath({ basePath }) {
  return resolveLogFilePath({
    basePath,
    fileName: SYSTEM_ERROR_LOG_FILE_NAME,
  });
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
  const record = {
    ...buildBaseRecord({
      userId,
      sessionId,
      parentSessionId,
      source,
      event,
      message,
      stack,
    }),
    extra: extra && typeof extra === "object" ? extra : {},
  };
  const targetFiles = resolveTargetLogFiles({
    basePath,
    workspaceRoot,
    fileName: SYSTEM_ERROR_LOG_FILE_NAME,
  });
  await appendRecordToFiles({
    targetFiles,
    record,
  });
  // 同时输出到服务端日志，便于线上排查
  // eslint-disable-next-line no-console
  console.error(`[system_error] ${record.ts} ${record.message}`, record);
  return record;
}
