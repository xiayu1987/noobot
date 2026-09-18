/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectExecutionTransportPayload } from "../../events/transport-payload.js";
import { TURN_STATE, TURN_TERMINAL_STATUS } from "@noobot/session-protocol";

export function createDetachedTerminalReceipt({
  lifecycle = null,
  executionId = "",
  failed = false,
} = {}) {
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return null;
  const sourceState = String(lifecycle?.state || lifecycle?.branchState || "")
    .trim()
    .toLowerCase();
  const state = resolveDetachedReceiptState(sourceState, failed);
  return {
    ...lifecycle,
    executionId: String(lifecycle?.executionId || executionId || "").trim(),
    executionKind: "agent",
    state,
    revision: Number(lifecycle?.revision || 0),
    sequence: Number(lifecycle?.sequence || 0),
    failure: resolveDetachedReceiptFailure(lifecycle, failed),
  };
}

function resolveDetachedReceiptState(sourceState, failed) {
  if (sourceState === TURN_TERMINAL_STATUS.COMPLETED) return TURN_STATE.COMPLETED;
  if (sourceState === TURN_TERMINAL_STATUS.USER_STOPPED) return TURN_STATE.STOP_COMPLETED;
  if (failed || ["failed", "interrupted"].includes(sourceState)) {
    return TURN_STATE.PROCESSING_FAILED;
  }
  return sourceState;
}

function resolveDetachedReceiptFailure(lifecycle, failed) {
  if (!failed) return lifecycle?.failure || null;
  return {
    code: String(lifecycle?.code || lifecycle?.failure?.code || "CHILD_EXECUTION_FAILED").trim(),
    message: String(
      lifecycle?.error || lifecycle?.failure?.message || "child execution failed",
    ).trim(),
  };
}

export function createScopedSubSessionEventListener(eventListener = null, identity = {}) {
  const target = resolveObjectEventListener(eventListener);
  if (!target) return null;
  if (typeof target.forwardEvent !== "function") {
    throw new TypeError(
      "detached sub-session requires an execution event listener forwardEvent port",
    );
  }
  return {
    onEvent(event = {}) {
      const source = event && typeof event === "object" ? event : {};
      const data = source.data && typeof source.data === "object" ? source.data : {};
      return target.forwardEvent({
        ...source,
        data: projectExecutionTransportPayload({
          event: source.event,
          data,
          route: identity,
        }),
      });
    },
  };
}

function resolveObjectEventListener(eventListener = null) {
  return eventListener &&
    typeof eventListener === "object" &&
    typeof eventListener.onEvent === "function"
    ? eventListener
    : null;
}
