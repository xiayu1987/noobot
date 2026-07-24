/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

export function setTerminalResolutionDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function logTerminalResolutionDebug(event, payload = {}) {
  try {
    sessionLogSink?.log?.({
      category: "debug",
      level: "debug",
      debugType: "terminal-resolution",
      event,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: { event, at: new Date().toISOString(), ...payload },
    });
  } catch {
    // Diagnostics must never affect terminal state consumption.
  }
}
