/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachments } from "../../model/dialogProcessChain.js";
import { text } from "@noobot/shared/value";

export function createAssistantMessageHelpers({ translate, makeViewAttachments }) {
  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    if (!targetAssistantMessage) return;
    targetAssistantMessage.error = text(errorMessage);
    if (!text(targetAssistantMessage.content)) {
      targetAssistantMessage.content = `> ${translate("chat.occurredError", {
        error: targetAssistantMessage.error || translate("chat.unknownError"),
      })}`;
    }
  }

  function mergeAssistantAttachments(targetAssistantMessage, attachments = []) {
    if (!targetAssistantMessage || !Array.isArray(attachments) || !attachments.length) {
      return;
    }
    const normalizedAttachments = makeViewAttachments(attachments);
    targetAssistantMessage.attachments = mergeAttachments(
      Array.isArray(targetAssistantMessage.attachments) ? targetAssistantMessage.attachments : [],
      normalizedAttachments,
    );
  }

  return {
    applyAssistantFailureState,
    mergeAssistantAttachments,
  };
}
