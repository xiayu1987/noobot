/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const TRANSFER_PREFERENCE = Object.freeze({
  AUTO: "auto",
  DIRECT: "direct",
  ATTACHMENT: "attachment",
});
export const TRANSFER_DECISION_REASON = Object.freeze({
  FORCED: "forced_attachment",
  REQUESTED: "requested_attachment",
  THRESHOLD: "threshold_exceeded",
  DIRECT: "within_direct_limit",
});

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
export function normalizeTransferPolicy({
  policy = {},
  maxDirectChars = LENGTH_THRESHOLDS.semanticTransfer.directChars,
  previewChars = LENGTH_THRESHOLDS.semanticTransfer.previewChars,
} = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy))
    throw new Error("invalid_transfer_policy");
  const preference = policy.preference ?? policy.prefer ?? TRANSFER_PREFERENCE.AUTO;
  if (!Object.values(TRANSFER_PREFERENCE).includes(preference))
    throw new Error("invalid_transfer_preference");
  return Object.freeze({
    preference,
    maxDirectChars: Math.max(1, positive(policy.maxDirectChars, maxDirectChars)),
    previewChars: Math.max(0, positive(policy.previewChars, previewChars)),
    allowAttachment: policy.allowAttachment !== false,
  });
}
export function decideTransfer({
  content = "",
  forceAttachment = false,
  policy: inputPolicy = {},
  capabilities = {},
} = {}) {
  const policy = normalizeTransferPolicy({ policy: inputPolicy });
  const length = typeof content === "string" ? content.length : Number(content?.length || 0);
  if (forceAttachment || policy.preference === TRANSFER_PREFERENCE.ATTACHMENT) {
    if (!policy.allowAttachment || capabilities.attachmentPersistence === false)
      throw new Error("attachment_persistence_required");
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
    if (!policy.allowAttachment || capabilities.attachmentPersistence === false)
      throw new Error("attachment_persistence_required");
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
