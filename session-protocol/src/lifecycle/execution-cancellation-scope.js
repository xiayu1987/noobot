/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * 执行取消作用域：中止信号的资源回收侧协议。
 *
 * 职责边界：
 * - execution-abort.js 负责中止事实（reason/error/断言/竞态响应性）；
 * - 本模块只负责"中止发生时把已登记的资源收尾函数跑一遍"，不判定中止事实、
 *   不构造中止错误、不决定谁该被中止。
 *
 * 唯一性约束：作用域与中止信号一一绑定，signal 只从作用域读取，
 * 不接受调用方另传第二个 signal；作用域自身监听 abort 触发回收，
 * 不依赖任何调用方记得在 catch 里手动调用。
 */

function isAbortSignalLike(value) {
  return Boolean(value) && typeof value.addEventListener === "function";
}

function normalizeDisposer(disposer) {
  return typeof disposer === "function" ? disposer : null;
}

/**
 * 创建与中止信号绑定的取消作用域。
 *
 * @param {object} params
 * @param {AbortSignal|null} params.abortSignal 作用域绑定的中止信号，缺省时作用域为惰性空实现。
 * @param {(error: unknown) => void} [params.onDisposeError] 回收函数抛错的观测出口；
 *   协议不做日志，也不把回收异常升级为中止失败。
 */
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

  /**
   * 登记资源收尾函数，返回注销句柄。
   * 作用域已回收时立即执行一次，避免中止后登记的资源永不释放。
   */
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

  /** 幂等回收：每个已登记函数最多执行一次，异常只上报不中断其余回收。 */
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

/** 作用域可选：缺省时返回不做任何登记的空实现，调用方无需分支判断。 */
export function resolveExecutionCancellationScope(scope = null) {
  if (scope && typeof scope.register === "function") return scope;
  return createExecutionCancellationScope();
}

/**
 * 在作用域内登记资源并保证正常路径也会注销，避免登记表随调用次数累积。
 * 中止时由作用域统一回收，不依赖此处的 finally。
 */
export async function withExecutionCancellationScope(scope, disposer, run) {
  const resolved = resolveExecutionCancellationScope(scope);
  const unregister = resolved.register(disposer);
  try {
    return await run();
  } finally {
    unregister();
  }
}
