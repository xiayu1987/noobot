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

export function assertToolCallTimingInterval(value) {
  assertToolCallTiming(value);
  const interval = value.interval;
  if (
    !isCanonicalText(interval?.clockId) ||
    !Number.isFinite(interval.startMs) ||
    interval.startMs < 0 ||
    !Number.isFinite(interval.endMs) ||
    interval.endMs < interval.startMs
  )
    throw new TypeError("tool timing requires a monotonic lifecycle interval");
  const execution = interval.execution;
  if (
    execution !== null &&
    (!Number.isFinite(execution?.startMs) ||
      !Number.isFinite(execution?.endMs) ||
      execution.startMs < interval.startMs ||
      execution.endMs < execution.startMs ||
      execution.endMs > interval.endMs)
  )
    throw new TypeError("tool execution interval must be inside its lifecycle");
  const executionMs = execution === null ? 0 : execution.endMs - execution.startMs;
  if (
    value.executionMs !== executionMs ||
    Math.abs(value.frameworkMs - (interval.endMs - interval.startMs - executionMs)) > 1e-9
  )
    throw new TypeError("tool timing durations do not match their intervals");
  return value;
}
