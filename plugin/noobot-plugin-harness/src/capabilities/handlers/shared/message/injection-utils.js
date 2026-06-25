/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isHarnessAgentTurnEnded } from "../runtime/lifecycle-utils.js";
import {
  persistHarnessMessageToCurrentTurn,
  buildHarnessInjectedMessage,
} from "./injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "../runtime/dialog-process-id.js";
import { appendMessage, replaceMessages } from "../../../../core/message-store.js";

function hasPendingToolCallPair(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index] || {};
    const role = String(msg?.role || "").trim().toLowerCase();
    if (role !== "assistant") continue;
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) return false;
    const callIds = new Set(
      calls
        .map((call = {}) =>
          String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim(),
        )
        .filter(Boolean),
    );
    if (!callIds.size) return false;
    const matchedToolIds = new Set();
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const next = messages[cursor] || {};
      if (String(next?.role || "").trim().toLowerCase() !== "tool") continue;
      const toolCallId = String(next?.tool_call_id || "").trim();
      if (toolCallId && callIds.has(toolCallId)) matchedToolIds.add(toolCallId);
    }
    return matchedToolIds.size < callIds.size;
  }
  return false;
}

function resolveSystemContextMessages(ctx = {}) {
  const list = ctx?.agentContext?.payload?.messages?.system;
  return Array.isArray(list) ? list : null;
}

function dedupeExists(messages = [], target = {}) {
  const role = String(target?.role || "").trim();
  const content = String(target?.content || "").trim();
  if (!Array.isArray(messages) || !role || !content) return false;
  return messages.some((item = {}) => {
    const itemRole = String(item?.role || "").trim();
    const itemContent = String(item?.content || "").trim();
    return itemRole === role && itemContent === content;
  });
}

const CACHE_FRIENDLY_INCREMENTAL_INJECTION_PREFIXES = Object.freeze([
  "planning_",
  "guidance_",
  "acceptance_",
  "separate_model_relay:",
]);

function isCacheFriendlyIncrementalInjectionType(injectedMessageType = "", injectionType = "") {
  const type = String(injectedMessageType || injectionType || "").trim().toLowerCase();
  if (!type) return false;
  return CACHE_FRIENDLY_INCREMENTAL_INJECTION_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function resolveHarnessMainFlowRole({
  role = "system",
  injectedMessageType = "",
  injectionType = "",
} = {}) {
  const requestedRole = String(role || "system").trim().toLowerCase();
  // Current-turn harness prompts are dynamic. If they are inserted as system
  // messages before history, provider prefix-cache invalidation makes the
  // otherwise stable history expensive. Keep stable harness policy prompts in
  // the real system block (they use prompt-injector, not this helper), but map
  // dynamic main-flow injections to user/incremental so they are compacted
  // after history.
  if (requestedRole === "system" && isCacheFriendlyIncrementalInjectionType(injectedMessageType, injectionType)) {
    return "user";
  }
  if (requestedRole === "user") return "user";
  return requestedRole || "system";
}

export function injectMessageWithPolicy(
  ctx = {},
  {
    role = "system",
    content = "",
    attachmentMetas = [],
    legacyAttachmentMetasMirror = false,
    transferResult = null,
    transferEnvelopes = [],
    injectAt = "append",
    dedupe = false,
    injectedMessageType = "",
    injectionType = "",
    avoidBreakToolCallContinuity = true,
    persistToCurrentTurn = true,
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  // Plugin-to-main-flow injections are tagged so they can be persisted/rendered
  // separately from real user turns. Dynamic harness prompts are resolved to
  // user/incremental by injectedMessageType to keep history prefix-cacheable;
  // stable harness policy prompts are injected through prompt-injector as real
  // system messages.
  const normalizedContent = String(content || "").trim();
  if (!messages || !normalizedContent) return { injected: false, target: "none" };
  if (isHarnessAgentTurnEnded(ctx)) {
    return { injected: false, target: "none", blockedByTurnEnded: true };
  }
  const resolvedRole = resolveHarnessMainFlowRole({ role, injectedMessageType, injectionType });
  const message = buildHarnessInjectedMessage(normalizedContent, {
    role: resolvedRole,
    attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
    legacyAttachmentMetasMirror,
    transferResult,
    transferEnvelopes,
    transferEnvelopes,
    dialogProcessId: resolveDialogProcessIdFromContext(ctx),
    injectedMessageType,
    injectionType,
  });

  if (dedupe && dedupeExists(messages, message)) {
    return { injected: false, target: "ctx_messages", deduped: true };
  }

  const normalizedInjectAt = String(injectAt || "append").trim().toLowerCase();
  const shouldProtectContinuity =
    avoidBreakToolCallContinuity === true &&
    resolvedRole === "system" &&
    normalizedInjectAt === "append" &&
    hasPendingToolCallPair(messages);
  if (shouldProtectContinuity) {
    const systemContextMessages = resolveSystemContextMessages(ctx);
    if (systemContextMessages) {
      if (dedupe && dedupeExists(systemContextMessages, message)) {
        return { injected: false, target: "agent_system", deduped: true };
      }
      // System context is a string-only channel; persist the tagged roleful
      // copy for session display while keeping the model context protocol-safe.
      systemContextMessages.push(normalizedContent);
      persistHarnessMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
      return { injected: true, target: "agent_system" };
    }
  }

  if (normalizedInjectAt === "prepend") {
    replaceMessages(ctx, [message, ...messages]);
  } else {
    appendMessage(ctx, message, { block: "incremental" });
  }
  persistHarnessMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
  return { injected: true, target: "ctx_messages" };
}
