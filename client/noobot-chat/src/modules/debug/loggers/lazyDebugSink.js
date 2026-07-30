/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function acceptsDebugSink(sink) {
  return Boolean(sink && typeof sink.debug === "function" && typeof sink.isEnabled === "function");
}

export function isDebugTypeEnabled(sink, debugType) {
  return sink?.isEnabled?.(debugType) === true;
}

export function emitLazyDebug(sink, debugType, event, payload = {}) {
  if (!isDebugTypeEnabled(sink, debugType)) return false;
  return sink.debug(debugType, () => {
    const resolvedPayload = typeof payload === "function" ? payload() : payload;
    return {
      category: "debug",
      level: "debug",
      debugType,
      event,
      sessionId: resolvedPayload?.sessionId || resolvedPayload?.runState?.sessionId || "",
      dialogProcessId: resolvedPayload?.dialogProcessId || resolvedPayload?.runState?.dialogProcessId || "",
      turnScopeId: resolvedPayload?.turnScopeId || resolvedPayload?.runState?.turnScopeId || "",
      data: {
        debugType,
        event,
        at: new Date().toISOString(),
        ...(resolvedPayload && typeof resolvedPayload === "object" ? resolvedPayload : {}),
      },
    };
  });
}
