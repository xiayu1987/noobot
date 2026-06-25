/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isMessageInjected } from "./shared.js";
import {
  HARNESS_INJECTED_MESSAGE_BY_FIELD,
  HARNESS_INJECTED_MESSAGE_BY_VALUE,
  HARNESS_INJECTED_MESSAGE_FLAG_FIELD,
  HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
  HARNESS_INJECTION_MESSAGE_ROLE,
} from "../handlers/shared/constants.js";
import {
  appendMessage,
  replaceMessages,
} from "../../core/message-store.js";

function resolveTakeoverTargets(ctx = {}, target = "auto") {
  const targets = [];
  if ((target === "auto" || target === "ctx_messages") && Array.isArray(ctx?.messages)) {
    targets.push({ type: "ctx_messages", messages: ctx.messages });
  }
  if (
    (target === "auto" || target === "agent_system") &&
    Array.isArray(ctx?.agentContext?.payload?.messages?.system)
  ) {
    targets.push({ type: "agent_system", messages: ctx.agentContext.payload.messages.system });
  }
  return targets;
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

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function findAfterLeadingSystemIndex(messages = []) {
  let index = 0;
  while (
    index < messages.length &&
    resolveMessageRole(messages[index]) === "system" &&
    messages[index]?.[HARNESS_INJECTED_MESSAGE_FLAG_FIELD] !== HARNESS_INJECTED_MESSAGE_FLAG_VALUE
  ) {
    index += 1;
  }
  return index;
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

function buildTakeoverMessage(directive = {}) {
  const id = String(directive?.id || "").trim();
  const content = String(
    directive?.content ?? directive?.text ?? directive?.message ?? "",
  ).trim();
  if (!content) return null;
  const messageContent = id ? `<!-- ${id} -->\n${content}` : content;
  return {
    id,
    messageContent,
    message: {
      role: HARNESS_INJECTION_MESSAGE_ROLE,
      content: messageContent,
      [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
      [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
    },
  };
}

function applyAgentSystemTakeover(messages = [], directive = {}, { preserveLeadingSystem = true } = {}) {
  if (!Array.isArray(messages)) return false;
  const removed = removeInternalForcedMessages(messages, directive);
  const takeoverMessage = buildTakeoverMessage(directive);
  if (!takeoverMessage) return removed > 0;
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const { id, messageContent, message: nextMessage } = takeoverMessage;
  if (dedupe && isMessageInjected(messages, id, messageContent)) {
    if (removed) replaceMessages(ctx, messages);
    return removed > 0;
  }

  if (mode === "replace") {
    messages.splice(0, messages.length, nextMessage);
    return true;
  }
  if (mode === "append") {
    messages.push(nextMessage);
    return true;
  }
  if (preserveLeadingSystem) {
    messages.splice(findAfterLeadingSystemIndex(messages), 0, nextMessage);
  } else {
    messages.unshift(nextMessage);
  }
  return true;
}

function applyCtxMessagesTakeover(ctx = {}, directive = {}) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const removed = removeInternalForcedMessages(messages, directive);
  const takeoverMessage = buildTakeoverMessage(directive);
  if (!takeoverMessage) {
    if (removed) replaceMessages(ctx, messages);
    return removed > 0;
  }
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const { id, messageContent, message: nextMessage } = takeoverMessage;
  if (dedupe && isMessageInjected(messages, id, messageContent)) return false;

  if (mode === "replace") {
    replaceMessages(ctx, [nextMessage]);
    return true;
  }
  if (mode === "append") {
    appendMessage(ctx, nextMessage, { block: "incremental" });
    return true;
  }
  const nextMessages = [...messages];
  nextMessages.splice(findAfterLeadingSystemIndex(nextMessages), 0, nextMessage);
  replaceMessages(ctx, nextMessages);
  return true;
}

export function applyMessageTakeover(_point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  const target = String(takeover?.target || "auto").trim();
  const targets = resolveTakeoverTargets(ctx, target);
  if (!targets.length) return false;
  let changed = false;
  for (const item of targets) {
    if (item.type === "ctx_messages") {
      changed = applyCtxMessagesTakeover(ctx, takeover) || changed;
      continue;
    }
    changed = applyAgentSystemTakeover(item.messages, takeover, { preserveLeadingSystem: false }) || changed;
  }
  return changed;
}
