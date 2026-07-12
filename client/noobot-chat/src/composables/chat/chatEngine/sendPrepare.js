/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { BackendChannelState } from "../sessionRunStateMachine";
import { nowMs, toIsoTime, setThinkingStartedAt } from "../../infra/timeFields";
import { mergeAttachments } from "../../infra/dialogProcessChain";

export function prepareChatSend({
  input,
  uploadFiles,
  isImageMime,
  appendMessage,
  activeSession,
  applyConversationState,
  translate,
  navigateToLastMessage,
  messageText = "",
  turnScopeId = "",
  reuseExistingUserTurn = false,
  attachmentFiles = null,
  userAttachments = null,
}) {
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const explicitText = typeof messageText === "string" ? messageText.trim() : "";
  const text = explicitText || input.value.trim();
  input.value = "";

  const filesToSend = Array.isArray(attachmentFiles) ? [...attachmentFiles] : [...uploadFiles.value];
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
      message?.role === RoleEnum.USER &&
      String(message?.turnScopeId || "").trim() === normalizedTurnScopeId
    ))
    : appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), resolvedUserAttachments);
  if (userMessage && normalizedTurnScopeId) {
    userMessage.turnScopeId = normalizedTurnScopeId;
  }
  if (userMessage && Array.isArray(userAttachments)) {
    // userAttachments may be a raw transport/edit payload. Session user-message
    // attachments are the UI/edit-backfill carrier, so preserve richer fields
    // from the existing message unless the user explicitly provided [] to
    // delete all attachments.
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

  const botMessage = appendMessage(RoleEnum.ASSISTANT, "", []);
  const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || "");
  const turnStartedAtMs = nowMs();
  const thinkingStartedAt = toIsoTime(turnStartedAtMs);
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
  applyConversationState(
    {
      state: BackendChannelState.SENDING,
      sessionId,
      turnScopeId: botMessage.turnScopeId,
      createdAtMs: turnStartedAtMs,
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
