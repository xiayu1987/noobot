/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cleanTerminalOutputForLLM } from "../../utils/cleaners/output-cleaner.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

/**
 * Unified truncation entry for tool payload stdout/stderr.
 * Mutates payload in-place and returns the same object.
 */
export function sanitizeToolPayloadOutput(
  payload = {},
  { defaultMaxOutputChars = 20000, minMaxOutputChars = 256 } = {},
) {
  if (!isPlainObject(payload)) return payload;
  if (payload.output_cleaned === true) return payload;
  if (!("stdout" in payload) && !("stderr" in payload)) return payload;

  const maxOutputChars = normalizePositiveInt(
    payload.__max_output_chars,
    defaultMaxOutputChars,
    minMaxOutputChars,
  );
  delete payload.__max_output_chars;

  const stdoutLength = getOutputLength(payload.stdout);
  const stderrLength = getOutputLength(payload.stderr);
  if (stdoutLength <= maxOutputChars && stderrLength <= maxOutputChars) {
    return payload;
  }

  const cleaned = cleanTerminalOutputForLLM(payload, { maxChars: maxOutputChars });
  payload.stdout = cleaned.stdout;
  payload.stderr = cleaned.stderr;
  payload.code = cleaned.code;
  payload.truncated = cleaned.truncated;
  payload.truncate_limit_chars = cleaned.truncate_limit_chars;
  payload.stdout_truncated_chars = cleaned.stdout_truncated_chars;
  payload.stderr_truncated_chars = cleaned.stderr_truncated_chars;
  payload.truncated_chars_total = cleaned.truncated_chars_total;
  payload.stdout_original_length = cleaned.stdout_original_length;
  payload.stderr_original_length = cleaned.stderr_original_length;
  payload.output_cleaned = true;
  return payload;
}
