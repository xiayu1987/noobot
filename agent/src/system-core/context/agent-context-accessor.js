/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDialogProcessIdFromContext } from "./session/dialog-process-id-resolver.js";
import { resolveParentSessionId } from "./parent-session-id-resolver.js";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function getSystemRuntimeFromRuntime(runtime = {}) {
  return asObject(runtime?.systemRuntime) || {};
}

export function getRuntimeFromAgentContext(agentContext = {}, fallbackRuntime = null) {
  const context = asObject(agentContext) || {};
  const runtimeFromController = asObject(context?.execution?.controllers?.runtime);
  if (runtimeFromController) return runtimeFromController;
  const runtimeFromTopLevel = asObject(context?.runtime);
  if (runtimeFromTopLevel) return runtimeFromTopLevel;
  return asObject(fallbackRuntime) || {};
}

export function getSystemRuntimeFromAgentContext(agentContext = {}, fallbackRuntime = null) {
  const runtime = getRuntimeFromAgentContext(agentContext, fallbackRuntime);
  return getSystemRuntimeFromRuntime(runtime);
}

export function getSessionIdsFromAgentContext(agentContext = {}, fallbackRuntime = null) {
  const context = asObject(agentContext) || {};
  const runtime = getRuntimeFromAgentContext(context, fallbackRuntime);
  const systemRuntime = getSystemRuntimeFromAgentContext(context, runtime);
  const parentSessionId = resolveParentSessionId({
    context: {
      parentSessionId: context?.session?.parent?.id,
      runtime,
      agentContext: context,
    },
    runtime,
    agentContext: context,
  });
  return {
    userId: String(
      context?.environment?.identity?.userId || runtime?.userId || systemRuntime?.userId || "",
    ).trim(),
    sessionId: String(
      context?.session?.current?.id || systemRuntime?.sessionId || "",
    ).trim(),
    parentSessionId,
    rootSessionId: String(
      context?.session?.root?.id || systemRuntime?.rootSessionId || "",
    ).trim(),
  };
}

export function resolveChildRunParentSessionIdFromRuntime(runtime = {}) {
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  return String(
    systemRuntime?.childRunParentSessionId ||
      systemRuntime?.durableParentSessionId ||
      systemRuntime?.sessionId ||
      "",
  ).trim();
}

export function getBasePathFromAgentContext(agentContext = {}, fallbackRuntime = null) {
  const context = asObject(agentContext) || {};
  const runtime = getRuntimeFromAgentContext(context, fallbackRuntime);
  return String(
    context?.environment?.workspace?.basePath || runtime?.basePath || "",
  ).trim();
}

export function getDialogProcessIdFromAgentContext(
  agentContext = {},
  fallbackRuntime = null,
) {
  const context = asObject(agentContext) || {};
  const runtime = getRuntimeFromAgentContext(context, fallbackRuntime);
  const fromContext = resolveDialogProcessIdFromContext({
    agentContext: context,
  });
  if (fromContext) return fromContext;
  return resolveDialogProcessIdFromContext({ runtime });
}
