/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachmentMetas } from "../../infra/dialogProcessChain";

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

  function mergeAssistantAttachmentMetas(targetAssistantMessage, attachmentMetas = []) {
    if (!targetAssistantMessage || !Array.isArray(attachmentMetas) || !attachmentMetas.length) {
      return;
    }
    const normalizedAttachmentMetas =
      makeViewMessage({ attachmentMetas })?.attachmentMetas || attachmentMetas;
    targetAssistantMessage.attachmentMetas = mergeAttachmentMetas(
      Array.isArray(targetAssistantMessage.attachmentMetas)
        ? targetAssistantMessage.attachmentMetas
        : [],
      normalizedAttachmentMetas,
    );
  }

  return {
    applyAssistantFailureState,
    mergeAssistantAttachmentMetas,
  };
}
