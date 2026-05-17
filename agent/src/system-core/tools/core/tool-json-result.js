/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../../utils/shared-utils.js";
import { cleanTerminalOutputForLLM } from "../../utils/cleaners/output-cleaner.js";

const DEFAULT_MAX_OUTPUT_CHARS = 20000;

function normalizeString(value = "") {
  return String(value || "").trim();
}

const COMMON_RESULT_FIELDS = [
  "ok",
  "status",
  "error",
  "message",
  "summary",
  "sessionId",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "tools",
];

function normalizeCommonFieldValue(key, value) {
  if (value === undefined || value === null) return undefined;
  if (key === "ok") return Boolean(value);
  if (
    key === "status" &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return value;
  }
  if (
    key === "error" ||
    key === "message" ||
    key === "sessionId" ||
    key === "parentSessionId" ||
    key === "parentDialogProcessId" ||
    key === "dialogProcessId"
  ) {
    const normalized = normalizeString(value);
    return normalized || undefined;
  }
  if (key === "tools") {
    if (!Array.isArray(value)) return undefined;
    const list = Array.from(
      new Set(value.map((item) => normalizeString(item)).filter(Boolean)),
    );
    return list.length ? list : undefined;
  }
  if (key === "summary") {
    return isPlainObject(value) ? value : undefined;
  }
  return value;
}

export function buildToolResultPayload(payload = {}) {
  const src = isPlainObject(payload) ? payload : { data: payload };
  const out = {};
  for (const field of COMMON_RESULT_FIELDS) {
    const normalized = normalizeCommonFieldValue(field, src[field]);
    if (normalized !== undefined) out[field] = normalized;
  }
  for (const [key, value] of Object.entries(src)) {
    if (COMMON_RESULT_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  sanitizeLargeTerminalLikeOutput(out);
  return out;
}

function normalizePositiveInt(value, fallback = 0, min = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(num));
}

function getOutputLength(value) {
  if (typeof value === "string") return value.length;
  if (value === undefined || value === null) return 0;
  return String(value).length;
}

function sanitizeLargeTerminalLikeOutput(payload = {}) {
  if (!isPlainObject(payload)) return;
  if (payload.output_cleaned === true) return;
  if (!("stdout" in payload) && !("stderr" in payload)) return;

  const maxOutputChars = normalizePositiveInt(
    payload.__max_output_chars,
    DEFAULT_MAX_OUTPUT_CHARS,
    256,
  );
  delete payload.__max_output_chars;

  const stdoutLength = getOutputLength(payload.stdout);
  const stderrLength = getOutputLength(payload.stderr);
  if (stdoutLength <= maxOutputChars && stderrLength <= maxOutputChars) {
    return;
  }

  const cleaned = cleanTerminalOutputForLLM(payload, { maxChars: maxOutputChars });
  payload.stdout = cleaned.stdout;
  payload.stderr = cleaned.stderr;
  payload.code = cleaned.code;
  payload.truncated = cleaned.truncated;
  payload.stdout_original_length = cleaned.stdout_original_length;
  payload.stderr_original_length = cleaned.stderr_original_length;
  payload.output_cleaned = true;
}

export function toToolJsonResult(toolName, payload = {}, pretty = false) {
  const normalizedPayload = buildToolResultPayload(payload);
  return JSON.stringify(
    {
      toolName: String(toolName || "").trim(),
      ...normalizedPayload,
    },
    null,
    pretty ? 2 : 0,
  );
}
