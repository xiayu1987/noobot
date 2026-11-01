/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

export function assertToolCallTiming(value) {
  if (!isPlainObject(value) || !isCanonicalText(value.toolCallId)) {
    throw new TypeError("tool_call_timing requires toolCallId");
  }
  if (Object.hasOwn(value, "durationMs")) {
    throw new TypeError("tool_call_timing must not redefine tool_call_end durationMs");
  }
  for (const field of ["executionMs", "frameworkMs"]) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new TypeError(`invalid tool timing ${field}`);
    }
  }
  return value;
}
