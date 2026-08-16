/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { validateRegisteredEvent } from "@noobot/event-protocol";
import { validateSessionEvent } from "@noobot/session-protocol";
import { createAttachmentLifecycleEvent } from "@noobot/attachment-protocol";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnTransportEnvelope } from "../engine/turnTransportEnvelope.js";
import { routeRuntimeStreamEvent } from "../../../../extensions/runtime-stream-router.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

export async function applyReconnectEventReplay({
  event: incomingEvent,
  data: incomingData,
  replayCache,
  isCurrentActiveSession,
  consumeReplayCacheForSession,
  applyReconnectMessagesToActiveSession,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent,
  onAttachmentLifecycle,
  isDeletedTurn,
} = {}) {
  const normalizedTransportEnvelope = normalizeTurnTransportEnvelope({
    event: incomingEvent,
    data: incomingData,
    source: "reconnect",
  });
  const replayEvent = normalizedTransportEnvelope.event;
  const data = normalizedTransportEnvelope.data;
  const replaySessionId = _trimStr(data?.sessionId || data?.messageEvent?.sessionId);
  const replayTurnScopeId = _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId);
  logStateMachineDebug("stateMachine.reconnect.event.received", () => ({
    sessionId: replaySessionId,
    turnScopeId: replayTurnScopeId,
    protocolEvent: replayEvent,
    dialogProcessId: _trimStr(data?.dialogProcessId || data?.messageEvent?.dialogProcessId),
    commandId: _trimStr(data?.commandId),
    transportSequence: Number(data?.seq || 0),
    lifecycleSequence: Number(data?.sequence || data?.messageEvent?.sequence || 0),
    channelState: _trimStr(data?.state || data?.channelState),
  }));
  if (isDeletedTurn?.({ sessionId: replaySessionId, turnScopeId: replayTurnScopeId }) === true) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  // Workflow runtime events have their own identity and reducer. Route an
  // explicit sub-session event before the generic message cache branch;
  // otherwise a valid child-session message is mistaken for an inactive
  // session and never reaches the workflow projection.
  const routeRuntimeEvent = () => {
    let result = null;
    const routed = routeRuntimeStreamEvent(replayEvent, data, {
      source: "reconnect",
      logRuntimeProjectionDiagnostics: logWorkflowDiagnostics,
      applyWorkflowRuntimeEvent: (record, options) => {
        result = applyWorkflowRuntimeEvent?.(record, options);
        return result;
      },
    });
    return { routed, result };
  };
  // Only the explicitly tagged sub-agent wire event may bypass main-session
  // message routing. A normal message_event is also a valid workflow payload,
  // but its transport tag still assigns it to the main message reducer.
  if (replayEvent === "subagent_message_event") {
    const { routed, result } = routeRuntimeEvent();
    if (routed) return result || { applied: true };
  }
  // Message events use the shared message-event protocol. They are not
  // authority/transport registry events and must enter the canonical message
  // reducer without being interpreted as lifecycle state.
  if (replayEvent === "message_event" || replayEvent === "subagent_message_event") {
    const dialogProcessId = _trimStr(data?.dialogProcessId || data?.messageEvent?.dialogProcessId);
    const sessionId = _trimStr(data?.sessionId || data?.messageEvent?.sessionId);
    const turnScopeId = _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId);
    if (!sessionId || !turnScopeId) {
      return { applied: false, reason: "message_event_missing_turn_identity" };
    }
    if (isCurrentActiveSession(sessionId)) {
      await consumeReplayCacheForSession(sessionId);
      await applyReconnectMessagesToActiveSession([{ event: replayEvent, data }], dialogProcessId, {
        turnScopeId,
      });
      return { applied: true, reason: "message_event_replayed" };
    }
    const replayKey = normalizeReplayCacheKey(sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push({ event: replayEvent, data });
    return { applied: false, reason: "message_event_cached" };
  }
  const { routed: runtimeRouted, result: runtimeResult } = routeRuntimeEvent();
  if (runtimeRouted) return runtimeResult || { applied: true };
  if (replayEvent === StreamEventEnum.ATTACHMENT_LIFECYCLE) {
    let event;
    try { event = createAttachmentLifecycleEvent(data); } catch (error) {
      logWorkflowDiagnostics("frontend.workflowReplay.attachmentParsedRejected", {
        sessionId: _trimStr(data?.identity?.sessionId),
        dialogProcessId: _trimStr(data?.dialogProcessId),
        turnScopeId: _trimStr(data?.turnScopeId),
        errors: [error?.message || "invalid_attachment_lifecycle_event"],
      });
      return { applied: false, reason: "invalid_attachment_lifecycle_event" };
    }
    onAttachmentLifecycle?.(event);
    return { applied: true, reason: "attachment_lifecycle_projected" };
  }
  // Let registered extensions consume their own events before applying the
  // core registry. Core authority events are excluded by the router, so they
  // still always pass through the authoritative protocol validation below.
  const protocolEvent = {
    eventType: replayEvent,
    ...(data && typeof data === "object" ? data : {}),
  };
  const sessionResult = validateSessionEvent(protocolEvent);
  const protocolResult = sessionResult.recognized
    ? sessionResult
    : validateRegisteredEvent(protocolEvent);
  if (!protocolResult.valid) {
    return { applied: false, reason: "unsupported_replay_event", errors: protocolResult.errors };
  }
  if (replayEvent === StreamEventEnum.EXECUTION_SNAPSHOT) return applyExecutionSnapshot?.(data || {});
  if (replayEvent === StreamEventEnum.EXECUTION_CHILDREN) return applyExecutionChildren?.(data || {});
  if (replayEvent === StreamEventEnum.EXECUTION_TREE) return applyExecutionTree?.(data || {});
  if (replayEvent === StreamEventEnum.TURN_SNAPSHOT) {
    logStateMachineDebug("stateMachine.reconnect.eventSnapshot.before", () => ({
      ...summarizeTurnLifecycleSnapshot(data),
      commandId: _trimStr(data?.commandId),
      transportSequence: Number(data?.seq || 0),
    }));
    const result = applyTurnLifecycleSnapshot?.(data || {});
    logStateMachineDebug("stateMachine.reconnect.eventSnapshot.after", () => ({
      ...summarizeTurnLifecycleSnapshot(data),
      commandId: _trimStr(data?.commandId),
      transportSequence: Number(data?.seq || 0),
      applied: result?.applied === true,
      reason: result?.reason || "",
      errorCount: Array.isArray(result?.errors) ? result.errors.length : 0,
      resultingActiveTurnScopeId: _trimStr(result?.bucket?.activeTurnScopeId),
    }));
    return result;
  }
  if (replayEvent === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope?.(data || {});
  }
  if (replayEvent === StreamEventEnum.CHANNEL_STATE) {
    // Channel state is a transport projection, never an authority input.
    // Lifecycle state can only enter the registry through an authority
    // snapshot or lifecycle envelope.
    return { applied: false, reason: "transport_channel_state_ignored" };
  }

  const dialogProcessId = _trimStr(data?.dialogProcessId);
  const sessionId = _trimStr(data?.sessionId);
  const turnScopeId = _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId);
  if (sessionId && isCurrentActiveSession(sessionId)) {
    await consumeReplayCacheForSession(sessionId);
    await applyReconnectMessagesToActiveSession([{ event: replayEvent, data }], dialogProcessId, {
      turnScopeId,
    });
    return;
  }

  if (sessionId && turnScopeId) {
    const replayKey = normalizeReplayCacheKey(sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push({ event: replayEvent, data });
  }
}
