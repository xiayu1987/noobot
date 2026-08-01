/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";

export function createRuntimeEventProjector({ sessions, activeSession, turnRuntimeRegistry, chatStore, resolveActiveSessionIdentity }) {
  const submitTurnRuntimeEvent = (event) => {
    const requestedSessionId = String(event?.sessionId || "").trim();
    const requestedTurnScopeId = String(event?.turnScopeId || "").trim();
    const result = chatStore.applyTurnRuntimeEvent(event);
    const selectedSessionId = resolveActiveSessionIdentity();
    const activeBucket = turnRuntimeRegistry.value?.sessions?.[selectedSessionId] || null;
    logThinkingReplayDebug("frontend.lifecycle.runtimeConsumed", () => ({
      sessionId: requestedSessionId || selectedSessionId,
      requestedSessionId,
      selectedSessionId,
      eventTurnScopeId: String(event?.turnScopeId || "").trim(),
      eventDialogProcessId: String(event?.dialogProcessId || "").trim(),
      eventType: String(event?.type || event?.eventType || "").trim(),
      eventState: String(event?.state || event?.backendState || "").trim(),
      resultApplied: result?.applied === true,
      resultReason: String(result?.reason || "").trim(),
      canonicalSessionId: String(result?.canonicalSessionId || result?.turn?.sessionId || "").trim(),
      canonicalTurnScopeId: String(result?.turn?.turnScopeId || "").trim(),
      canonicalState: String(result?.turn?.state || "").trim(),
      canonicalTerminal: result?.turn?.terminal || null,
      activeBucketTurnScopeId: String(activeBucket?.activeTurnScopeId || "").trim(),
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
