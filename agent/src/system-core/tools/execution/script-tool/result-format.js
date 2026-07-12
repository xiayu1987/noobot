/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { formatLinesWithNumbers, splitLines } from "../file-utils.js";
import { EXECUTE_SCRIPT_TOOL_NAME } from "./constants.js";

export function formatCommandOutputWithLineNumbers(value = "") {
  const text = String(value || "");
  if (!text) return "";
  const lines = splitLines(text);
  if (text.endsWith("\n")) lines.pop();
  return formatLinesWithNumbers(lines, 1);
}

export function normalizeExecOutput(r = {}, { includeLineNumbers = false } = {}) {
  if (includeLineNumbers !== true) return r;
  return {
    ...r,
    stdout: formatCommandOutputWithLineNumbers(r?.stdout || ""),
    stderr: formatCommandOutputWithLineNumbers(r?.stderr || ""),
  };
}

export function toolExecResult(mode, r = {}, extra = {}, options = {}) {
  const includeLineNumbers = options?.includeLineNumbers === true;
  const normalizedResult = normalizeExecOutput(r, { includeLineNumbers });
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...extra,
    ...normalizedResult,
    includeLineNumbers,
  });
}
