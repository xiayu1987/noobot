/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

export function canonicalizeCommandRequest(value = {}) {
  return JSON.stringify(stable(value));
}

export function createCommandRequestHash(value = {}) {
  return bytesToHex(sha256(utf8ToBytes(canonicalizeCommandRequest(value))));
}

export function canonicalAttachmentIdentities(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((item = {}) => ({
      attachmentId: String(item.attachmentId || "").trim(),
      sessionId: String(item.sessionId || "").trim(),
      attachmentSource: String(item.attachmentSource || "").trim(),
    }))
    .sort((a, b) => canonicalizeCommandRequest(a).localeCompare(canonicalizeCommandRequest(b)));
}
