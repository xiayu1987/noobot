/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeAttachmentsByIdentity } from "@noobot/attachment-protocol";
import { assertCanonicalAttachments } from "../../../artifacts/index.js";

export { assertCanonicalAttachments };

export function dedupeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) throw new TypeError("attachments must be an array");
  return dedupeAttachmentsByIdentity(attachments);
}

export function normalizeIncomingAttachmentsForSessionMessage(incomingAttachments = []) {
  if (!Array.isArray(incomingAttachments)) return undefined;
  if (incomingAttachments.length === 0) return [];
  return dedupeAttachmentsByIdentity(incomingAttachments);
}
