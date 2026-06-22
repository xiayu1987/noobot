/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { rememberThinkingStarted } from "../thinkingTimingRegistry";

export function prepareChatSend({
  input,
  uploadFiles,
  isImageMime,
  appendMessage,
  activeSession,
  applyConversationState,
  translate,
  scrollBottom,
  skipUserMessageAppend = false,
  existingUserMessage = null,
  messageText = "",
  clientTurnId = "",
}) {
  const explicitText = typeof messageText === "string" ? messageText.trim() : "";
  const text = explicitText || input.value.trim();
  input.value = "";

  const filesToSend = [...uploadFiles.value];
  const userAttachments = filesToSend.map((fileItem) => ({
    name: fileItem.name,
    mimeType: fileItem.mimeType,
    size: fileItem.size,
    previewUrl: isImageMime(fileItem.mimeType || "")
      ? URL.createObjectURL(fileItem.raw)
      : "",
  }));
  const userMessage = skipUserMessageAppend
    ? existingUserMessage
    : appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), userAttachments);
  if (userMessage && clientTurnId) {
    userMessage.clientTurnId = String(clientTurnId || "").trim();
    userMessage.client_turn_id = String(clientTurnId || "").trim();
  }
  if (
    [
      String(translate("chat.newSession") || "").trim(),
      String(zhCNMessages?.chat?.newSession || "").trim(),
      String(enUSMessages?.chat?.newSession || "").trim(),
    ].includes(String(activeSession.value.title || "").trim()) &&
    text
  ) {
    activeSession.value.title = text.slice(0, 20);
  }

  const botMessage = appendMessage(RoleEnum.ASSISTANT, "", []);
  const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || "");
  const thinkingStartedAtMs = Date.now();
  const thinkingStartedAt = new Date(thinkingStartedAtMs).toISOString();
  botMessage.sessionId = sessionId;
  botMessage.session_id = sessionId;
  botMessage.thinkingStartedAt = thinkingStartedAt;
  botMessage.thinking_started_at = thinkingStartedAt;
  botMessage.pending = true;
  botMessage.hasFirstStreamEvent = false;
  botMessage.statusLabel = "";
  botMessage.attachmentMetas = [];
  botMessage.realtimeLogs = [];
  botMessage.completedToolLogs = [];
  botMessage.tool_calls = [];
  botMessage.executionLogTotal = 0;
  botMessage.clientTurnId = String(clientTurnId || "").trim();
  rememberThinkingStarted({
    sessionId,
    clientTurnId: botMessage.clientTurnId,
    startedAtMs: thinkingStartedAtMs,
  });
  applyConversationState(
    {
      state: "sending",
      sessionId,
      clientTurnId: botMessage.clientTurnId,
      createdAtMs: thinkingStartedAtMs,
      createdAt: thinkingStartedAt,
    },
    { botMessage },
  );

  let scrolledOnFirstResponse = false;
  const scrollOnFirstResponseOnce = () => {
    if (scrolledOnFirstResponse) return;
    scrolledOnFirstResponse = true;
  };

  return {
    text,
    filesToSend,
    userMessage,
    botMessage,
    scrollOnFirstResponseOnce,
  };
}
