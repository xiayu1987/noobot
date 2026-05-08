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
  const targetFiles = resolveTargetLogFiles({
    basePath,
    workspaceRoot,
    fileName: MCP_ERROR_LOG_FILE_NAME,
  });
  await appendRecordToFiles({
    targetFiles,
    record,
  });
  // eslint-disable-next-line no-console
  console.error(`[mcp_error] ${record.ts} ${record.message}`, record);
  return record;
}
