/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isHarnessAgentTurnEnded } from "./lifecycle-utils.js";
import {
  persistHarnessMessageToCurrentTurn,
  buildHarnessInjectedMessage,
} from "./injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "./dialog-process-id.js";

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

export function injectMessageWithPolicy(
  ctx = {},
  {
    role = "system",
    content = "",
    attachmentMetas = [],
    injectAt = "append",
    dedupe = false,
    avoidBreakToolCallContinuity = true,
    persistToCurrentTurn = true,
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  void role;
  // Plugin-to-main-flow injections are user-role messages, tagged so they can
  // be persisted and rendered separately from real user turns.
  const normalizedContent = String(content || "").trim();
  if (!messages || !normalizedContent) return { injected: false, target: "none" };
  if (isHarnessAgentTurnEnded(ctx)) {
    return { injected: false, target: "none", blockedByTurnEnded: true };
  }
  const message = buildHarnessInjectedMessage(normalizedContent, {
    attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
    dialogProcessId: resolveDialogProcessIdFromContext(ctx),
  });

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
      // System context is a string-only channel; persist the tagged user-role
      // copy for session display while keeping the model context protocol-safe.
      systemContextMessages.push(normalizedContent);
      persistHarnessMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
      return { injected: true, target: "agent_system" };
    }
  }

  if (normalizedInjectAt === "prepend") {
    messages.unshift(message);
  } else {
    messages.push(message);
  }
  persistHarnessMessageToCurrentTurn(ctx, message, persistToCurrentTurn);
  return { injected: true, target: "ctx_messages" };
}
