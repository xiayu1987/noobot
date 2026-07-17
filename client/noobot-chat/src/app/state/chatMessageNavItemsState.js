/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../shared/constants/chatConstants";
import { getMessageRole } from "../../composables/infra/messageIdentity";

export function normalizeChatMessageNavContent(messageItem = {}) {
  return String(messageItem?.content || messageItem?.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveChatMessageNavRoleLabel(role = "", { translateRole, fallbackRole = "session" } = {}) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === RoleEnum.USER) return "ME";
  if (normalizedRole === RoleEnum.ASSISTANT) return "AI";
  if (normalizedRole === RoleEnum.TOOL) return "Tool";
  if (typeof translateRole === "function") {
    const translatedRole = String(translateRole(normalizedRole) || "").trim();
    if (translatedRole) return translatedRole;
  }
  return fallbackRole;
}

export function buildChatMessageNavItem({
  messageItem = {},
  messageIndex = 0,
  getMessageAnchorId,
  translateSession,
  translateRole,
} = {}) {
  const anchorId = typeof getMessageAnchorId === "function"
    ? getMessageAnchorId(messageItem, messageIndex)
    : "";
  const fallbackRole = typeof translateSession === "function" ? translateSession() : "session";
  const role = getMessageRole(messageItem);
  const roleLabel = resolveChatMessageNavRoleLabel(role, { translateRole, fallbackRole });
  const content = normalizeChatMessageNavContent(messageItem);
  const preview = content ? content.slice(0, 28) : "";
  return {
    id: anchorId || `chat-message-${messageIndex}`,
    role,
    roleLabel,
    content,
    preview,
    title: `${messageIndex + 1}. ${roleLabel}${content ? `：${content}` : ""}`,
  };
}

export function buildChatMessageNavItems({
  messages = [],
  shouldRenderMessageInChat,
  getMessageAnchorId,
  translateSession,
  translateRole,
} = {}) {
  if (!Array.isArray(messages)) return [];
  const canRender = typeof shouldRenderMessageInChat === "function"
    ? shouldRenderMessageInChat
    : () => true;
  return messages
    .map((messageItem = {}, messageIndex = 0) => {
      if (!canRender(messageItem)) return null;
      return buildChatMessageNavItem({
        messageItem,
        messageIndex,
        getMessageAnchorId,
        translateSession,
        translateRole,
      });
    })
    .filter(Boolean);
}
