/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_RESULT_STATUS = Object.freeze({
  DIRECT: "direct",
  FILE: "file",
  FALLBACK_DIRECT: "fallback_direct",
  SKIPPED: "skipped",
  FAILED: "failed",
});

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

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
  const normalizedStatus = normalizeString(status) || TRANSFER_RESULT_STATUS.DIRECT;
  const result = {
    ok: ok === true,
    status: normalizedStatus,
  };
  if (envelope && typeof envelope === "object") result.envelope = envelope;
  if (error) {
    result.error = isPlainObject(error)
      ? cleanObject({
          code: normalizeString(error.code) || "TRANSFER_ERROR",
          message: normalizeString(error.message || error.error) || "transfer error",
          details: error.details,
        })
      : { code: "TRANSFER_ERROR", message: normalizeString(error) || "transfer error" };
  }
  const normalizedMeta = cleanObject(meta);
  if (Object.keys(normalizedMeta).length) result.meta = normalizedMeta;
  return result;
}

export function transferOk(envelope = null, status = TRANSFER_RESULT_STATUS.DIRECT, meta = {}) {
  return createTransferResult({ ok: true, status, envelope, meta });
}

export function transferFailed(error = null, meta = {}) {
  return createTransferResult({
    ok: false,
    status: TRANSFER_RESULT_STATUS.FAILED,
    error,
    meta,
  });
}
