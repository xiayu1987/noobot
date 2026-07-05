/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * MCP error log - writes MCP call errors to mcp-error.log.
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

const MCP_ERROR_LOG_FILE_NAME = "mcp-error.log";

export function getMcpErrorLogFilePath({ basePath }) {
  return resolveLogFilePath({
    basePath,
    fileName: MCP_ERROR_LOG_FILE_NAME,
  });
}

export async function appendMcpErrorLog({
  basePath,
  workspaceRoot = "",
  userId = "",
  sessionId = "",
  parentSessionId = "",
  mcpName = "",
  task = "",
  modelName = "",
  source = "mcp",
  event = "mcp_call_failed",
  message = "",
  stack = "",
  details = {},
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
    mcpName: String(mcpName || ""),
    task: String(task || ""),
    modelName: String(modelName || ""),
    details: details && typeof details === "object" ? details : {},
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
        mcpName: record.mcpName,
        task: record.task,
        modelName: record.modelName,
        details: record.details,
      },
    }, {
      workspaceRoot,
    });
  } else {
    const targetFiles = resolveTargetLogFiles({
      basePath,
      workspaceRoot,
      fileName: MCP_ERROR_LOG_FILE_NAME,
    });
    await appendRecordToFiles({
      targetFiles,
      record,
    });
  }
  return record;
}
