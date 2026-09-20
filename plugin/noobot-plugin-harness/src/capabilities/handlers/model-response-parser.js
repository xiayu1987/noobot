/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./shared/constants.js";

export function isSummaryCompletionMarked(content = "", locale = LOCALE.ZH_CN) {
  const text = String(content || "").trim();
  if (!text) return false;
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const lastLine = String(lines[lines.length - 1] || "").trim().toLowerCase();
  if (!lastLine) return false;
  const zhMatched = /\u5c0f\u7ed3\u5b8c\u6210[\u3002\uff01\uff1f\u201d"]?$/.test(lastLine);
  const enMatched = /summary complete[.!?。！？”"]?$/.test(lastLine);
  if (zhMatched || enMatched) return true;
  void locale;
  return true;
}
