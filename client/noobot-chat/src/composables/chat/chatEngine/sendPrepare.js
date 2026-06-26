/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { rememberThinkingStarted } from "../thinkingTimingRegistry";
import { nowMs, toIsoTime, setThinkingStartedAt } from "../../infra/timeFields";

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
  turnScopeId = "",
}) {
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
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
  if (userMessage && normalizedTurnScopeId) {
    userMessage.turnScopeId = normalizedTurnScopeId;
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
  const thinkingStartedAtMs = nowMs();
  const thinkingStartedAt = toIsoTime(thinkingStartedAtMs);
  botMessage.sessionId = sessionId;
  botMessage.session_id = sessionId;
  setThinkingStartedAt(botMessage, thinkingStartedAt);
  botMessage.pending = true;
  botMessage.hasFirstStreamEvent = false;
  botMessage.statusLabel = "";
  botMessage.attachments = [];
  botMessage.realtimeLogs = [];
  botMessage.completedToolLogs = [];
  botMessage.tool_calls = [];
  botMessage.executionLogTotal = 0;
  botMessage.turnScopeId = normalizedTurnScopeId;
  rememberThinkingStarted({
    sessionId,
    turnScopeId: botMessage.turnScopeId,
    startedAtMs: thinkingStartedAtMs,
  });
  applyConversationState(
    {
      state: "sending",
      sessionId,
      turnScopeId: botMessage.turnScopeId,
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
