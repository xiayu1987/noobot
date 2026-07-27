/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitByAdapter } from "./adapter.js";

export function emitEvent(eventListener, event, data = {}) {
  emitByAdapter({
    eventListener,
    event,
    data,
    ts: new Date().toISOString(),
  });
}
