/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { getAgentContextIdentity } from "@noobot/context-protocol/agent-context/accessors";
import { getAgentContextEnvelope } from "./agent-execution-scope.js";
import { text } from "@noobot/shared/value";

export { getAgentContextEnvelope } from "./agent-execution-scope.js";

export function getRuntimeFromAgentContext(scope = {}) {
  const runtime = scope?.bindings?.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError("agent execution scope bindings.runtime is required");
  }
  return runtime;
}

export function getToolsFromAgentContext(scope = {}) {
  const tools = scope?.bindings?.tools;
  if (!Array.isArray(tools)) {
    throw new TypeError("agent execution scope bindings.tools must be an array");
  }
  return tools;
}

export function getSystemRuntimeFromRuntime(runtime = {}) {
  const systemRuntime = runtime?.systemRuntime;
  return systemRuntime && typeof systemRuntime === "object" ? systemRuntime : {};
}

export function resolveRuntimeTurnScopeId(runtime = {}) {
  return text(getSystemRuntimeFromRuntime(runtime).turnScopeId);
}

export function resolveRuntimeUserId(runtime = {}) {
  return text(getSystemRuntimeFromRuntime(runtime).userId);
}

export function getSystemRuntimeFromAgentContext(scope = {}) {
  return getSystemRuntimeFromRuntime(getRuntimeFromAgentContext(scope));
}

export function getSessionIdsFromAgentContext(scope = {}) {
  return getAgentContextIdentity(getAgentContextEnvelope(scope));
}

export function getChildRunParentSessionIdFromAgentContext(scope = {}) {
  return getSessionIdsFromAgentContext(scope).rootSessionId;
}

export function getBasePathFromAgentContext(scope = {}) {
  return text(getRuntimeFromAgentContext(scope)?.basePath);
}

export function getDialogProcessIdFromAgentContext(scope = {}) {
  return getAgentContextIdentity(getAgentContextEnvelope(scope)).dialogProcessId;
}
