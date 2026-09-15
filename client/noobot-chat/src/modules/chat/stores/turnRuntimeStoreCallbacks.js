/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logTurnRuntimeDiagnostics } from "../../debug/loggers/turnRuntimeDiagnosticsLogger.js";
import { projectTurnRuntimeToMessages } from "../runtime/engine/turnProjectionStore.js";
import {
  buildCommitProjectionDiagnostics,
  buildMessageProjectionDiagnostics,
  buildTurnEvaluatedDiagnostics,
} from "./turnRuntimeStoreDiagnostics.js";

function text(value) {
  return String(value || "").trim();
}

export function createTurnRuntimeStoreCallbacks({
  sessions,
  activeSession,
  turnRuntimeRegistry,
  getSubSessions,
  closePendingInteractionsForTerminalTurn,
}) {
  function onTurnEvaluated(evaluation) {
    logTurnRuntimeDiagnostics("frontend.turnRuntime.commitEvaluated", () =>
      buildTurnEvaluatedDiagnostics(evaluation),
    );
  }

  function onTurnCommitted(result) {
    const turn = result?.turn;
    closePendingInteractionsForTerminalTurn(turn);
    const subSessions = getSubSessions();
    const sessionId = text(turn?.sessionId);
    const parentSessionId = text(turn?.parentSessionId);
    const existingSubSession = Boolean(
      sessionId && subSessions?.selectSubSessionMessages(sessionId),
    );
    const projectionEligible = Boolean(
      sessionId && subSessions && (existingSubSession || parentSessionId),
    );
    logTurnRuntimeDiagnostics("frontend.turnRuntime.commitProjectionEvaluated", () =>
      buildCommitProjectionDiagnostics({
        turn,
        result,
        sessionId,
        parentSessionId,
        existingSubSession,
        projectionEligible,
      }),
    );
    const mainSessionProjection = projectTurnRuntimeToMessages({
      sessions,
      activeSession,
      turnRuntimeRegistry,
      turn,
    });
    let container = { applied: false, reason: "not_sub_session" };
    let subSessionProjection = {
      applied: false,
      patchedMessageCount: 0,
      reason: "not_sub_session",
    };
    if (projectionEligible) {
      container = subSessions.ensureSubSessionMessageContainer(turn);
      subSessionProjection = subSessions.applyTurnRuntimeMessageProjection(turn);
    }
    logTurnRuntimeDiagnostics("frontend.turnRuntime.messageProjectionCommitted", () =>
      buildMessageProjectionDiagnostics({
        turn,
        sessionId,
        parentSessionId,
        mainSessionProjection,
        subSessionProjection,
      }),
    );
    return { container, mainSessionProjection, subSessionProjection };
  }

  return { onTurnEvaluated, onTurnCommitted };
}
