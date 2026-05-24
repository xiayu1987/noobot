/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isHarnessAgentTurnEnded } from "./lifecycle-utils.js";
import { HARNESS_INJECTION_MESSAGE_ROLE } from "./constants.js";

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

function resolveCurrentTurnMessagesStore(ctx = {}) {
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : {};
  const store = runtime?.currentTurnMessages;
  return store && typeof store.push === "function" ? store : null;
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

function persistMessageToCurrentTurn(ctx = {}, message = {}, enabled = false) {
  if (enabled !== true) return false;
  const currentTurnMessages = resolveCurrentTurnMessagesStore(ctx);
  if (!currentTurnMessages) return false;
  currentTurnMessages.push({
    ...message,
    type: "message",
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
  });
  return true;
}

export function injectMessageWithPolicy(
  ctx = {},
  {
    role = "system",
    content = "",
    injectAt = "append",
    dedupe = false,
    avoidBreakToolCallContinuity = true,
    persistToCurrentTurn = false,
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  void role;
  // Plugin-to-main-flow injections are always normalized as system messages
  // to keep role semantics consistent across all harness capabilities.
  const normalizedRole = HARNESS_INJECTION_MESSAGE_ROLE;
  const normalizedContent = String(content || "").trim();
  if (!messages || !normalizedContent) return { injected: false, target: "none" };
  if (isHarnessAgentTurnEnded(ctx)) {
    return { injected: false, target: "none", blockedByTurnEnded: true };
  }
  const message = { role: normalizedRole, content: normalizedContent };

  if (dedupe && dedupeExists(messages, message)) {
    return { injected: false, target: "ctx_messages", deduped: true };
  }

  const normalizedInjectAt = String(injectAt || "append").trim().toLowerCase();
  const shouldProtectContinuity =
    avoidBreakToolCallContinuity === true &&
    normalizedInjectAt === "append" &&
    hasPendingToolCallPair(messages);
  if (shouldProtectContinuity) {
    const systemContextMessages = resolveSystemContextMessages(ctx);
    if (systemContextMessages) {
      if (dedupe && dedupeExists(systemContextMessages, message)) {
        return { injected: false, target: "agent_system", deduped: true };
      }
      systemContextMessages.push(message);
      persistMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
      return { injected: true, target: "agent_system" };
    }
  }

  if (normalizedInjectAt === "prepend") {
    messages.unshift(message);
  } else {
    messages.push(message);
  }
  persistMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
  return { injected: true, target: "ctx_messages" };
}
