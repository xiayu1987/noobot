/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Core event emission utility.
 */

export function emitEvent(eventListener, event, data = {}) {
  try {
    eventListener?.onEvent?.({ event, data, ts: new Date().toISOString() });
  } catch {
    // Listener errors should not interrupt the main execution flow.
  }
}
