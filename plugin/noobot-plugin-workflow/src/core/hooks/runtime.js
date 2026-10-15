/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { isExecutionAbortError, resolveExecutionAbortMessage } from "@noobot/session-protocol";

export function resolveWorkflowAgentContext(ctx = {}) {
  return ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
}

export function resolveWorkflowRuntimeFromContext(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = agentContext?.bindings?.runtime;
  return runtime && typeof runtime === "object" ? runtime : null;
}

export function resolveWorkflowAbortSignal(ctx = {}) {
  return ctx?.abortSignal || null;
}

function createWorkflowAbortError(ctx = {}) {
  const error = new Error(
    resolveExecutionAbortMessage({
      abortSignal: resolveWorkflowAbortSignal(ctx),
      fallback: "workflow aborted",
    }),
  );
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

export function isWorkflowAbortError(error = null, ctx = {}) {
  return isExecutionAbortError({ error, abortSignal: resolveWorkflowAbortSignal(ctx) });
}

export function throwIfWorkflowAborted(ctx = {}) {
  if (!resolveWorkflowAbortSignal(ctx)?.aborted) return;
  throw createWorkflowAbortError(ctx);
}

export function hasOwnObjectKey(source = {}, key = "") {
  return Boolean(
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    Object.prototype.hasOwnProperty.call(source, text(key)),
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
