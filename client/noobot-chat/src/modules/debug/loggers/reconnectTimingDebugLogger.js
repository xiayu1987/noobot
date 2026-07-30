/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebug } from "./lazyDebugSink.js";

let sessionLogSink = null;

export function setReconnectTimingDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function logReconnectTimingDebug(event, payload = {}) {
  try {
    return emitLazyDebug(sessionLogSink, "reconnect-timing", event, payload);
  } catch {}
}
