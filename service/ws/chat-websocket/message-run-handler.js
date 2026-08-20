/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverOrphanedTurn } from "@noobot/authoritative-state/application";
import { TURN_EVENT, TURN_PHASE, createTurnLifecycleCommandId } from "@noobot/session-protocol";
import { findActiveRun } from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import {
  acceptRunCommand,
  bindExistingRun,
  mapRunCommand,
  recordReceivedCommand,
  validateRunIdentity,
} from "./message-run/command-stage.js";
import { activateRun } from "./message-run/active-run-stage.js";
import { createMessageRunEventListener } from "./message-run/event-listener-stage.js";
import { finalizeRunResult } from "./message-run/terminal-stage.js";

const text = (value) => String(value || "").trim();

function createOrphanedTurnRecovery(context) {
  return async ({ accepted = null, userId = "", sessionId = "", parentSessionId = "" } = {}) => {
    const result = await recoverOrphanedTurn({
      conflict: accepted,
      identity: { userId, sessionId, parentSessionId },
      inspectExecution: ({ turnScopeId, dialogProcessId }) => ({
        alive: Boolean(
          findActiveRun({
            userId: context.canonicalRunOwnerId,
            sessionId,
            turnScopeId,
            dialogProcessId,
          }),
        ),
        observedAtMs: Date.now(),
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
    // The failure command remains responsible for recording the run failure.
  }
}

function resolveFailureContext(context, fallbackPhase) {
  const authorityPhase = Object.values(TURN_PHASE).includes(context.lifecycle.latestTurn?.phase)
    ? context.lifecycle.latestTurn.phase
    : "";
  const meta = context.state.currentRunMeta || {};
  return {
    phase: authorityPhase || context.state.currentLifecyclePhase || fallbackPhase,
    commandBase: text(
      context.state.currentLifecycleCommandId || context.state.currentTurnScopeId || "turn",
    ),
    userId: meta.userId || text(context.authInfo?.userId),
    sessionId: meta.sessionId || "",
    parentSessionId: meta.parentSessionId || "",
    turnScopeId: meta.turnScopeId || context.state.currentTurnScopeId || "",
    dialogProcessId: meta.dialogProcessId || "",
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
    return context.commitTurnLifecycle({
      userId: failureContext.userId,
      sessionId: failureContext.sessionId,
      parentSessionId: failureContext.parentSessionId,
      turnScopeId: failureContext.turnScopeId,
      dialogProcessId: failureContext.dialogProcessId,
      commandId: createTurnLifecycleCommandId({
        commandId: failureContext.commandBase,
        eventType: TURN_EVENT.FAILED,
        phase: failureContext.phase,
      }),
      eventType: TURN_EVENT.FAILED,
      phase: failureContext.phase,
      failure: {
        phase: failureContext.phase,
        code: text(error?.errorCode || error?.code || "turn_failed"),
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
        sessionLogConfig: context.sessionLogConfig,
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

async function executeAcceptedRun(context, command, run, accepted, active) {
  const listener = createMessageRunEventListener(context, command, run, accepted, active);
  const result = await accepted.agentApplication.run({
    userId: run.userId,
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    dialogProcessId: run.dialogProcessId,
    parentDialogProcessId: run.parentDialogProcessId,
    caller: "user",
    message: run.message,
    attachments: run.attachments,
    eventListener: listener.eventListener,
    abortSignal: context.state.currentAbortSignal,
    userInteractionBridge: context.userInteractionBridge,
    runConfig: run.normalizedRunConfig,
  });
  if (listener.lifecycle.processingStarted) await listener.lifecycle.processingStarted;
  await finalizeRunResult(context, run, accepted, active, result);
}

function createRunHandler(context) {
  return async function handleRun(command, { onRunBound = null }) {
    const run = await mapRunCommand(context, command);
    recordReceivedCommand(context, command, run);
    validateRunIdentity(context, run);
    if (await bindExistingRun(context, run, onRunBound)) return { rebound: true };
    const accepted = await acceptRunCommand(context, command, run);
    const active = await activateRun(context, command, run, accepted, onRunBound);
    await executeAcceptedRun(context, command, run, accepted, active);
  };
}

export function createMessageRunHandler(dependencies) {
  const context = {
    ...dependencies,
    canonicalRunOwnerId: text(dependencies.authInfo?.userId),
    lifecycle: { pending: null, latestTurn: null },
  };
  context.recoverOrphanedTurnConflict = createOrphanedTurnRecovery(context);
  context.recordRunTransportDiagnostic = createRunTransportDiagnostic(context);
  return {
    handleRun: createRunHandler(context),
    commitCurrentFailure: createFailureCommitter(context),
  };
}
