/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeModelCapabilities(input = {}) {
  return Object.freeze({
    streaming: input.streaming !== false,
    tools: input.tools !== false,
    vision: input.vision === true,
    reasoning: input.reasoning === true,
  });
}
