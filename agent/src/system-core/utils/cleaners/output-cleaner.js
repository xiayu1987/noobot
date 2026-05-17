/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../shared-utils.js";

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Normalize text: CRLF→LF, strip NUL, trim trailing whitespace on lines,
 * collapse 4+ blank lines to 3, and trim.
 */
export function normalizeText(input = "") {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Normalize terminal text: strip ANSI escape codes, then apply base normalization.
 */
export function normalizeTerminalText(input = "") {
  return String(input || "")
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Compact stdout: try JSON parse first (for DB results), fall back to normalizeText.
 */
export function compactStdout(input = "") {
  const text = String(input || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
      return JSON.stringify(parsed);
    }
  } catch {
    // keep raw text
  }
  return normalizeText(text);
}

/**
 * Tail-clip text to maxChars, keeping the end portion.
 * Returns { text, truncated, originalLength }.
 */
export function tailClip(input = "", maxChars = 8000) {
  const text = String(input || "");
  const limit = Math.max(256, Number(maxChars || 8000));
  if (text.length <= limit) {
    return { text, truncated: false, originalLength: text.length };
  }
  return {
    text: `...[truncated head ${text.length - limit} chars]\n${text.slice(-limit)}`,
    truncated: true,
    originalLength: text.length,
  };
}

/**
 * Clean terminal output for LLM consumption.
 */
export function cleanTerminalOutputForLLM(output = {}, { maxChars = 8000 } = {}) {
  const source =
    output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stdout = tailClip(normalizeTerminalText(source?.stdout || ""), maxChars);
  const stderr = tailClip(normalizeTerminalText(source?.stderr || ""), maxChars);
  return {
    code: safeNum(source?.code),
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    stdout_original_length: stdout.originalLength,
    stderr_original_length: stderr.originalLength,
  };
}

/**
 * Clean database output for LLM consumption.
 */
export function cleanDatabaseOutputForLLM(output = {}, { maxChars = 8000 } = {}) {
  const source =
    output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stdout = tailClip(compactStdout(source?.stdout || ""), maxChars);
  const stderr = tailClip(normalizeText(source?.stderr || ""), maxChars);
  return {
    code: safeNum(source?.code),
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    stdout_original_length: stdout.originalLength,
    stderr_original_length: stderr.originalLength,
  };
}
