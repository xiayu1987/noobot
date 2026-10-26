/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { text } from "@noobot/shared/value";
import { selectSessionRuntimeBucket } from "../run-state-machine/turnRuntimeRegistry.js";

export function createRuntimeEventProjector({
  turnRuntimeRegistry,
  chatStore,
  resolveActiveSessionIdentity,
}) {
  const submitTurnRuntimeEvent = (event) => {
    const requestedSessionId = text(event?.sessionId);

    const result = chatStore.applyTurnRuntimeEvent(event);
    const selectedSessionId = resolveActiveSessionIdentity();
    const activeBucket = selectSessionRuntimeBucket(turnRuntimeRegistry.value, selectedSessionId);
    logThinkingReplayDebug("frontend.lifecycle.runtimeConsumed", () => ({
      sessionId: requestedSessionId || selectedSessionId,
      requestedSessionId,
      selectedSessionId,
      eventTurnScopeId: text(event?.turnScopeId),
      eventDialogProcessId: text(event?.dialogProcessId),
      eventType: text(event?.type || event?.eventType),
      eventState: text(event?.state || event?.backendState),
      resultApplied: result?.applied === true,
      resultReason: text(result?.reason),
      canonicalSessionId: text(result?.canonicalSessionId || result?.turn?.sessionId),
      canonicalTurnScopeId: text(result?.turn?.turnScopeId),
      canonicalState: text(result?.turn?.state),
      canonicalTerminal: result?.turn?.terminal || null,
      activeBucketTurnScopeId: text(activeBucket?.activeTurnScopeId),
    }));
    return {
      ...result,
      messageEffect: {
        projected: Boolean(result?.turn),
        state: result?.turn?.state || "",
        terminal: result?.turn?.terminal || "",
      },
    };
  };

  return submitTurnRuntimeEvent;
}
