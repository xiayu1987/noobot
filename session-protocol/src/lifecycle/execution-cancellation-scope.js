/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { requireAbortSignal } from "./execution-abort.js";

export function createExecutionCancellationScope({ abortSignal, onDisposeError }) {
  requireAbortSignal(abortSignal, "createExecutionCancellationScope");
  const disposers = new Set();
  const reportDisposeError = typeof onDisposeError === "function" ? onDisposeError : () => {};
  const scope = {
    get abortSignal() {
      return abortSignal;
    },
    get disposed() {
      return disposed;
    },
    get size() {
      return disposers.size;
    },
    register,
    dispose,
  };
  let disposed = false;

  function runDisposer(disposer) {
    try {
      const result = disposer();
      if (result && typeof result.then === "function") {
        result.then(null, reportDisposeError);
      }
    } catch (error) {
      reportDisposeError(error);
    }
  }

  function register(disposer) {
    if (typeof disposer !== "function") {
      throw new TypeError("cancellation scope disposer must be a function");
    }
    const normalized = disposer;
    if (disposed) {
      runDisposer(normalized);
      return () => {};
    }
    disposers.add(normalized);
    return () => {
      disposers.delete(normalized);
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const pending = Array.from(disposers);
    disposers.clear();
    for (const disposer of pending) runDisposer(disposer);
  }

  if (abortSignal.aborted) disposed = true;
  else abortSignal.addEventListener("abort", dispose, { once: true });

  return scope;
}
