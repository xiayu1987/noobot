/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../engine/turnProjectionStore.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  MESSAGE_EVENT_TYPE,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";

function summarizeReconnectEnvelope(envelope) {
  return {
    eventId: envelope.identity.eventId,
    eventType: envelope.payload.eventType,
    sequenceScopeId: envelope.ordering.scopeId,
    sequence: envelope.ordering.sequence,
  };
}

export function applyReconnectEnvelopeToTargetMessage({
  envelope,
  findMessagesByPresentationId,
  materializeTurnPresentation,
}) {
  const presentationMessageId = resolveMessageEventPresentationId(envelope.payload);
  const { sessionId, turnScopeId, eventId } = envelope.identity;
  if (envelope.payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    const materialized = materializeTurnPresentation(envelope);
    logThinkingReplayDebug("frontend.thinkingReplay.presentationMaterialized", () => ({
      sessionId,
      turnScopeId,
      presentationMessageId,
      ...materialized,
    }));
    if (materialized.applied !== true) return false;
  }
  const canonicalTargets = findMessagesByPresentationId(sessionId, presentationMessageId);
  if (canonicalTargets.length === 0) return false;
  const reductions = canonicalTargets.map((targetMessage) =>
    dispatchTurnEnvelope({
      targetMessage,
      envelope,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    }),
  );
  logThinkingReplayDebug("frontend.messageEvent.reduced", () => ({
    source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    sessionId,
    dialogProcessId: envelope.payload.dialogProcessId,
    turnScopeId,
    presentationMessageId,
    eventId,
    eventType: envelope.payload.eventType,
    sequence: envelope.ordering.sequence,
    reductions: reductions.map(({ result, errors }) => ({ result, errors })),
  }));
  return true;
}

export function applyReconnectEnvelopeBatchToTargetMessage({
  messages,
  findMessagesByPresentationId,
  materializeTurnPresentation,
}) {
  let appliedCount = 0;
  for (const envelope of messages) {
    if (
      applyReconnectEnvelopeToTargetMessage({
        envelope,
        findMessagesByPresentationId,
        materializeTurnPresentation,
      })
    )
      appliedCount += 1;
  }
  return appliedCount;
}

export async function applyReconnectReplayBatchToActiveSession({
  activeSession,
  findMessagesByPresentationId,
  materializeTurnPresentation,
  messages,
}) {
  logWorkflowDiagnostics("frontend.workflowReplay.reconnectBatchPlanned", () => ({
    sessionId: activeSession.value.sessionId,
    replayCount: messages.length,
    replayEnvelopes: messages.map(summarizeReconnectEnvelope),
  }));
  const appliedCount = applyReconnectEnvelopeBatchToTargetMessage({
    messages,
    findMessagesByPresentationId,
    materializeTurnPresentation,
  });
  return appliedCount > 0;
}
