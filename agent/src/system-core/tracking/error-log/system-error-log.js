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
  SESSION_CHANNEL_CATEGORIES,
  SESSION_CHANNELS,
  writeSessionChannelEvent,
} from "@noobot/telemetry/session-channel";

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
    await writeSessionChannelEvent({
      userId,
      sessionId,
      parentSessionId,
      source,
      category: SESSION_CHANNEL_CATEGORIES.SYSTEM,
      channel: SESSION_CHANNELS.DIRECT,
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
