/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../shared-utils.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function normalizeText(input = "") {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

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

export function compactStdout(input = "") {
  const text = String(input || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
      return JSON.stringify(parsed);
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return normalizeText(text);
}

export function tailClip(input = "", maxChars = LENGTH_THRESHOLDS.toolIO.connectorOutputChars) {
  const text = String(input || "");
  const limit = Math.max(256, Number(maxChars || LENGTH_THRESHOLDS.toolIO.connectorOutputChars));
  if (text.length <= limit) {
    return {
      text,
      truncated: false,
      originalLength: text.length,
      truncatedChars: 0,
      truncateLimitChars: limit,
    };
  }
  const truncatedChars = text.length - limit;
  return {
    text: `...[truncated head ${truncatedChars} chars]\n${text.slice(-limit)}`,
    truncated: true,
    originalLength: text.length,
    truncatedChars,
    truncateLimitChars: limit,
  };
}

export function cleanTerminalOutputForLLM(
  output = {},
  { maxChars = LENGTH_THRESHOLDS.toolIO.connectorOutputChars } = {},
) {
  const source = output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stdout = tailClip(normalizeTerminalText(source?.stdout || ""), maxChars);
  const stderr = tailClip(normalizeTerminalText(source?.stderr || ""), maxChars);
  return {
    code: safeNum(source?.code),
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    truncate_limit_chars: Math.max(
      Number(stdout.truncateLimitChars || 0),
      Number(stderr.truncateLimitChars || 0),
    ),
    stdout_truncated_chars: Number(stdout.truncatedChars || 0),
    stderr_truncated_chars: Number(stderr.truncatedChars || 0),
    truncated_chars_total: Number(stdout.truncatedChars || 0) + Number(stderr.truncatedChars || 0),
    stdout_original_length: stdout.originalLength,
    stderr_original_length: stderr.originalLength,
  };
}

export function cleanDatabaseOutputForLLM(
  output = {},
  { maxChars = LENGTH_THRESHOLDS.toolIO.connectorOutputChars } = {},
) {
  const source = output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stdout = tailClip(compactStdout(source?.stdout || ""), maxChars);
  const stderr = tailClip(normalizeText(source?.stderr || ""), maxChars);
  return {
    code: safeNum(source?.code),
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    truncate_limit_chars: Math.max(
      Number(stdout.truncateLimitChars || 0),
      Number(stderr.truncateLimitChars || 0),
    ),
    stdout_truncated_chars: Number(stdout.truncatedChars || 0),
    stderr_truncated_chars: Number(stderr.truncatedChars || 0),
    truncated_chars_total: Number(stdout.truncatedChars || 0) + Number(stderr.truncatedChars || 0),
    stdout_original_length: stdout.originalLength,
    stderr_original_length: stderr.originalLength,
  };
}
