/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function isAbortSignalLike(value) {
  return Boolean(value) && typeof value.addEventListener === "function";
}

function normalizeDisposer(disposer) {
  return typeof disposer === "function" ? disposer : null;
}

export function createExecutionCancellationScope({ abortSignal = null, onDisposeError } = {}) {
  const disposers = new Set();
  const reportDisposeError = typeof onDisposeError === "function" ? onDisposeError : () => {};
  const scope = {
    get abortSignal() {
      return abortSignal || null;
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
    const normalized = normalizeDisposer(disposer);
    if (!normalized) return () => {};
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

  if (isAbortSignalLike(abortSignal)) {
    if (abortSignal.aborted) disposed = true;
    else abortSignal.addEventListener("abort", dispose, { once: true });
  }

  return scope;
}

export function resolveExecutionCancellationScope(scope = null) {
  if (scope && typeof scope.register === "function") return scope;
  return createExecutionCancellationScope();
}

export async function withExecutionCancellationScope(scope, disposer, run) {
  const resolved = resolveExecutionCancellationScope(scope);
  const unregister = resolved.register(disposer);
  try {
    return await run();
  } finally {
    unregister();
  }
}
