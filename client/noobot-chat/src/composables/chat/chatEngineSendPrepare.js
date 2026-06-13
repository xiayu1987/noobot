/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../shared/constants/chatConstants";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";

export function prepareChatSend({
  input,
  uploadFiles,
  isImageMime,
  appendMessage,
  activeSession,
  applyConversationState,
  translate,
  scrollBottom,
}) {
  const text = input.value.trim();
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
  appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), userAttachments);
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

  const botMessage = appendMessage(RoleEnum.ASSISTANT, "");
  botMessage.pending = true;
  botMessage.statusLabel = "";
  botMessage.executionLogTotal = Number(botMessage.executionLogTotal || 0);
  applyConversationState(
    {
      state: "sending",
      sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || ""),
    },
    { botMessage },
  );

  let scrolledOnFirstResponse = false;
  const scrollOnFirstResponseOnce = () => {
    if (scrolledOnFirstResponse) return;
    scrolledOnFirstResponse = true;
    scrollBottom();
  };

  return {
    text,
    filesToSend,
    botMessage,
    scrollOnFirstResponseOnce,
  };
}
