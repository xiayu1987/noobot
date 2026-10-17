/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";

export function hasEventListener(eventListener) {
  if (eventListener === null || eventListener === undefined) return false;
  if (!isFunction(eventListener.onEvent)) {
    throw new TypeError("event listener requires an onEvent port");
  }
  return true;
}

export function emitEvent(eventListener, event, data = {}) {
  if (!hasEventListener(eventListener)) return undefined;
  return eventListener.onEvent({
    event,
    data,
    ts: new Date().toISOString(),
  });
}
