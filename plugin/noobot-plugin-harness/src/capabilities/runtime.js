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
import { cleanupExpiredPendingOnHook } from "./pending-cleanup.js";
import { markHarnessTurnLifecycle } from "./handlers/shared/runtime/lifecycle-utils.js";
import { appendCapabilityLog } from "./handlers/shared/attachment-log-utils.js";
import { safeError } from "../data/record-builders.js";
import { WORKFLOW_PARAMS } from "../core/workflow-params.js";

function normalizeBlockList(value) {
  return Array.isArray(value) ? value : [];
}

function resolveMessageBlocks(ctx = {}) {
  const messageBlocks =
    ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : null;
  if (!messageBlocks) return null;
  return {
    system: normalizeBlockList(messageBlocks.system),
    history: normalizeBlockList(messageBlocks.history),
    incremental: normalizeBlockList(messageBlocks.incremental),
  };
}

function resolveFilteredBlock({
  resolver = null,
  scope = "history",
  messages = [],
  ctx = {},
} = {}) {
  const source = normalizeBlockList(messages);
  if (typeof resolver !== "function") return source;
  try {
    const resolved = resolver({ scope, messages: source, ctx });
    return Array.isArray(resolved) ? resolved : source;
  } catch {
    return source;
  }
}

function writeMessageBlocksInPlace(
  ctx = {},
  { system = [], history = [], incremental = [] } = {},
) {
  const existing =
    ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : null;
  const target = existing || {};
  target.system = Array.isArray(system) ? system : [];
  target.history = Array.isArray(history) ? history : [];
  target.incremental = Array.isArray(incremental) ? incremental : [];
  ctx.messageBlocks = target;
  return target;
}

function resolveMessageContent(message = {}) {
  return String(message?.content || message?.lc_kwargs?.content || "").trim();
}

function resolveMessageMetaField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key) return "";
  return String(
    message?.[key] ||
      message?.additional_kwargs?.[key] ||
      message?.lc_kwargs?.[key] ||
      message?.lc_kwargs?.additional_kwargs?.[key] ||
      "",
  ).trim();
}

function isPlainUserMessage(message = {}) {
  if (String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase() !== "user") {
    return false;
  }
  const content = resolveMessageContent(message);
  if (!content) return false;
  if (content.startsWith("[")) return false;
  return true;
}

function resolveCurrentUserIdentity(message = {}) {
  if (!isPlainUserMessage(message)) return null;
  const turnScopeId = resolveMessageMetaField(message, "turnScopeId");
  if (turnScopeId) return { kind: "turnScopeId", value: turnScopeId };
  const dialogProcessId = resolveMessageMetaField(message, "dialogProcessId");
  if (dialogProcessId) return { kind: "dialogProcessId", value: dialogProcessId };
  const content = resolveMessageContent(message);
  return content ? { kind: "content", value: content } : null;
}

function filterCurrentUserResidueFromHistory(history = [], incremental = []) {
  const currentIdentities = new Set(
    normalizeBlockList(incremental)
      .map((message) => resolveCurrentUserIdentity(message))
      .filter(Boolean)
      .map((identity) => `${identity.kind}:${identity.value}`),
  );
  if (!currentIdentities.size) return history;
  return normalizeBlockList(history).filter((message) => {
    if (!isPlainUserMessage(message)) return true;
    const identity = resolveCurrentUserIdentity(message);
    if (!identity) return true;
    return !currentIdentities.has(`${identity.kind}:${identity.value}`);
  });
}

function applyMessageBlocksForBeforeLlmCall(point = "", ctx = {}, meta = {}) {
  if (String(point || "").trim().toLowerCase() !== "before_llm_call") return;
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : null;
  if (runtime?.__harnessMessageBlocksApplied === true) return;
  const blocks = resolveMessageBlocks(ctx);
  if (!blocks) return;
  const resolver = meta?.harness?.resolveMessageBlock;
  const system = resolveFilteredBlock({
    resolver,
    scope: "system",
    messages: blocks.system,
    ctx,
  });
  const history = resolveFilteredBlock({
    resolver,
    scope: "history",
    messages: blocks.history,
    ctx,
  });
  const incremental = resolveFilteredBlock({
    resolver,
    scope: "incremental",
    messages: blocks.incremental,
    ctx,
  });
  const effectiveHistory = filterCurrentUserResidueFromHistory(history, incremental);
  const composed = [...system, ...effectiveHistory, ...incremental];
  const target = Array.isArray(ctx?.messages) ? ctx.messages : [];
  target.splice(0, target.length, ...composed);
  ctx.messages = target;
  // Preserve the original messageBlocks object identity. In the agent runtime
  // this object is shared with loopState.messageBlocks; replacing it would make
  // later hook turns fall back to stale blocks and lose the re-computable source
  // accumulated by final compaction.
  writeMessageBlocksInPlace(ctx, { system, history: effectiveHistory, incremental });
  if (runtime) runtime.__harnessMessageBlocksApplied = true;
}

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
      markHarnessTurnLifecycle(point, ctx);
      cleanupExpiredPendingOnHook(point, ctx, meta);
      applyMessageBlocksForBeforeLlmCall(point, ctx, meta);
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
        let result = null;
        try {
          result = await handler({
            capability,
            point,
            ctx,
            profile: profileState,
            meta,
          });
        } catch (error) {
          const normalizedError = safeError(error);
          appendCapabilityLog(ctx, {
            domain: capability,
            event: WORKFLOW_PARAMS.logging.events.shared.capabilityFlowFailed,
            detail: {
              point,
              capability,
              error: normalizedError,
            },
          });
          results.push({
            capability,
            point,
            status: "error",
            changed: false,
            error: normalizedError,
          });
          continue;
        }
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
