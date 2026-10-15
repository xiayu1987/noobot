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
import { text } from "@noobot/shared/value";

function toDraftAttachmentMeta(fileItem, isImageMime) {
  const clientAttachmentId = text(fileItem?.clientAttachmentId || fileItem?.draftAttachmentId);
  return {
    ...(clientAttachmentId ? { clientAttachmentId } : {}),
    name: fileItem.name,
    mimeType: fileItem.mimeType,
    size: fileItem.size,
    previewUrl: isImageMime(fileItem.mimeType || "") ? URL.createObjectURL(fileItem.raw) : "",
  };
}

function resolveUserAttachments({ userAttachments, filesToSend, isImageMime }) {
  if (Array.isArray(userAttachments)) return [...userAttachments];
  return filesToSend.map((fileItem) => toDraftAttachmentMeta(fileItem, isImageMime));
}

function findExistingUserMessage(activeSession, userMessageId) {
  const targetId = text(userMessageId);
  return (activeSession.value?.messages || []).find(
    (message) => text(message?.messageId) === targetId,
  );
}

function applyUserMessageIdentity({
  userMessage,
  normalizedTurnScopeId,
  userAttachments,
  resolvedUserAttachments,
}) {
  if (!userMessage) return;
  if (normalizedTurnScopeId) {
    userMessage.turnScopeId = normalizedTurnScopeId;
  }
  if (!Array.isArray(userAttachments)) return;
  userMessage.attachments =
    resolvedUserAttachments.length === 0
      ? []
      : mergeAttachments(userMessage.attachments || [], resolvedUserAttachments).map(
          (attachment) => ({ ...attachment }),
        );
}

function applySessionTitleFromText({ activeSession, translate, text: sourceText }) {
  if (!sourceText) return;
  const defaultTitles = [
    text(translate("chat.newSession")),
    text(zhCNMessages?.chat?.newSession),
    text(enUSMessages?.chat?.newSession),
  ];
  if (!defaultTitles.includes(text(activeSession.value.title))) return;
  activeSession.value.title = sourceText.slice(0, 20);
}

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
  const normalizedTurnScopeId = text(turnScopeId);
  const explicitText = typeof messageText === "string" ? messageText.trim() : "";
  const normalizedText = explicitText || input.value.trim();
  input.value = "";

  const filesToSend = Array.isArray(attachmentFiles)
    ? [...attachmentFiles]
    : [...uploadFiles.value];
  const sessionId = String(activeSession.value?.sessionId || "");
  const resolvedUserAttachments = resolveUserAttachments({
    userAttachments,
    filesToSend,
    isImageMime,
  });
  const userMessage = reuseExistingUserTurn
    ? findExistingUserMessage(activeSession, userMessageId)
    : appendMessage(
        RoleEnum.USER,
        normalizedText || translate("chat.uploadOnly"),
        resolvedUserAttachments,
        {
          id: userMessageId,
          messageId: userMessageId,
          sessionId,
          turnScopeId: normalizedTurnScopeId,
          messageOrigin: "natural",
          userMetaMaterialized: true,
        },
      );
  applyUserMessageIdentity({
    userMessage,
    normalizedTurnScopeId,
    userAttachments,
    resolvedUserAttachments,
  });
  applySessionTitleFromText({ activeSession, translate, text: normalizedText });

  const botMessage = upsertCanonicalAssistantMessage(assistantMessageId, {
    sessionId,
    turnScopeId: normalizedTurnScopeId,
  });
  const resolvedTurnStartedAtMs = Number(turnStartedAtMs) > 0 ? Number(turnStartedAtMs) : nowMs();
  const thinkingStartedAt = toIsoTime(resolvedTurnStartedAtMs);
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
    text: normalizedText,
    filesToSend,
    userMessage,
    botMessage,
    navigateOnFirstResponseOnce,
  };
}
