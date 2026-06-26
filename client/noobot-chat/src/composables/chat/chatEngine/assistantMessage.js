/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachments } from "../../infra/dialogProcessChain";

export function createAssistantMessageHelpers({ translate, makeViewMessage }) {
  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    targetAssistantMessage.statusLabel = translate("chat.failed");
    targetAssistantMessage.error = String(errorMessage || "").trim();
    if (!String(targetAssistantMessage.content || "").trim()) {
      targetAssistantMessage.content = `> ${translate("chat.occurredError", {
        error: targetAssistantMessage.error || translate("chat.unknownError"),
      })}`;
    }
  }

  function mergeAssistantAttachments(targetAssistantMessage, attachments = []) {
    if (!targetAssistantMessage || !Array.isArray(attachments) || !attachments.length) {
      return;
    }
    const normalizedAttachments =
      makeViewMessage({ attachments })?.attachments || attachments;
    targetAssistantMessage.attachments = mergeAttachments(
      Array.isArray(targetAssistantMessage.attachments)
        ? targetAssistantMessage.attachments
        : [],
      normalizedAttachments,
    );
  }

  return {
    applyAssistantFailureState,
    mergeAssistantAttachments,
  };
}
