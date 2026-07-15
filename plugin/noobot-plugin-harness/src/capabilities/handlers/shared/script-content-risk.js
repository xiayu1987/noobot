/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeString(value = "") {
  return String(value || "").trim();
}

// Only flag strong executable-script signals; ordinary code snippets and prose
// must not produce a risk notice.
export function containsExecutableScriptText(value = "") {
  const text = normalizeString(value);
  if (!text) return false;
  return [
    /```(?:bash|sh|shell|zsh|cmd|powershell)\b[\s\S]*?```/i,
    /\bexecute_script\b[\s\S]*(?:command|riskLevel|executionMode)/i,
    /(^|\n)\s*(?:sudo\s+)?(?:rm\s+-rf|chmod\s+\+x|curl\s+[^\n|]+\s*\|\s*(?:sh|bash)|npm\s+(?:run|install)|git\s+(?:reset|clean)|docker\s+(?:rm|stop|exec))\b/im,
  ].some((pattern) => pattern.test(text));
}
