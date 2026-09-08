/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createCapabilityModelTimeoutError(timeoutMs = 0) {
  const error = new Error(`capability model timeout (${timeoutMs}ms)`);
  error.name = "AbortError";
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
  if (typeof invoker !== "function") return null;
  const controller = new AbortController();
  const normalizedTimeoutMs = Number(timeoutMs);
  let timer = null;
  let removeParentListener = () => {};
  let removeInvocationListener = () => {};

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (typeof parentSignal?.addEventListener === "function") {
    const abortFromParent = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
    removeParentListener = () => parentSignal.removeEventListener("abort", abortFromParent);
  }

  const abortPromise = new Promise((_, reject) => {
    if (controller.signal.aborted) {
      reject(controller.signal.reason || new Error("capability model invocation aborted"));
      return;
    }
    const rejectOnAbort = () => {
      reject(controller.signal.reason || new Error("capability model invocation aborted"));
    };
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    removeInvocationListener = () =>
      controller.signal.removeEventListener("abort", rejectOnAbort);
  });

  if (Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(createCapabilityModelTimeoutError(normalizedTimeoutMs));
    }, normalizedTimeoutMs);
  }

  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        invoker({
          ...(payload && typeof payload === "object" ? payload : {}),
          signal: controller.signal,
        }),
      ),
      abortPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    removeInvocationListener();
    removeParentListener();
  }
}
