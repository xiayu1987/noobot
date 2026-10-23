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
    const { turn } = result;
    closePendingInteractionsForTerminalTurn(turn);
    logTurnRuntimeDiagnostics("frontend.turnRuntime.commitProjectionEvaluated", () =>
      buildCommitProjectionDiagnostics({ turn, result }),
    );
    const mainSessionProjection = projectTurnRuntimeToMessages({
      sessions,
      activeSession,
      turnRuntimeRegistry,
      turn,
    });
    const subSessionProjection = getSubSessions().applyTurnRuntimeMessageProjection(turn);
    logTurnRuntimeDiagnostics("frontend.turnRuntime.messageProjectionCommitted", () =>
      buildMessageProjectionDiagnostics({
        turn,
        mainSessionProjection,
        subSessionProjection,
      }),
    );
    return { mainSessionProjection, subSessionProjection };
  }

  return { onTurnEvaluated, onTurnCommitted };
}
