/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function emitEvent(eventListener, event, data = {}) {
  return eventListener?.onEvent?.({
    event,
    data,
    ts: new Date().toISOString(),
  });
}
