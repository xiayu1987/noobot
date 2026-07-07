/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "./resendDebugLogger";

let sessionLogSink = null;

export function setStopDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function isStopDebugEnabled() {
  return true;
}

export { summarizeDebugMessage, summarizeDebugMessages };

export function logStopDebug(phase, payload = {}) {
  try {
    const entry = {
      phase,
      at: new Date().toISOString(),
      ...payload,
    };
    sessionLogSink?.log?.({
      category: "debug",
      debugType: "stop",
      event: phase,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: entry,
    });
  } catch {}
}
