/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createLinkedAbortScope } from "@noobot/shared/linked-abort";

function createCapabilityModelTimeoutError(timeoutMs = 0) {
  const error = new Error(`capability model timeout (${timeoutMs}ms)`);
  error.code = "CAPABILITY_MODEL_TIMEOUT";
  error.timeoutMs = timeoutMs;
  return error;
}

export async function invokeCapabilityModelWithinDeadline({
  invoker,
  payload = {},
  parentSignal = null,
  timeoutMs = 0,
} = {}) {
  if (typeof invoker !== "function") {
    throw new TypeError("capability model invocation requires an invoker function");
  }
  const normalizedTimeoutMs = Number(timeoutMs);
  const abortScope = createLinkedAbortScope({
    parentSignal,
    timeoutMs: normalizedTimeoutMs,
    createTimeoutReason: () => createCapabilityModelTimeoutError(normalizedTimeoutMs),
  });
  try {
    return await abortScope.race(
      Promise.resolve().then(() =>
        invoker({
          ...(payload && typeof payload === "object" ? payload : {}),
          signal: abortScope.signal,
        }),
      ),
    );
  } finally {
    abortScope.dispose();
  }
}
