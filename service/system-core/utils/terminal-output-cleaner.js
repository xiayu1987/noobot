/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function normalizeTerminalText(input = "") {
  return String(input || "")
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function tailClip(input = "", maxChars = 8000) {
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

export function cleanTerminalOutputForLLM(output = {}, { maxChars = 8000 } = {}) {
  const source =
    output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stdout = tailClip(normalizeTerminalText(source?.stdout || ""), maxChars);
  const stderr = tailClip(normalizeTerminalText(source?.stderr || ""), maxChars);
  return {
    code: Number(source?.code || 0),
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    stdout_original_length: stdout.originalLength,
    stderr_original_length: stderr.originalLength,
  };
}

