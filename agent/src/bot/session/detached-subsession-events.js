/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXECUTION_KIND } from "@noobot/session-protocol";

export function createDetachedTerminalReceipt(turn) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    throw new TypeError("detached terminal receipt requires the committed turn");
  }
  return { ...turn, executionKind: EXECUTION_KIND.AGENT };
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
      return target.forwardEvent({ ...source, route: identity });
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
