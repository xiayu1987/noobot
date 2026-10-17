/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT, TURN_PHASE, createTurnLifecycleCommandId } from "@noobot/session-protocol";
import {
  consumeUserInterjections,
  createExecutionLivenessInspector,
  sealUserInterjectionQueueIfEmpty,
} from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import { recoverPersistedTurn } from "./turn-recovery.js";
import {
  acceptRunCommand,
  bindExistingRun,
  mapRunCommand,
  recordReceivedCommand,
  validateRunIdentity,
} from "./message-run/command-stage.js";
import { activateRun, reserveRun } from "./message-run/active-run-stage.js";
import { createMessageRunEventListener } from "./message-run/event-listener-stage.js";
import { finalizeRunResult } from "./message-run/terminal-stage.js";
import { text } from "@noobot/shared/value";

function createConflictTurnRecovery(context) {
  return async ({ accepted = null, userId = "", sessionId = "", parentSessionId = "" } = {}) => {
    if (accepted?.reason !== "session_action_conflict") return false;
    const lifecycle = accepted.lifecycle || {};
    const turn = lifecycle.turns?.[text(lifecycle.activeTurnScopeId)] || null;
    const result = await recoverPersistedTurn({
      turn,
      userId,
      sessionId,
      parentSessionId,
      inspectExecution: createExecutionLivenessInspector({
        userId: context.canonicalRunOwnerId,
        sessionId,
      }),
      commitTurnLifecycle: context.commitTurnLifecycle,
    });
    return result.recovered === true;
  };
}

async function settlePendingLifecycle(context) {
  if (!context.lifecycle.pending) return;
  try {
    const pendingResult = await context.lifecycle.pending;
    if (pendingResult?.turn) context.lifecycle.latestTurn = pendingResult.turn;
  } catch {
    void 0;
  }
}

function resolveFailureContext(context, fallbackPhase) {
  const authorityPhase = Object.values(TURN_PHASE).includes(context.lifecycle.latestTurn?.phase)
    ? context.lifecycle.latestTurn.phase
    : "";
  const meta = context.state.currentRunMeta;
  return {
    phase: authorityPhase || context.state.currentLifecyclePhase || fallbackPhase,
    commandBase: meta.commandId,
    userId: meta.userId,
    sessionId: meta.sessionId,
    parentSessionId: meta.parentSessionId,
    turnScopeId: meta.turnScopeId,
    dialogProcessId: meta.dialogProcessId,
  };
}

function createFailureCommitter(context) {
  return async function commitCurrentFailure(
    error,
    fallbackPhase = TURN_PHASE.ACTION,
    terminalCommand = "error",
  ) {
    await settlePendingLifecycle(context);
    const failureContext = resolveFailureContext(context, fallbackPhase);
    const commandId = createTurnLifecycleCommandId({
      commandId: failureContext.commandBase,
      eventType: TURN_EVENT.FAILED,
      phase: failureContext.phase,
    });
    return context.commitTurnLifecycle({
      userId: failureContext.userId,
      sessionId: failureContext.sessionId,
      parentSessionId: failureContext.parentSessionId,
      turnScopeId: failureContext.turnScopeId,
      dialogProcessId: failureContext.dialogProcessId,
      commandId,
      causationId: commandId,
      eventType: TURN_EVENT.FAILED,
      phase: failureContext.phase,
      failure: {
        phase: failureContext.phase,
        code: text(error?.code || "turn_failed"),
        message: String(error?.message || "turn failed"),
        retryable: false,
      },
      terminalStatus: {
        command: terminalCommand,
        description: String(error?.message || "turn failed"),
        error,
      },
    });
  };
}

function createRunTransportDiagnostic(context) {
  return (identity = {}) =>
    (data = {}) => {
      void recordServiceWebSocketLifecycle({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: `service.websocket.runTransport.${String(data.stage || "observed")}`,
        userId: identity.userId || "",
        sessionId: identity.sessionId || "",
        dialogProcessId: identity.dialogProcessId || "",
        turnScopeId: identity.turnScopeId || "",
        data,
      });
    };
}

async function executeAcceptedRun(context, run, accepted, active) {
  const listener = createMessageRunEventListener(context, run, accepted, active);
  await accepted.agentApplication.run({
    userId: run.userId,
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    dialogProcessId: run.dialogProcessId,
    parentDialogProcessId: run.parentDialogProcessId,
    turnScopeId: run.turnScopeId,
    caller: "user",
    message: run.message,
    attachments: run.attachments,
    turnAcceptance: run.turnAcceptance,
    eventListener: listener.eventListener,
    abortSignal: context.state.currentAbortSignal,
    userInteractionBridge: context.userInteractionBridge,
    userInterjectionPort: Object.freeze({
      consume: (consumer) => consumeUserInterjections(active.runHandle, consumer),
      sealIfEmpty: () => sealUserInterjectionQueueIfEmpty(active.runHandle),
    }),
    runConfig: run.normalizedRunConfig,
  });
  if (listener.lifecycle.processingStarted) await listener.lifecycle.processingStarted;
  await finalizeRunResult(context, run, accepted, active);
}

function createRunHandler(context) {
  return async function handleRun(command, { onRunBound = null }) {
    const run = await mapRunCommand(context, command);
    recordReceivedCommand(context, command, run);
    validateRunIdentity(context, run);
    if (await bindExistingRun(context, run, onRunBound)) return { rebound: true };
    reserveRun(context, run, onRunBound);
    const accepted = await acceptRunCommand(context, command, run);
    const active = await activateRun(context, command, run, accepted);
    await executeAcceptedRun(context, run, accepted, active);
  };
}

export function createMessageRunHandler(dependencies) {
  const context = {
    ...dependencies,
    canonicalRunOwnerId: text(dependencies.authInfo?.userId),
    lifecycle: { pending: null, latestTurn: null },
  };
  context.recoverConflictingTurn = createConflictTurnRecovery(context);
  context.recordRunTransportDiagnostic = createRunTransportDiagnostic(context);
  return {
    handleRun: createRunHandler(context),
    commitCurrentFailure: createFailureCommitter(context),
  };
}
