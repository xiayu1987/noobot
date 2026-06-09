/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveWorkflowAgentContext(ctx = {}) {
  const candidates = [
    ctx?.agentContext,
    ctx?.runtimeAgentContext,
  ];
  return candidates.find((item) => item && typeof item === "object") || null;
}

export function resolveWorkflowRuntimeFromContext(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const candidates = [
    agentContext?.execution?.controllers?.runtime,
    agentContext?.runtime,
    ctx?.execution?.controllers?.runtime,
    ctx?.runtime,
  ];
  return candidates.find((item) => item && typeof item === "object") || null;
}

export function resolveWorkflowAbortSignal(ctx = {}) {
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  return ctx?.abortSignal || runtime?.abortSignal || null;
}

export function createWorkflowAbortError(ctx = {}) {
  const signal = resolveWorkflowAbortSignal(ctx);
  const reason = signal?.reason;
  const reasonText =
    typeof reason === "string"
      ? reason
      : reason && typeof reason === "object"
        ? String(reason?.message || reason?.reason || reason?.type || "").trim()
        : "";
  const error = new Error(reasonText || "workflow aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

export function isWorkflowAbortError(error = null, ctx = {}) {
  const name = String(error?.name || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || error || "").trim().toLowerCase();
  return (
    resolveWorkflowAbortSignal(ctx)?.aborted === true ||
    name === "aborterror" ||
    code === "ABORT_ERR" ||
    message.includes("abort") ||
    message.includes("aborted") ||
    message.includes("stopped by user")
  );
}

export function throwIfWorkflowAborted(ctx = {}) {
  if (!resolveWorkflowAbortSignal(ctx)?.aborted) return;
  throw createWorkflowAbortError(ctx);
}

export function resolveWorkflowParentRunConfig(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const candidates = [
    ctx?.runConfig,
    runtime?.runConfig,
    agentContext?.runConfig,
    agentContext?.payload?.runtime?.runConfig,
    agentContext?.execution?.controllers?.runtime?.runConfig,
  ];
  return candidates.find((item) => item && typeof item === "object" && !Array.isArray(item)) || {};
}

export function hasOwnObjectKey(source = {}, key = "") {
  return Boolean(
    source &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      Object.prototype.hasOwnProperty.call(source, String(key || "").trim()),
  );
}

export function withTimeout(promise, timeoutMs, message = "", { signal = null } = {}) {
  const ms = Number(timeoutMs);
  if (signal?.aborted) {
    const err = new Error("workflow aborted");
    err.name = "AbortError";
    err.code = "ABORT_ERR";
    return Promise.reject(err);
  }
  if ((!Number.isFinite(ms) || ms <= 0) && !signal) return promise;
  let timer = null;
  let abortListener = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }),
    new Promise((_, reject) => {
      if (Number.isFinite(ms) && ms > 0) {
        timer = setTimeout(() => {
          const err = new Error(message || `workflow node timeout (${ms}ms)`);
          err.code = "WORKFLOW_NODE_TIMEOUT";
          reject(err);
        }, ms);
      }
      if (signal) {
        abortListener = () => {
          if (timer) clearTimeout(timer);
          signal.removeEventListener("abort", abortListener);
          const err = new Error("workflow aborted");
          err.name = "AbortError";
          err.code = "ABORT_ERR";
          reject(err);
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
    }),
  ]);
}
