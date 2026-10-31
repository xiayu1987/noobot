/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachments } from "./dialogProcessChain.js";
import { getMessageTransferAttachments } from "./transferEnvelopes.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getMessageAttachments(messageItem = {}) {
  const sourceAttachments = Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
  const transferAttachments = getMessageTransferAttachments(messageItem);
  return transferAttachments.length
    ? mergeAttachments(transferAttachments, sourceAttachments)
    : sourceAttachments;
}

export { getMessageAttachments, normalizeArray };
