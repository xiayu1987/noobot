/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction } from "@noobot/shared/value";
import { createSystemSessionLogObservation } from "@noobot/runtime-events/session-log-protocol";
export function acceptsDebugSink(sink) {
  return Boolean(sink && isFunction(sink.debug) && isFunction(sink.isEnabled));
}

export function isDebugTypeEnabled(sink, debugType) {
  return sink?.isEnabled?.(debugType) === true;
}

export function buildLazyDebugRecord(debugType, event, payload = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const { sessionId, parentSessionId, dialogProcessId, turnScopeId, ...details } = data;
  return createSystemSessionLogObservation({
    category: "debug",
    level: "debug",
    debugType,
    event,
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
    data: { event, ...details },
  });
}

export function emitLazyDebug(sink, debugType, event, payload = {}) {
  if (!isDebugTypeEnabled(sink, debugType)) return false;
  return sink.debug(debugType, () =>
    buildLazyDebugRecord(debugType, event, typeof payload === "function" ? payload() : payload),
  );
}

export function emitLazyDebugSafely(sink, debugType, event, payload = {}) {
  try {
    return emitLazyDebug(sink, debugType, event, payload);
  } catch (error) {
    console.warn(`[noobot:${debugType}] debug sink failed for ${event}`, error);
    return false;
  }
}
