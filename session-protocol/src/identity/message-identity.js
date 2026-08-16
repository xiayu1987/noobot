/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();
export function normalizeMessageIdentity(value = {}) {
  return Object.freeze({
    messageUid: clean(value.messageUid),
    messageId: clean(value.messageId || value.id),
    presentationMessageId: clean(value.presentationMessageId),
  });
}
export function validateMessageIdentity(value = {}) {
  const identity = normalizeMessageIdentity(value);
  const errors = [];
  if (!identity.messageUid) errors.push("missing_message_uid");
  if (!identity.messageId) errors.push("missing_message_id");
  return { valid: errors.length === 0, errors, identity };
}
