/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Tool compatibility logging: build log lines and append to file.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { filePath as path } from "../../utils/path-resolver.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";

/**
 * Resolve the workspace root from runtime or config.
 * @param {object} params
 * @returns {string}
 */
function resolveWorkspaceRoot({ runtime = {}, modelState = {} } = {}) {
  const runtimeBasePath = String(runtime?.basePath || "").trim();
  if (runtimeBasePath) {
    return path.resolve(runtimeBasePath, "..");
  }
  const envWorkspaceRoot = String(process.env?.AGENT_WORKSPACE_ROOT || "").trim();
  if (envWorkspaceRoot) {
    return path.resolve(process.cwd(), envWorkspaceRoot);
  }
  const globalConfig = modelState?.globalConfig || {};
  const configuredWorkspaceRoot = String(globalConfig?.workspaceRoot || "").trim();
  if (configuredWorkspaceRoot) {
    return path.resolve(process.cwd(), configuredWorkspaceRoot);
  }
  return path.resolve(process.cwd(), "workspace");
}

/**
 * Build a JSON log line for tool compatibility events.
 * @param {object} params
 * @returns {string}
 */
export function buildToolCompatibilityLogLine({
  modelState = {},
  runtime = {},
  event = "",
  tools = [],
} = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    event: String(event || "").trim(),
    userId: String(runtime?.userId || "").trim(),
    sessionId: String(runtime?.systemRuntime?.sessionId || "").trim(),
    parentSessionId: resolveParentSessionId({ runtime }),
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
    tools: Array.isArray(tools)
      ? tools.map((t) => String(t || "").trim()).filter(Boolean)
      : [],
  });
}

/**
 * Append a tool compatibility log entry to the workspace log file.
 * @param {object} params
 * @returns {Promise<string>} The path of the log file.
 */
export async function appendToolCompatibilityLog({
  modelState = {},
  runtime = {},
  event = "",
  tools = [],
} = {}) {
  const workspaceRoot = resolveWorkspaceRoot({ runtime, modelState });
  const targetPath = path.join(workspaceRoot, "tool-compatibility.log");
  await mkdir(path.dirname(targetPath), { recursive: true });
  const line = buildToolCompatibilityLogLine({ modelState, runtime, event, tools });
  await appendFile(targetPath, `${line}\n`, "utf8");
  return targetPath;
}
