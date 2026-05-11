/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

function resolveWorkspaceRoot({ runtime = {}, modelState = {} } = {}) {
  const runtimeBasePath = String(runtime?.basePath || "").trim();
  if (runtimeBasePath) {
    return path.resolve(runtimeBasePath, "..");
  }
  const globalConfig = modelState?.globalConfig || {};
  const configuredWorkspaceRoot = String(globalConfig?.workspaceRoot || "").trim();
  if (configuredWorkspaceRoot) {
    return path.resolve(process.cwd(), configuredWorkspaceRoot);
  }
  return path.resolve(process.cwd(), "../workspace");
}

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
    parentSessionId: String(runtime?.systemRuntime?.parentSessionId || "").trim(),
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
    tools: Array.isArray(tools)
      ? tools.map((toolName) => String(toolName || "").trim()).filter(Boolean)
      : [],
  });
}

export async function appendToolCompatibilityLog({
  modelState = {},
  runtime = {},
  event = "",
  tools = [],
} = {}) {
  const workspaceRoot = resolveWorkspaceRoot({ runtime, modelState });
  const targetPath = path.join(workspaceRoot, "tool-compatibility.log");
  await mkdir(path.dirname(targetPath), { recursive: true });
  const line = buildToolCompatibilityLogLine({
    modelState,
    runtime,
    event,
    tools,
  });
  await appendFile(targetPath, `${line}\n`, "utf8");
  return targetPath;
}

