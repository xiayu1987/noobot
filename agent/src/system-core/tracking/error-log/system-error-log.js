/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * System error log - writes system-level errors to system-error.log.
 */
import {
  appendRecordToFiles,
  buildBaseRecord,
  resolveLogFilePath,
  resolveTargetLogFiles,
} from "../core/log-writer.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

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
  if (sessionId) {
    await writeRoutedRuntimeEvent({
      scope: "session",
      userId,
      sessionId,
      parentSessionId,
      source,
      category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      event,
      message,
      data: {
        message,
        stack,
        extra: record.extra,
      },
    }, {
      workspaceRoot,
    });
  } else {
    const targetFiles = resolveTargetLogFiles({
      basePath,
      workspaceRoot,
      fileName: SYSTEM_ERROR_LOG_FILE_NAME,
    });
    await appendRecordToFiles({
      targetFiles,
      record,
    });
  }
  return record;
}
