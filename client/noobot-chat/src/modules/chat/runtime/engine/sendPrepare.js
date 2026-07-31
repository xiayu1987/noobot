/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../model/chatConstants.js";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { BackendChannelState } from "../sessionRunStateMachine.js";
import { nowMs, toIsoTime } from "../../model/timeFields.js";
import { mergeAttachments } from "../../model/dialogProcessChain.js";

export function prepareChatSend({
  input,
  uploadFiles,
  isImageMime,
  appendMessage,
  upsertCanonicalAssistantMessage,
  activeSession,
  applyConversationState,
  translate,
  navigateToLastMessage,
  messageText = "",
  turnScopeId = "",
  userMessageId = "",
  assistantMessageId = "",
  reuseExistingUserTurn = false,
  attachmentFiles = null,
  userAttachments = null,
  turnStartedAtMs = 0,
}) {
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const explicitText = typeof messageText === "string" ? messageText.trim() : "";
  const text = explicitText || input.value.trim();
  input.value = "";

  const filesToSend = Array.isArray(attachmentFiles) ? [...attachmentFiles] : [...uploadFiles.value];
  const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || "");
  const resolvedUserAttachments = Array.isArray(userAttachments) ? [...userAttachments] : filesToSend.map((fileItem) => {
    const clientAttachmentId = String(
      fileItem?.clientAttachmentId || fileItem?.draftAttachmentId || "",
    ).trim();
    return {
      ...(clientAttachmentId ? { clientAttachmentId } : {}),
      name: fileItem.name,
      mimeType: fileItem.mimeType,
      size: fileItem.size,
      previewUrl: isImageMime(fileItem.mimeType || "")
        ? URL.createObjectURL(fileItem.raw)
        : "",
    };
  });
  const userMessage = reuseExistingUserTurn
    ? (activeSession.value?.messages || []).find((message) => (
      String(message?.messageId || "").trim() === String(userMessageId || "").trim()
    ))
    : appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), resolvedUserAttachments, {
      id: userMessageId,
      messageId: userMessageId,
      sessionId,
      turnScopeId: normalizedTurnScopeId,
      frontendUserMessage: true,
    });
  if (userMessage && normalizedTurnScopeId) {
    userMessage.turnScopeId = normalizedTurnScopeId;
  }
  if (userMessage && Array.isArray(userAttachments)) {
    userMessage.attachments = resolvedUserAttachments.length === 0
      ? []
      : mergeAttachments(userMessage.attachments || [], resolvedUserAttachments)
        .map((attachment) => ({ ...attachment }));
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

  const botMessage = upsertCanonicalAssistantMessage(assistantMessageId, {
    sessionId,
    turnScopeId: normalizedTurnScopeId,
  });
  const resolvedTurnStartedAtMs = Number(turnStartedAtMs) > 0
    ? Number(turnStartedAtMs)
    : nowMs();
  const thinkingStartedAt = toIsoTime(resolvedTurnStartedAtMs);
  if (normalizedTurnScopeId) {
    activeSession.value.turnTimingsByTurnScopeId = {
      ...(activeSession.value.turnTimingsByTurnScopeId || {}),
      [normalizedTurnScopeId]: {
        thinkingStartedAt,
        thinkingFinishedAt: null,
      },
    };
  }
  applyConversationState(
    {
      state: BackendChannelState.SENDING,
      sessionId,
      turnScopeId: botMessage.turnScopeId,
      createdAtMs: resolvedTurnStartedAtMs,
      createdAt: thinkingStartedAt,
    },
    { botMessage },
  );

  let navigatedOnFirstResponse = false;
  const navigateOnFirstResponseOnce = () => {
    if (navigatedOnFirstResponse) return;
    navigatedOnFirstResponse = true;
    navigateToLastMessage?.();
  };

  return {
    text,
    filesToSend,
    userMessage,
    botMessage,
    navigateOnFirstResponseOnce,
  };
}
