/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.directChars;

export const TRANSFER_PREFER = Object.freeze({
  AUTO: "auto",
  DIRECT: "direct",
  FILE: "file",
});

function normalizePositiveInt(value, fallback = SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS, min = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(num));
}

function normalizePrefer(value = TRANSFER_PREFER.AUTO) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(TRANSFER_PREFER).includes(normalized)
    ? normalized
    : TRANSFER_PREFER.AUTO;
}

export function normalizeTransferPolicy({
  policy = null,
  prefer = TRANSFER_PREFER.AUTO,
  maxDirectChars = SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS,
  allowFallbackDirect = true,
  allowAttachmentPersist = true,
} = {}) {
  const src = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  return {
    prefer: normalizePrefer(src.prefer ?? prefer),
    maxDirectChars: normalizePositiveInt(
      src.maxDirectChars ?? maxDirectChars,
      SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS,
      1,
    ),
    allowFallbackDirect: src.allowFallbackDirect !== undefined
      ? src.allowFallbackDirect !== false
      : allowFallbackDirect !== false,
    allowAttachmentPersist: src.allowAttachmentPersist !== undefined
      ? src.allowAttachmentPersist !== false
      : allowAttachmentPersist !== false,
  };
}
