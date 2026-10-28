/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { MESSAGE_ORIGIN } from "@noobot/session-protocol";
import { RoleEnum } from "../../model/chatConstants.js";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { text } from "@noobot/shared/value";

function toDraftAttachmentMeta(uploadFile, isImageMime) {
  return {
    clientAttachmentId: uploadFile.clientAttachmentId,
    name: uploadFile.name,
    mimeType: uploadFile.mimeType,
    size: uploadFile.size,
    previewUrl: isImageMime(uploadFile.mimeType) ? URL.createObjectURL(uploadFile.raw) : "",
  };
}

function applySessionTitleFromText({ activeSession, translate, messageText }) {
  if (!messageText) return;
  const defaultTitles = [
    text(translate("chat.newSession")),
    text(zhCNMessages.chat.newSession),
    text(enUSMessages.chat.newSession),
  ];
  if (!defaultTitles.includes(text(activeSession.value.title))) return;
  activeSession.value.title = messageText.slice(0, 20);
}

function prepareComposerUserMessage({ request, appendMessage, isImageMime }) {
  return appendMessage(
    RoleEnum.USER,
    request.messageText,
    request.attachmentFiles.map((uploadFile) => toDraftAttachmentMeta(uploadFile, isImageMime)),
    {
      userMessageId: request.userMessageId,
      turnScopeId: request.turnScopeId,
      messageOrigin: MESSAGE_ORIGIN.NATURAL,
    },
  );
}

function prepareResendUserMessage({ request, activeSession }) {
  const userMessage = activeSession.value.messages.find(
    (message) => message.userMessageId === request.userMessageId,
  );
  if (!userMessage) throw new TypeError("resend_user_message_missing");
  userMessage.turnScopeId = request.turnScopeId;
  userMessage.attachments = request.attachments.map((attachment) => ({ ...attachment }));
  return userMessage;
}

export function prepareChatSend({
  request,
  input,
  isImageMime,
  appendMessage,
  upsertCanonicalAssistantMessage,
  activeSession,
  translate,
  requestTurnNavigation,
}) {
  input.value = "";
  const userMessage =
    request.commandType === AGENT_COMMAND.RESEND
      ? prepareResendUserMessage({ request, activeSession })
      : prepareComposerUserMessage({ request, appendMessage, isImageMime });
  applySessionTitleFromText({ activeSession, translate, messageText: request.authoredText });

  const botMessage = upsertCanonicalAssistantMessage(request.presentationMessageId, {
    sessionId: request.sessionId,
    turnScopeId: request.turnScopeId,
  });

  let navigatedOnFirstResponse = false;
  const navigateOnFirstResponseOnce = () => {
    if (navigatedOnFirstResponse) return;
    navigatedOnFirstResponse = true;
    requestTurnNavigation({ sessionId: request.sessionId, turnScopeId: request.turnScopeId });
  };

  return { userMessage, botMessage, navigateOnFirstResponseOnce };
}
