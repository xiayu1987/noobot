/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

export function setReconnectTimingDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function logReconnectTimingDebug(event, payload = {}) {
  try {
    sessionLogSink?.log?.({
      category: "debug",
      level: "debug",
      debugType: "reconnect-timing",
      event,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: { event, at: new Date().toISOString(), ...payload },
    });
  } catch {}
}
