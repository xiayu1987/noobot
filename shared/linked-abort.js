/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "./value.js";

export function createLinkedAbortScope({
  parentSignal = null,
  timeoutMs = 0,
  createTimeoutReason,
} = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const cleanups = [];

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (isFunction(parentSignal?.addEventListener)) {
    const abortFromParent = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
    cleanups.push(() => parentSignal.removeEventListener("abort", abortFromParent));
  }

  const { promise: aborted, reject } = Promise.withResolvers();
  const rejectOnAbort = () => reject(signal.reason);
  if (signal.aborted) rejectOnAbort();
  else signal.addEventListener("abort", rejectOnAbort, { once: true });
  cleanups.push(() => signal.removeEventListener("abort", rejectOnAbort));

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    if (!isFunction(createTimeoutReason)) {
      throw new TypeError("createLinkedAbortScope timeout requires createTimeoutReason");
    }
    const timer = setTimeout(() => controller.abort(createTimeoutReason()), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }

  return Object.freeze({
    signal,
    race: (promise) => Promise.race([promise, aborted]),
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  });
}
