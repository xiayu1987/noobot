/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebugSafely } from "./lazyDebugSink.js";

export function createDiagnosticsLogger(debugType) {
  let sink = null;
  return {
    setSink(next = null) {
      sink = acceptsDebugSink(next) ? next : null;
    },
    log(event, payload = {}) {
      return emitLazyDebugSafely(sink, debugType, event, payload);
    },
  };
}
