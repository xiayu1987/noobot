/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeAttachmentRefs,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

function countMessageAttachments(message) {
  const sessionAttachments = dedupeSessionAttachmentRefs(
    Array.isArray(message?.attachments) ? message.attachments : [],
  );
  const toolAttachments = Array.isArray(message?.toolTimeline)
    ? message.toolTimeline.flatMap((item) =>
        Array.isArray(item?.resultEvent?.attachments) ? item.resultEvent.attachments : [],
      )
    : [];
  const transferAttachments = dedupeAttachmentRefs([
    ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
    ...toolAttachments,
  ]);
  return sessionAttachments.length + transferAttachments.length;
}

export function buildSessionDisplayStats({
  messages,
  displayMessages,
  toolLogCount,
  assignedToolArtifactCount,
  unassignedToolArtifactCount,
}) {
  return {
    messageCount: messages.length,
    displayMessageCount: displayMessages.length,
    injectedMessageCount: messages.filter((message) => message?.injectedMessage === true).length,
    thinkingMessageCount: displayMessages.filter((message) => message?.hasThinkingDetails === true)
      .length,
    toolLogCount,
    displayToolLogCount: assignedToolArtifactCount,
    unassignedToolArtifactCount,
    hasToolDetails: toolLogCount > 0,
    attachmentCount: displayMessages.reduce(
      (count, message) => count + countMessageAttachments(message),
      0,
    ),
  };
}
