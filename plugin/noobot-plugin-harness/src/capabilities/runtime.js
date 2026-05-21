/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_ENGINEERING_CAPABILITIES, resolveCapabilityProfile } from "./profile.js";
import { resolveCapabilityHandlers } from "./handlers/index.js";
import { resolveCapabilitiesForHook, CAPABILITY_HOOK_MAP } from "./hook-map.js";
import { applyToolTakeover } from "./takeover/tool-takeover.js";
import { applyMessageTakeover } from "./takeover/message-takeover.js";
import { applyMemoryTakeover } from "./takeover/memory-takeover.js";
import { resolveTakeoverPriority, sortTakeovers } from "./takeover/priority.js";

function resolveTakeoverDirectives(result = {}) {
  return {
    tool:
      result?.toolTakeover ||
      result?.takeover?.tool ||
      result?.directives?.toolTakeover ||
      null,
    message:
      result?.messageTakeover ||
      result?.systemMessageTakeover ||
      result?.takeover?.message ||
      result?.directives?.messageTakeover ||
      result?.directives?.systemMessageTakeover ||
      null,
    memory:
      result?.memoryTakeover ||
      result?.takeover?.memory ||
      result?.directives?.memoryTakeover ||
      null,
  };
}

function pushPendingTakeover(pending = [], kind = "", directive = null, context = {}) {
  if (!directive) return false;
  pending.push({
    directive,
    ...resolveTakeoverPriority({ kind, directive, ...context }),
  });
  return true;
}

export function createCapabilityRuntime({ profile = {}, handlers = {} } = {}) {
  const resolvedProfile = resolveCapabilityProfile(profile);
  const resolvedHandlers = resolveCapabilityHandlers(handlers);

  return {
    profile: resolvedProfile,
    handlers: resolvedHandlers,
    hookMap: CAPABILITY_HOOK_MAP,
    listCapabilities() {
      return HARNESS_ENGINEERING_CAPABILITIES;
    },
    resolveByHook(point = "") {
      return resolveCapabilitiesForHook(point)
        .filter((capability) => resolvedProfile?.[capability]?.enabled !== false);
    },
    async runHook(point = "", ctx = {}, meta = {}) {
      const capabilities = this.resolveByHook(point);
      const results = [];
      const pendingToolTakeovers = [];
      const pendingMessageTakeovers = [];
      const pendingMemoryTakeovers = [];
      let sequence = 0;

      for (const capability of capabilities) {
        const handler = resolvedHandlers[capability];
        if (typeof handler !== "function") continue;

        const profileState = resolvedProfile[capability] || {};
        const result = await handler({
          capability,
          point,
          ctx,
          profile: profileState,
          meta,
        });
        const directives = resolveTakeoverDirectives(result);
        const priorityContext = { point, ctx, profile: profileState };

        if (directives.tool) {
          pushPendingTakeover(pendingToolTakeovers, "tool", directives.tool, {
            ...priorityContext,
            sequence: sequence++,
          });
        }
        if (directives.message) {
          pushPendingTakeover(pendingMessageTakeovers, "message", directives.message, {
            ...priorityContext,
            sequence: sequence++,
          });
        }
        if (directives.memory) {
          pushPendingTakeover(pendingMemoryTakeovers, "memory", directives.memory, {
            ...priorityContext,
            sequence: sequence++,
          });
        }

        results.push(result || { capability, point, status: "planned" });
      }

      for (const item of sortTakeovers(pendingToolTakeovers)) {
        applyToolTakeover(point, ctx, item.directive);
      }
      for (const item of sortTakeovers(pendingMessageTakeovers)) {
        applyMessageTakeover(point, ctx, item.directive);
      }
      for (const item of sortTakeovers(pendingMemoryTakeovers)) {
        applyMemoryTakeover(point, ctx, item.directive);
      }

      return results;
    },
  };
}
