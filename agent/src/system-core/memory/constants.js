/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolvePositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS = resolvePositiveNumber(
  process.env.NOOBOT_MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
  150000,
);

export const MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO = resolvePositiveNumber(
  process.env.NOOBOT_MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
  1 / 3,
);

export function getMemoryFileSplitMaxChars() {
  return resolvePositiveNumber(process.env.NOOBOT_MEMORY_FILE_SPLIT_MAX_CHARS, 20000);
}

export const MEMORY_FILE_SPLIT_MAX_CHARS = getMemoryFileSplitMaxChars();
