/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_ENGINEERING_CAPABILITIES, resolveCapabilityProfile } from "./profile.js";
import { resolveCapabilityHandlers } from "./handlers.js";
import { resolveCapabilitiesForHook, CAPABILITY_HOOK_MAP } from "./hook-map.js";

function normalizeToolNameSet(input) {
  if (!Array.isArray(input)) return new Set();
  return new Set(
    input
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function normalizeCallShape(call = null) {
  if (!call || typeof call !== "object") return null;
  const name = String(call?.name || "").trim();
  if (!name) return null;
  return {
    ...call,
    name,
    args:
      call?.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? call.args
        : {},
  };
}

function applyTakeoverForBeforeToolCalls(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!Array.isArray(ctx.calls)) return false;

  const calls = ctx.calls;
  let changed = false;

  const allowSet = normalizeToolNameSet(takeover?.allowToolNames || takeover?.allowTools);
  const denySet = normalizeToolNameSet(takeover?.denyToolNames || takeover?.denyTools);
  if (allowSet.size || denySet.size) {
    const nextCalls = calls.filter((call) => {
      const toolName = String(call?.name || "").trim();
      if (!toolName) return false;
      if (allowSet.size && !allowSet.has(toolName)) return false;
      if (denySet.size && denySet.has(toolName)) return false;
      return true;
    });
    if (nextCalls.length !== calls.length) {
      calls.splice(0, calls.length, ...nextCalls);
      changed = true;
    }
  }

  const forcedCall = normalizeCallShape(takeover?.forceCall || takeover?.overrideCall);
  if (forcedCall) {
    const shouldReplace = takeover?.mode === "replace" || takeover?.replace === true;
    if (shouldReplace) {
      calls.splice(0, calls.length, forcedCall);
    } else {
      calls.unshift(forcedCall);
    }
    changed = true;
  }

  const maxCalls = Number(takeover?.maxCalls);
  if (Number.isFinite(maxCalls) && maxCalls >= 0 && calls.length > maxCalls) {
    calls.splice(maxCalls);
    changed = true;
  }

  if (takeover?.cancelAll === true && calls.length) {
    calls.splice(0, calls.length);
    changed = true;
  }

  return changed;
}

function applyTakeoverForBeforeToolCall(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!ctx.call || typeof ctx.call !== "object") return false;

  const overrideCall = normalizeCallShape(takeover?.overrideCall || takeover?.forceCall);
  if (!overrideCall) return false;

  ctx.call.name = overrideCall.name;
  ctx.call.args = overrideCall.args || {};
  if (overrideCall.id) ctx.call.id = overrideCall.id;
  return true;
}

function applyToolTakeover(point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  if (point === "before_tool_calls") {
    return applyTakeoverForBeforeToolCalls(ctx, takeover);
  }
  if (point === "before_tool_call") {
    return applyTakeoverForBeforeToolCall(ctx, takeover);
  }
  return false;
}

function ensureMessageArray(ctx = {}, target = "auto") {
  const arrays = [];
  if ((target === "auto" || target === "ctx_messages") && Array.isArray(ctx?.messages)) {
    arrays.push(ctx.messages);
  }
  if (
    (target === "auto" || target === "agent_system") &&
    Array.isArray(ctx?.agentContext?.payload?.messages?.system)
  ) {
    arrays.push(ctx.agentContext.payload.messages.system);
  }
  return arrays;
}

function isMessageInjected(messages = [], id = "", content = "") {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (id) {
    return messages.some((msg) => String(msg?.content || "").includes(`<!-- ${id} -->`));
  }
  return messages.some((msg) => String(msg?.content || "") === content);
}

function resolveInternalMessageType(message = {}) {
  return String(
    message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      message?.metadata?.noobotInternalMessageType ||
      message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
}

function removeInternalForcedMessages(messages = [], directive = {}) {
  if (!Array.isArray(messages)) return 0;
  const removeAll = directive?.cancelInternalForcedMessages === true;
  const removeTypesInput =
    directive?.removeInternalMessageTypes ||
    directive?.stripInternalMessageTypes ||
    directive?.blockInternalMessageTypes ||
    [];
  const removeTypes = Array.isArray(removeTypesInput)
    ? new Set(removeTypesInput.map((item) => String(item || "").trim()).filter(Boolean))
    : new Set();
  if (!removeAll && !removeTypes.size) return 0;

  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const marker = resolveInternalMessageType(messages[index]);
    if (!marker) continue;
    if (removeAll || removeTypes.has(marker)) {
      messages.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

function applyMessageArrayTakeover(messages = [], directive = {}) {
  if (!Array.isArray(messages)) return false;
  const removed = removeInternalForcedMessages(messages, directive);
  const content = String(
    directive?.content ?? directive?.text ?? directive?.message ?? "",
  ).trim();
  if (!content) return removed > 0;
  const id = String(directive?.id || "").trim();
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const messageContent = id ? `<!-- ${id} -->\n${content}` : content;
  if (dedupe && isMessageInjected(messages, id, messageContent)) return false;

  const nextMessage = {
    role: String(directive?.role || "system").trim() || "system",
    content: messageContent,
  };

  if (mode === "replace") {
    messages.splice(0, messages.length, nextMessage);
    return true;
  }
  if (mode === "append") {
    messages.push(nextMessage);
    return true;
  }
  messages.unshift(nextMessage);
  return true;
}

function applyMessageTakeover(_point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  const target = String(takeover?.target || "auto").trim();
  const messageArrays = ensureMessageArray(ctx, target);
  if (!messageArrays.length) return false;
  let changed = false;
  for (const messages of messageArrays) {
    changed = applyMessageArrayTakeover(messages, takeover) || changed;
  }
  return changed;
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

function resolveDirectivePriority(value, fallback = 0) {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : fallback;
}

function getNestedValue(source = {}, key = "") {
  if (!source || typeof source !== "object" || !key) return undefined;
  const segments = String(key)
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

const BASE_TAKEOVER_PRIORITY_PIPELINE = Object.freeze([
  ({ kind }) => `${kind}Takeover.priority`,
  () => "takeoverPriority",
  () => "priority",
]);

function resolveProfileTakeoverPriority(kind = "", profile = {}) {
  for (const keyResolver of BASE_TAKEOVER_PRIORITY_PIPELINE) {
    const key = keyResolver({ kind });
    const value = getNestedValue(profile, key);
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function resolveTakeoverPriority({
  kind = "",
  point = "",
  ctx = {},
  directive = {},
  profile = {},
  sequence = 0,
} = {}) {
  const profilePriority = resolveProfileTakeoverPriority(kind, profile);
  const directPriority = resolveDirectivePriority(directive?.priority, profilePriority);
  if (kind !== "memory") return { priority: directPriority, sequence };

  const commitType = String(ctx?.commitType || "").trim();
  if (point !== "before_state_commit" || !commitType) {
    return { priority: directPriority, sequence };
  }

  const profileByCommitType = getNestedValue(profile, "memoryTakeover.priorityByCommitType");
  const directiveByCommitType = getNestedValue(directive, "priorityByCommitType");
  const profileByCommitTypeSafe =
    profileByCommitType && typeof profileByCommitType === "object" ? profileByCommitType : {};
  const directiveByCommitTypeSafe =
    directiveByCommitType && typeof directiveByCommitType === "object" ? directiveByCommitType : {};

  const commitPriority = resolveDirectivePriority(
    directiveByCommitTypeSafe[commitType] ?? profileByCommitTypeSafe[commitType],
    directPriority,
  );
  return { priority: commitPriority, sequence };
}

function sortTakeovers(items = []) {
  return items.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sequence - b.sequence;
  });
}

function applyMemoryTakeoverForStateCommit(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!ctx.payload || typeof ctx.payload !== "object") return false;
  const commitType = String(ctx?.commitType || "").trim();
  const allowCommitTypes = normalizeStringArray(takeover?.allowCommitTypes);
  const blockCommitTypes = normalizeStringArray(takeover?.blockCommitTypes);
  if (allowCommitTypes.length && !allowCommitTypes.includes(commitType)) return false;
  if (blockCommitTypes.length && blockCommitTypes.includes(commitType)) return false;

  let changed = false;
  const payload = ctx.payload;

  const overridePayload =
    takeover?.overridePayload &&
    typeof takeover.overridePayload === "object" &&
    !Array.isArray(takeover.overridePayload)
      ? takeover.overridePayload
      : null;
  if (overridePayload) {
    Object.assign(payload, overridePayload);
    changed = true;
  }

  const stripKeys = normalizeStringArray(takeover?.stripPayloadKeys || takeover?.redactPayloadKeys);
  if (stripKeys.length) {
    for (const key of stripKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        delete payload[key];
        changed = true;
      }
    }
  }

  if (takeover?.clearToolCalls === true && Array.isArray(payload?.tool_calls)) {
    payload.tool_calls = [];
    changed = true;
  }

  if (takeover?.clearAttachmentMetas === true && Array.isArray(payload?.attachmentMetas)) {
    payload.attachmentMetas = [];
    changed = true;
  }

  const replaceContent = takeover?.content ?? takeover?.replaceContent;
  if (replaceContent !== undefined && payload?.content !== undefined) {
    payload.content = String(replaceContent || "");
    changed = true;
  } else if (typeof payload?.content === "string") {
    const prepend = String(takeover?.prependContent || "").trim();
    const append = String(takeover?.appendContent || "").trim();
    if (prepend) {
      payload.content = `${prepend}${payload.content}`;
      changed = true;
    }
    if (append) {
      payload.content = `${payload.content}${append}`;
      changed = true;
    }
  }

  return changed;
}

function applyMemoryTakeoverForAgentContext(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return false;

  let changed = false;
  const history = agentContext?.payload?.messages?.history;
  if (Array.isArray(history)) {
    if (takeover?.clearHistory === true && history.length) {
      history.splice(0, history.length);
      changed = true;
    }
    const trimTo = Number(takeover?.trimHistoryTo);
    if (Number.isFinite(trimTo) && trimTo >= 0 && history.length > trimTo) {
      history.splice(0, history.length - trimTo);
      changed = true;
    }
  }

  const memoryNote = String(takeover?.memoryNote || takeover?.injectSystemNote || "").trim();
  if (memoryNote && Array.isArray(agentContext?.payload?.messages?.system)) {
    const marker = String(takeover?.id || "harness-memory-takeover").trim();
    const content = `<!-- ${marker} -->\n${memoryNote}`;
    if (!isMessageInjected(agentContext.payload.messages.system, marker, content)) {
      agentContext.payload.messages.system.unshift({ role: "system", content });
      changed = true;
    }
  }

  return changed;
}

function applyMemoryTakeover(point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  let changed = false;
  if (point === "before_state_commit") {
    changed = applyMemoryTakeoverForStateCommit(ctx, takeover) || changed;
  }
  changed = applyMemoryTakeoverForAgentContext(ctx, takeover) || changed;
  return changed;
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
        const toolTakeoverDirective =
          result?.toolTakeover ||
          result?.takeover?.tool ||
          result?.directives?.toolTakeover ||
          null;
        const messageTakeoverDirective =
          result?.messageTakeover ||
          result?.systemMessageTakeover ||
          result?.takeover?.message ||
          result?.directives?.messageTakeover ||
          result?.directives?.systemMessageTakeover ||
          null;
        const memoryTakeoverDirective =
          result?.memoryTakeover ||
          result?.takeover?.memory ||
          result?.directives?.memoryTakeover ||
          null;
        if (toolTakeoverDirective) {
          pendingToolTakeovers.push({
            directive: toolTakeoverDirective,
            ...resolveTakeoverPriority({
              kind: "tool",
              point,
              ctx,
              directive: toolTakeoverDirective,
              profile: profileState,
              sequence: sequence++,
            }),
          });
        }
        if (messageTakeoverDirective) {
          pendingMessageTakeovers.push({
            directive: messageTakeoverDirective,
            ...resolveTakeoverPriority({
              kind: "message",
              point,
              ctx,
              directive: messageTakeoverDirective,
              profile: profileState,
              sequence: sequence++,
            }),
          });
        }
        if (memoryTakeoverDirective) {
          pendingMemoryTakeovers.push({
            directive: memoryTakeoverDirective,
            ...resolveTakeoverPriority({
              kind: "memory",
              point,
              ctx,
              directive: memoryTakeoverDirective,
              profile: profileState,
              sequence: sequence++,
            }),
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
