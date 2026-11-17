/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function requireInterval(interval, scope) {
  if (
    typeof scope.clockId !== "string" ||
    !scope.clockId ||
    interval?.clockId !== scope.clockId ||
    !Number.isFinite(interval.startMs) ||
    interval.startMs < scope.startMs ||
    !Number.isFinite(interval.endMs) ||
    interval.endMs < interval.startMs ||
    interval.endMs > scope.endMs
  )
    throw new TypeError("processing timing requires complete intervals in one clock domain");
}

function unionDuration(intervals) {
  let duration = 0;
  let end = -Infinity;
  for (const interval of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    duration += Math.max(0, interval.endMs - Math.max(end, interval.startMs));
    end = Math.max(end, interval.endMs);
  }
  return duration;
}

export function summarizeProcessingTiming({ scope, modelIntervals, toolIntervals }) {
  if (
    !Number.isFinite(scope?.startMs) ||
    scope.startMs < 0 ||
    !Number.isFinite(scope.endMs) ||
    scope.endMs < scope.startMs ||
    !Array.isArray(modelIntervals) ||
    !Array.isArray(toolIntervals)
  )
    throw new TypeError("processing timing requires a bounded scope and interval lists");
  requireInterval(scope, scope);
  for (const interval of [...modelIntervals, ...toolIntervals]) requireInterval(interval, scope);
  const modelTransportMs = unionDuration(modelIntervals);
  const toolExecutionUnionMs = unionDuration(toolIntervals);
  const excludedMs = unionDuration([...modelIntervals, ...toolIntervals]);
  const elapsedMs = scope.endMs - scope.startMs;
  return {
    ...scope,
    elapsedMs,
    modelTransportMs,
    toolExecutionOutsideModelMs: excludedMs - modelTransportMs,
    modelToolOverlapMs: modelTransportMs + toolExecutionUnionMs - excludedMs,
    systemMs: elapsedMs - excludedMs,
  };
}
