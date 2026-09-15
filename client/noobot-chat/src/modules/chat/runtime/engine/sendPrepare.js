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

function toDraftAttachmentMeta(fileItem, isImageMime) {
  const clientAttachmentId = String(
    fileItem?.clientAttachmentId || fileItem?.draftAttachmentId || "",
  ).trim();
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
  const targetId = String(userMessageId || "").trim();
  return (activeSession.value?.messages || []).find(
    (message) => String(message?.messageId || "").trim() === targetId,
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

function applySessionTitleFromText({ activeSession, translate, text }) {
  if (!text) return;
  const defaultTitles = [
    String(translate("chat.newSession") || "").trim(),
    String(zhCNMessages?.chat?.newSession || "").trim(),
    String(enUSMessages?.chat?.newSession || "").trim(),
  ];
  if (!defaultTitles.includes(String(activeSession.value.title || "").trim())) return;
  activeSession.value.title = text.slice(0, 20);
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
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const explicitText = typeof messageText === "string" ? messageText.trim() : "";
  const text = explicitText || input.value.trim();
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
    : appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), resolvedUserAttachments, {
        id: userMessageId,
        messageId: userMessageId,
        sessionId,
        turnScopeId: normalizedTurnScopeId,
        messageOrigin: "natural",
        userMetaMaterialized: true,
      });
  applyUserMessageIdentity({
    userMessage,
    normalizedTurnScopeId,
    userAttachments,
    resolvedUserAttachments,
  });
  applySessionTitleFromText({ activeSession, translate, text });

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
    text,
    filesToSend,
    userMessage,
    botMessage,
    navigateOnFirstResponseOnce,
  };
}
