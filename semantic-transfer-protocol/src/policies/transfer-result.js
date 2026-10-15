/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

export const TRANSFER_RESULT_STATUS = Object.freeze({
  DIRECT: "direct",
  FILE: "file",
  FALLBACK_DIRECT: "fallback_direct",
  SKIPPED: "skipped",
  FAILED: "failed",
});

function cleanObject(value = {}) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null) continue;
    if (typeof child === "string" && !child.trim()) continue;
    out[key] = child;
  }
  return out;
}

export function createTransferResult({
  ok = true,
  status = TRANSFER_RESULT_STATUS.DIRECT,
  envelope = null,
  error = null,
  meta = {},
} = {}) {
  const normalizedStatus = text(status) || TRANSFER_RESULT_STATUS.DIRECT;
  const result = {
    ok: ok === true,
    status: normalizedStatus,
  };
  if (envelope && typeof envelope === "object") result.envelope = envelope;
  if (error) {
    result.error = isPlainObject(error)
      ? cleanObject({
          code: text(error.code) || "TRANSFER_ERROR",
          message: text(error.message || error.error) || "transfer error",
          details: error.details,
        })
      : { code: "TRANSFER_ERROR", message: text(error) || "transfer error" };
  }
  const normalizedMeta = cleanObject(meta);
  if (Object.keys(normalizedMeta).length) result.meta = normalizedMeta;
  return result;
}
