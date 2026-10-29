/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { text, stableValue } from "@noobot/shared/value";

function canonicalizeCommandRequest(value = {}) {
  return JSON.stringify(stableValue(value));
}

export function createCommandRequestHash(value = {}) {
  return bytesToHex(sha256(utf8ToBytes(canonicalizeCommandRequest(value))));
}

export function canonicalAttachmentIdentities(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((item = {}) => ({
      attachmentId: text(item.attachmentId),
      sessionId: text(item.sessionId),
      attachmentSource: text(item.attachmentSource),
    }))
    .sort((a, b) => canonicalizeCommandRequest(a).localeCompare(canonicalizeCommandRequest(b)));
}
