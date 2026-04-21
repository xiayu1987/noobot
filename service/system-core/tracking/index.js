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

export function getMcpErrorLogFilePath({ basePath }) {
  return path.join(basePath, "mcp-error.log");
}

function resolveWorkspaceRootLogFilePath({ workspaceRoot = "" }) {
  const root = path.resolve(String(workspaceRoot || "").trim());
  return path.join(root, "system-error.log");
}

function resolveWorkspaceRootMcpLogFilePath({ workspaceRoot = "" }) {
  const root = path.resolve(String(workspaceRoot || "").trim());
  return path.join(root, "mcp-error.log");
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
  if (!basePath) {
    throw fatalSystemError("basePath required", {
      code: "FATAL_BASE_PATH_REQUIRED",
    });
  }
  const logFile = getMcpErrorLogFilePath({ basePath });
  const record = {
    ts: nowIso(),
    userId: String(userId || ""),
    sessionId: String(sessionId || ""),
    parentSessionId: String(parentSessionId || ""),
    source: String(source || "mcp"),
    event: String(event || "mcp_call_failed"),
    mcpName: String(mcpName || ""),
    task: String(task || ""),
    modelName: String(modelName || ""),
    message: String(message || ""),
    stack: String(stack || ""),
    details: details && typeof details === "object" ? details : {},
  };
  const targetFiles = new Set([logFile]);
  if (String(workspaceRoot || "").trim()) {
    targetFiles.add(resolveWorkspaceRootMcpLogFilePath({ workspaceRoot }));
  }
  for (const targetFile of targetFiles) {
    await mkdir(path.dirname(targetFile), { recursive: true });
    await appendFile(targetFile, `${JSON.stringify(record)}\n`, "utf8");
  }
  // eslint-disable-next-line no-console
  console.error(`[mcp_error] ${record.ts} ${record.message}`, record);
  return record;
}
