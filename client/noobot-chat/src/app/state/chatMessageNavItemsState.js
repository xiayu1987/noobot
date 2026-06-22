import { getMessageRole } from "../../composables/infra/messageIdentity";

export function normalizeChatMessageNavContent(messageItem = {}) {
  return String(messageItem?.content || messageItem?.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildChatMessageNavItem({
  messageItem = {},
  messageIndex = 0,
  getMessageAnchorId,
  translateSession,
} = {}) {
  const anchorId = typeof getMessageAnchorId === "function"
    ? getMessageAnchorId(messageItem, messageIndex)
    : "";
  const fallbackRole = typeof translateSession === "function" ? translateSession() : "session";
  const role = getMessageRole(messageItem) || fallbackRole;
  const content = normalizeChatMessageNavContent(messageItem);
  return {
    id: anchorId || `chat-message-${messageIndex}`,
    title: `${messageIndex + 1}. ${role}${content ? `：${content.slice(0, 28)}` : ""}`,
  };
}

export function buildChatMessageNavItems({
  messages = [],
  shouldRenderMessageInChat,
  getMessageAnchorId,
  translateSession,
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
      });
    })
    .filter(Boolean);
}
