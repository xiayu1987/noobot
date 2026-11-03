/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  assertExecutionNotAborted,
  isExecutionAbortError,
  raceExecutionAbort,
} from "@noobot/session-protocol";

export function resolveWorkflowAgentContext(ctx = {}) {
  return ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
}

export function resolveWorkflowRuntimeFromContext(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = agentContext?.bindings?.runtime;
  return runtime && typeof runtime === "object" ? runtime : null;
}

export function isWorkflowAbortError(error, signal) {
  return isExecutionAbortError({ error, abortSignal: signal });
}

export function throwIfWorkflowAborted(signal) {
  assertExecutionNotAborted({ abortSignal: signal });
}

export function withTimeout(promise, timeoutMs, message, { signal }) {
  const ms = Number(timeoutMs);
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new TypeError("workflow node timeout requires a positive integer");
  }
  const { promise: timeout, reject } = Promise.withResolvers();
  const timer = setTimeout(() => {
    const err = new Error(message);
    err.code = "WORKFLOW_NODE_TIMEOUT";
    reject(err);
  }, ms);
  return raceExecutionAbort(Promise.race([promise, timeout]), { abortSignal: signal }).finally(() =>
    clearTimeout(timer),
  );
}
