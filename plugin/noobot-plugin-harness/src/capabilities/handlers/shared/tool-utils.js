/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BLOCKED_AGENT_TOOL_NAMES } from "./constants.js";

export function resolveSceneToolNames(ctx = {}) {
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return [];
  return registry
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
}

export function shouldProcessPrimaryToolHooks(ctx = {}) {
  const scope = String(ctx?.executionScope || "").trim().toLowerCase();
  if (!scope) return true;
  return scope === "primary";
}

export function disableBlockedToolsInRegistry(ctx = {}) {
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  const next = registry.filter((tool) => {
    const name = String(tool?.name || "").trim();
    return name && !BLOCKED_AGENT_TOOL_NAMES.has(name);
  });
  if (next.length === registry.length) return false;
  registry.splice(0, registry.length, ...next);
  return true;
}

export function disableBlockedCalls(calls = []) {
  if (!Array.isArray(calls)) return false;
  const next = calls.filter((call) => !BLOCKED_AGENT_TOOL_NAMES.has(String(call?.name || "").trim()));
  if (next.length === calls.length) return false;
  calls.splice(0, calls.length, ...next);
  return true;
}
