/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedSessionMessageRecord } from "@noobot/session-protocol";
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

function countMessageAttachments(message) {
  const sessionAttachments = dedupeSessionAttachmentRefs(message.attachments);
  const transferAttachments = collectAttachmentRefsFromTransferEnvelopes(message.transferEnvelopes);
  return sessionAttachments.length + transferAttachments.length;
}

export function buildSessionDisplayStats({
  messages,
  displayMessages,
  toolLogCount,
  assignedToolArtifactCount,
  unassignedToolArtifactCount,
  conflictedToolArtifactCount,
}) {
  return {
    messageCount: messages.length,
    displayMessageCount: displayMessages.length,
    injectedMessageCount: messages.filter((message) => isInjectedSessionMessageRecord(message))
      .length,
    thinkingMessageCount: displayMessages.filter((message) => message?.hasThinkingDetails === true)
      .length,
    toolLogCount,
    displayToolLogCount: assignedToolArtifactCount,
    unassignedToolArtifactCount,
    conflictedToolArtifactCount,
    hasToolDetails: toolLogCount > 0,
    attachmentCount: displayMessages.reduce(
      (count, message) => count + countMessageAttachments(message),
      0,
    ),
  };
}
