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
  resolveModelMessageBlocks,
  resolveModelMessages,
  writeMessageBlocks,
} from "../../core/message-store.js";

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
    isSystemLikeRole(resolveMessageRole(messages[index])) &&
    messages[index]?.[HARNESS_INJECTED_MESSAGE_FLAG_FIELD] !== HARNESS_INJECTED_MESSAGE_FLAG_VALUE
  ) {
    index += 1;
  }
  return index;
}

function filterInternalForcedMessages(messages = [], directive = {}) {
  if (!Array.isArray(messages)) return { messages: [], removed: 0 };
  const removeAll = directive?.cancelInternalForcedMessages === true;
  const removeTypesInput =
    directive?.removeInternalMessageTypes ||
    directive?.stripInternalMessageTypes ||
    directive?.blockInternalMessageTypes ||
    [];
  const removeTypes = Array.isArray(removeTypesInput)
    ? new Set(removeTypesInput.map((item) => String(item || "").trim()).filter(Boolean))
    : new Set();
  if (!removeAll && !removeTypes.size) return { messages: [...messages], removed: 0 };
  const retained = messages.filter((message) => {
    const marker = resolveInternalMessageType(message);
    return !marker || (!removeAll && !removeTypes.has(marker));
  });
  return { messages: retained, removed: messages.length - retained.length };
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

function isSystemLikeRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "system" || normalized === "developer";
}

function resolveBlockForMessage(message = {}) {
  return isSystemLikeRole(resolveMessageRole(message)) ? "system" : "incremental";
}

function cloneBlocks(blocks = {}) {
  return {
    system: Array.isArray(blocks.system) ? [...blocks.system] : [],
    history: Array.isArray(blocks.history) ? [...blocks.history] : [],
    incremental: Array.isArray(blocks.incremental) ? [...blocks.incremental] : [],
  };
}

function removeInternalForcedMessagesFromBlocks(blocks = {}, directive = {}, blockNames = []) {
  let removed = 0;
  for (const blockName of blockNames) {
    const result = filterInternalForcedMessages(blocks[blockName], directive);
    blocks[blockName] = result.messages;
    removed += result.removed;
  }
  return removed;
}

function applyCtxMessagesTakeover(ctx = {}, directive = {}) {
  const currentMessages = resolveModelMessages(ctx);
  const blocks = cloneBlocks(resolveModelMessageBlocks(ctx));
  const removed = removeInternalForcedMessagesFromBlocks(
    blocks,
    directive,
    ["system", "history", "incremental"],
  );
  const takeoverMessage = buildTakeoverMessage(directive);
  if (!takeoverMessage) {
    if (removed) writeMessageBlocks(ctx, blocks);
    return removed > 0;
  }
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const { id, messageContent, message: nextMessage } = takeoverMessage;
  if (dedupe && isMessageInjected(currentMessages, id, messageContent)) {
    if (removed) writeMessageBlocks(ctx, blocks);
    return removed > 0;
  }
  const block = resolveBlockForMessage(nextMessage);

  if (mode === "replace") {
    writeMessageBlocks(ctx, {
      system: block === "system" ? [nextMessage] : [],
      history: [],
      incremental: block === "incremental" ? [nextMessage] : [],
    });
    return true;
  }
  if (mode === "append") {
    blocks[block].push(nextMessage);
    writeMessageBlocks(ctx, blocks);
    return true;
  }
  if (block === "system") {
    blocks.system.splice(findAfterLeadingSystemIndex(blocks.system), 0, nextMessage);
    writeMessageBlocks(ctx, blocks);
    return true;
  }
  blocks.incremental.unshift(nextMessage);
  writeMessageBlocks(ctx, blocks);
  return true;
}

function applyAgentSystemTakeover(ctx = {}, directive = {}) {
  const blocks = cloneBlocks(resolveModelMessageBlocks(ctx));
  const removed = removeInternalForcedMessagesFromBlocks(blocks, directive, ["system"]);
  const takeoverMessage = buildTakeoverMessage(directive);
  if (!takeoverMessage) {
    if (removed) writeMessageBlocks(ctx, blocks);
    return removed > 0;
  }
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const { id, messageContent, message: nextMessage } = takeoverMessage;
  if (dedupe && isMessageInjected(blocks.system, id, messageContent)) {
    if (removed) writeMessageBlocks(ctx, blocks);
    return removed > 0;
  }
  if (mode === "replace") blocks.system = [nextMessage];
  else if (mode === "append") blocks.system.push(nextMessage);
  else blocks.system.unshift(nextMessage);
  writeMessageBlocks(ctx, blocks);
  return true;
}

export function applyMessageTakeover(_point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  const target = String(takeover?.target || "auto").trim();
  if (target === "ctx_messages") return applyCtxMessagesTakeover(ctx, takeover);
  if (target === "agent_system") return applyAgentSystemTakeover(ctx, takeover);
  if (target !== "auto") return false;
  // The former auto target wrote two independent message sources. With the
  // versioned model context there is one authority, so auto applies once to it.
  return applyCtxMessagesTakeover(ctx, takeover);
}
