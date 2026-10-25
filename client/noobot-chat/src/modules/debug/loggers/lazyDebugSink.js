/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction } from "@noobot/shared/value";
export function acceptsDebugSink(sink) {
  return Boolean(sink && isFunction(sink.debug) && isFunction(sink.isEnabled));
}

export function isDebugTypeEnabled(sink, debugType) {
  return sink?.isEnabled?.(debugType) === true;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function scopeSessionLogRecord(record = {}) {
  const {
    sessionId: rawSessionId,
    parentSessionId: rawParentSessionId,
    dialogProcessId,
    turnScopeId,
    ...rest
  } = record;
  const sessionId = text(rawSessionId);
  if (!sessionId) return { ...rest, scope: "system" };
  const parentSessionId = text(rawParentSessionId);
  return {
    ...rest,
    scope: "session",
    sessionId,
    ...(parentSessionId ? { parentSessionId } : {}),
    dialogProcessId: text(dialogProcessId),
    turnScopeId: text(turnScopeId),
  };
}

export function buildLazyDebugRecord(debugType, event, payload = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  return scopeSessionLogRecord({
    category: "debug",
    level: "debug",
    debugType,
    event,
    sessionId: data.sessionId,
    parentSessionId: data.parentSessionId,
    dialogProcessId: data.dialogProcessId,
    turnScopeId: data.turnScopeId,
    data: { event, ...data },
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
