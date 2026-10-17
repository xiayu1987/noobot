/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXECUTION_KIND } from "@noobot/session-protocol";
import { isFunction, isPlainObject } from "@noobot/shared/value";

export function createDetachedTerminalReceipt(turn) {
  if (!isPlainObject(turn)) {
    throw new TypeError("detached terminal receipt requires the committed turn");
  }
  return { ...turn, executionKind: EXECUTION_KIND.AGENT };
}

export function createScopedSubSessionEventListener(eventListener, identity) {
  if (eventListener === null || eventListener === undefined) return null;
  if (!isFunction(eventListener.forwardEvent)) {
    throw new TypeError(
      "detached sub-session requires an execution event listener forwardEvent port",
    );
  }
  return {
    onEvent(event) {
      if (!isPlainObject(event)) {
        throw new TypeError("detached sub-session event must be an object");
      }
      return eventListener.forwardEvent({ ...event, route: identity });
    },
  };
}
