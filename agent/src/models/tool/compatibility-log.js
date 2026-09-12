/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendFile, mkdir } from "node:fs/promises";
import { filePath as path, resolveRuntimeWorkspaceRoot } from "@noobot/path-resolver";
import { normalizeParentSessionId } from "@noobot/session-protocol";

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
    parentSessionId: normalizeParentSessionId(runtime?.systemRuntime?.parentSessionId),
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
    tools: Array.isArray(tools) ? tools.map((t) => String(t || "").trim()).filter(Boolean) : [],
  });
}

export async function appendToolCompatibilityLog({
  modelState = {},
  runtime = {},
  event = "",
  tools = [],
} = {}) {
  const workspaceRoot = resolveRuntimeWorkspaceRoot({
    runtime,
    globalConfig: modelState?.globalConfig || {},
  });
  if (!workspaceRoot) {
    throw new Error("tool compatibility log requires an authoritative workspace root");
  }
  const targetPath = path.join(path.resolve(workspaceRoot), "tool-compatibility.log");
  await mkdir(path.dirname(targetPath), { recursive: true });
  const line = buildToolCompatibilityLogLine({ modelState, runtime, event, tools });
  await appendFile(targetPath, `${line}\n`, "utf8");
  return targetPath;
}
