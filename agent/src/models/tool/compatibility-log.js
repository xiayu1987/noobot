/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendFile, mkdir } from "node:fs/promises";
import { filePath as path, resolveRuntimeWorkspaceRoot } from "@noobot/path-resolver";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

export function buildToolCompatibilityLogLine({
  modelState = {},
  runtime = {},
  event = "",
  tools = [],
} = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    event: text(event),
    userId: text(runtime?.userId),
    sessionId: text(runtime?.systemRuntime?.sessionId),
    parentSessionId: normalizeParentSessionId(runtime?.systemRuntime?.parentSessionId),
    modelAlias: text(modelState?.activeModelAlias),
    modelName: text(modelState?.activeModelName),
    tools: Array.isArray(tools) ? tools.map((t) => text(t)).filter(Boolean) : [],
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
