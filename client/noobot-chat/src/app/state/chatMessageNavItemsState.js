/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../modules/chat/model/chatConstants.js";
import { getMessageRole, getMessageTurnScopeId } from "../../modules/chat/model/messageIdentity.js";
import { getMessageAnchorId } from "../../modules/chat/model/messageAnchor.js";
import { requireFunctionDependencies } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const ROLE_LABEL_KEYS = Object.freeze({
  [RoleEnum.USER]: "message.me",
  [RoleEnum.ASSISTANT]: "message.ai",
  [RoleEnum.TOOL]: "message.tool",
});

const UNCLASSIFIED_ROLE_LABEL_KEY = "common.session";

export function resolveChatMessageNavRoleLabelKey(role) {
  return Object.hasOwn(ROLE_LABEL_KEYS, role) ? ROLE_LABEL_KEYS[role] : UNCLASSIFIED_ROLE_LABEL_KEY;
}

export function normalizeChatMessageNavContent(messageItem) {
  if (typeof messageItem.content !== "string") {
    throw new TypeError("chat_message_nav_content_not_string");
  }
  return messageItem.content.replace(/\s+/g, " ").trim();
}

export function buildChatMessageNavItem({ messageItem, messageIndex, translate }) {
  requireFunctionDependencies("buildChatMessageNavItem", { translate });
  const role = getMessageRole(messageItem);
  const roleLabel = translate(resolveChatMessageNavRoleLabelKey(role));
  const content = normalizeChatMessageNavContent(messageItem);
  return {
    id: getMessageAnchorId(messageItem, messageIndex),
    turnScopeId: getMessageTurnScopeId(messageItem),
    role,
    roleLabel,
    content,
    preview: content.slice(0, LENGTH_THRESHOLDS.clientPreview.chatMessageNavChars),
    title: `${messageIndex + 1}. ${roleLabel}${content ? `：${content}` : ""}`,
  };
}

export function buildChatMessageNavItems({ messages, shouldRenderMessageInChat, translate }) {
  requireFunctionDependencies("buildChatMessageNavItems", { shouldRenderMessageInChat, translate });
  if (!Array.isArray(messages)) throw new TypeError("chat_message_nav_messages_not_array");
  return messages.flatMap((messageItem, messageIndex) =>
    shouldRenderMessageInChat(messageItem)
      ? [buildChatMessageNavItem({ messageItem, messageIndex, translate })]
      : [],
  );
}

export function resolveChatMessageNavTarget(items, turnScopeId) {
  if (!Array.isArray(items)) throw new TypeError("chat_message_nav_items_not_array");
  if (!items.length) return null;
  const targetTurnScopeId = turnScopeId || items[items.length - 1].turnScopeId;
  return items.find((item) => item.turnScopeId === targetTurnScopeId) ?? null;
}
