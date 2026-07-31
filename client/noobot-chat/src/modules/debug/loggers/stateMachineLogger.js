/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  getMessageRuntimeChannelState,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../../chat/runtime/sessionRunStateMachine.js";
import { acceptsDebugSink, emitLazyDebug, isDebugTypeEnabled } from "./lazyDebugSink.js";

let sessionLogSink = null;

export function setStateMachineDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function isStateMachineDebugEnabled() {
  return isDebugTypeEnabled(sessionLogSink, "state-machine");
}

export function summarizeStateMachineMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const channelState = getMessageRuntimeChannelState(message);
  return {
    id: message.id || message.messageId || "",
    messageId: message.messageId || message.id || "",
    sourceMessageId: message.sourceMessageId || "",
    presentationMessageId: message.presentationMessageId || "",
    role: message.role || message.messageRole || message.type || "",
    sessionId: message.sessionId || message.session_id || message.owner?.sessionId || "",
    dialogProcessId: message.dialogProcessId || message.dialog_process_id || message.owner?.dialogProcessId || "",
    turnScopeId: message.turnScopeId || message.owner?.turnScopeId || "",
    pending: message.pending === true,
    channelState: channelState?.state || "",
    statusLabelKey: message.statusLabelKey || "",
    statusLabel: message.statusLabel || "",
    hasRuntimeMark: Boolean(message[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message.runtimeMark),
    contentLength: String(message.content || message.text || message.message || "").length,
  };
}

function clean(value) {
  return String(value || "").trim();
}

export function summarizeStateMachineEvent(event = {}) {
  const raw = event?.raw && typeof event.raw === "object" ? event.raw : {};
  return {
    eventType: clean(event?.type),
    lifecycleEventType: clean(event?.eventType || raw?.eventType),
    source: clean(event?.source || raw?.source),
    authority: clean(event?.authority || raw?.authority),
    sessionId: clean(event?.sessionId || raw?.sessionId),
    dialogProcessId: clean(event?.dialogProcessId || raw?.dialogProcessId),
    turnScopeId: clean(event?.turnScopeId || raw?.turnScopeId),
    executionId: clean(event?.executionId || raw?.executionId),
    executionKind: clean(event?.executionKind || raw?.executionKind),
    revision: Number(event?.revision ?? raw?.revision ?? 0),
    sequence: Number(event?.sequence ?? event?.seq ?? raw?.sequence ?? raw?.seq ?? 0),
    commandId: clean(event?.commandId || raw?.commandId),
  };
}

export function summarizeStateMachineTurn(turn = {}, projection = null) {
  if (!turn || typeof turn !== "object") return null;
  const view = projection && typeof projection === "object" ? projection : turn;
  return {
    sessionId: clean(turn.sessionId),
    dialogProcessId: clean(turn.dialogProcessId),
    turnScopeId: clean(turn.turnScopeId),
    state: clean(view.displayState || turn.displayState || turn.state),
    backendState: clean(turn.backendState || turn.transportState),
    action: clean(turn.action),
    sending: view.sending === true,
    canStop: view.canStop === true,
    terminal: turn.terminal || null,
    terminalResolved: turn.terminalResolved === true,
    lifecycleObserved: turn.lifecycleObserved === true,
    revision: Number(turn.revision || 0),
    sequence: Number(turn.seq || turn.sequence || 0),
    commandPending: turn.commandPending === true,
  };
}

export function summarizeTurnLifecycleSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const activeTurn = snapshot.activeTurn && typeof snapshot.activeTurn === "object"
    ? snapshot.activeTurn
    : null;
  return {
    sessionId: clean(snapshot.sessionId),
    activeTurnScopeId: clean(snapshot.activeTurnScopeId),
    sequence: Number(snapshot.sequence || 0),
    unchanged: snapshot.unchanged === true,
    recentTerminalTurnCount: Array.isArray(snapshot.recentTerminalTurns)
      ? snapshot.recentTerminalTurns.length
      : 0,
    activeTurn: activeTurn ? {
      sessionId: clean(activeTurn.sessionId || snapshot.sessionId),
      dialogProcessId: clean(activeTurn.dialogProcessId),
      turnScopeId: clean(activeTurn.turnScopeId),
      executionId: clean(activeTurn.executionId),
      executionKind: clean(activeTurn.executionKind),
      state: clean(activeTurn.state),
      phase: clean(activeTurn.phase),
      executionState: clean(activeTurn.executionState),
      canStop: activeTurn.capabilities?.canStop === true,
      actionLocked: activeTurn.capabilities?.actionLocked === true,
      revision: Number(activeTurn.revision || 0),
      sequence: Number(activeTurn.sequence || 0),
    } : null,
  };
}

export function logStateMachineDebug(event, payload = {}) {
  try {
    return emitLazyDebug(sessionLogSink, "state-machine", event, payload);
  } catch {}
}
