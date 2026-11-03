/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const OLDEST_PAYLOAD_SHRINK_RATIO = 1 / 3;

function resolveSerializedLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value || "").length;
  }
}

export function trimPromptPayloadByCharLimit(payload = [], { maxChars }) {
  const source = Array.isArray(payload) ? payload : [];
  const safeMaxChars = Number(maxChars);
  if (!Number.isFinite(safeMaxChars) || safeMaxChars <= 0) return [...source];

  let next = [...source];
  while (next.length > 0 && resolveSerializedLength(next) > safeMaxChars) {
    const removeCount = Math.max(1, Math.ceil(next.length * OLDEST_PAYLOAD_SHRINK_RATIO));
    next = next.slice(removeCount);
  }
  return next;
}
