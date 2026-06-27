/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

function resolvePositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS =
  LENGTH_THRESHOLDS.memory.longPromptPayloadChars;

export const MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO = resolvePositiveNumber(
  process.env.NOOBOT_MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
  1 / 3,
);

export function getMemoryFileSplitMaxChars() {
  return LENGTH_THRESHOLDS.memory.fileSplitChars;
}

export const MEMORY_FILE_SPLIT_MAX_CHARS = getMemoryFileSplitMaxChars();
