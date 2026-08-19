/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebugSafely } from "./lazyDebugSink.js";

let sessionLogSink = null;

export function setReconnectTimingDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function logReconnectTimingDebug(event, payload = {}) {
  return emitLazyDebugSafely(sessionLogSink, "reconnect-timing", event, payload);
}
