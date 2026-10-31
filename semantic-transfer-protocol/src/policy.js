/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isPlainObject } from "@noobot/shared/value";

const TRANSFER_PREFERENCE = Object.freeze({
  AUTO: "auto",
  DIRECT: "direct",
  ATTACHMENT: "attachment",
});
const TRANSFER_DECISION_REASON = Object.freeze({
  FORCED: "forced_attachment",
  REQUESTED: "requested_attachment",
  THRESHOLD: "threshold_exceeded",
  DIRECT: "within_direct_limit",
});

export function requireTransferCharLimit(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("invalid_transfer_char_limit");
  return value;
}

export function previewTransferText(content, maxChars) {
  requireTransferCharLimit(maxChars);
  if (typeof content !== "string") throw new TypeError("invalid_transfer_text");
  let end = Math.min(content.length, maxChars);
  if (end < content.length && end > 0) {
    const last = content.charCodeAt(end - 1);
    const next = content.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  }
  return content.slice(0, end);
}
function normalizeTransferPolicy({
  policy = {},
  maxDirectChars = LENGTH_THRESHOLDS.semanticTransfer.directChars,
  previewChars = LENGTH_THRESHOLDS.semanticTransfer.previewChars,
} = {}) {
  if (!isPlainObject(policy)) throw new Error("invalid_transfer_policy");
  const preference = policy.preference ?? TRANSFER_PREFERENCE.AUTO;
  if (!Object.values(TRANSFER_PREFERENCE).includes(preference))
    throw new Error("invalid_transfer_preference");
  return Object.freeze({
    preference,
    maxDirectChars: requireTransferCharLimit(
      policy.maxDirectChars === undefined ? maxDirectChars : policy.maxDirectChars,
    ),
    previewChars: requireTransferCharLimit(
      policy.previewChars === undefined ? previewChars : policy.previewChars,
    ),
    allowAttachment: policy.allowAttachment !== false,
  });
}
function assertAttachmentPersistence(policy, capabilities) {
  if (!policy.allowAttachment || capabilities.attachmentPersistence === false)
    throw new Error("attachment_persistence_required");
}
export function decideTransfer({
  content = "",
  forceAttachment = false,
  policy: inputPolicy = {},
  capabilities = {},
  maxDirectChars = LENGTH_THRESHOLDS.semanticTransfer.directChars,
  previewChars = LENGTH_THRESHOLDS.semanticTransfer.previewChars,
} = {}) {
  const policy = normalizeTransferPolicy({
    policy: inputPolicy,
    maxDirectChars,
    previewChars,
  });
  const length = typeof content === "string" ? content.length : Number(content?.length || 0);
  if (forceAttachment || policy.preference === TRANSFER_PREFERENCE.ATTACHMENT) {
    assertAttachmentPersistence(policy, capabilities);
    return {
      mode: "attachment",
      reason: forceAttachment
        ? TRANSFER_DECISION_REASON.FORCED
        : TRANSFER_DECISION_REASON.REQUESTED,
      length,
      ...policy,
    };
  }
  if (length > policy.maxDirectChars) {
    assertAttachmentPersistence(policy, capabilities);
    return {
      mode: "attachment",
      reason: TRANSFER_DECISION_REASON.THRESHOLD,
      length,
      ...policy,
    };
  }
  if (
    policy.preference === TRANSFER_PREFERENCE.DIRECT ||
    policy.preference === TRANSFER_PREFERENCE.AUTO
  )
    return {
      mode: "direct",
      reason: TRANSFER_DECISION_REASON.DIRECT,
      length,
      ...policy,
    };
  throw new Error("transfer_decision_unreachable");
}
