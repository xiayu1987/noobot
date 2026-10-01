/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebugSafely, isDebugTypeEnabled } from "./lazyDebugSink.js";

export function createDiagnosticsLogger(debugType) {
  let sink = null;
  return {
    setSink(next = null) {
      sink = acceptsDebugSink(next) ? next : null;
    },
    isEnabled() {
      return isDebugTypeEnabled(sink, debugType);
    },
    log(event, payload = {}) {
      return emitLazyDebugSafely(sink, debugType, event, payload);
    },
  };
}
