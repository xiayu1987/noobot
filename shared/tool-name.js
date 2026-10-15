/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "./value.js";
export function resolveToolCallName(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return text(toolCall.name);
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return text(fn.name);
}
