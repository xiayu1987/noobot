/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
  MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
} from "../constants.js";

function resolveSerializedLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value || "").length;
  }
}

export function trimPromptPayloadByCharLimit(
  payload = [],
  {
    maxChars = MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
    shrinkRatio = MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
  } = {},
) {
  const source = Array.isArray(payload) ? payload : [];
  const safeMaxChars = Number(maxChars);
  if (!Number.isFinite(safeMaxChars) || safeMaxChars <= 0) return [...source];

  let next = [...source];
  while (next.length > 0 && resolveSerializedLength(next) > safeMaxChars) {
    const removeCount = Math.max(
      1,
      Math.ceil(next.length * (Number(shrinkRatio) || 1 / 3)),
    );
    next = next.slice(removeCount);
  }
  return next;
}
