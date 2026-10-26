/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_EVENT,
  createTurnLifecycleCommandId,
  isTurnLifecycleRejectedError,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  consumeUserInterjections,
  createExecutionLivenessInspector,
  sealUserInterjectionQueueIfEmpty,
} from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import { selectAuthoritativeActiveTurn } from "@noobot/authoritative-state/application";
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
  return async ({ accepted, userId, sessionId }) => {
    if (accepted.reason !== "session_action_conflict") return false;
    const turn = selectAuthoritativeActiveTurn(accepted.lifecycle);
    const result = await recoverPersistedTurn({
      turn,
      userId,
      sessionId,
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

function resolveFailureContext(context) {
  const meta = context.state.currentRunMeta;
  return {
    phase: context.lifecycle.latestTurn.phase,
    commandBase: meta.commandId,
    userId: meta.userId,
    sessionId: meta.sessionId,
    turnScopeId: meta.turnScopeId,
    dialogProcessId: meta.dialogProcessId,
  };
}

const TURN_FAILED = "turn_failed";

function createFailureCommitter(context) {
  return async function commitCurrentFailure(error, terminalCommand = "error") {
    await settlePendingLifecycle(context);
    const failureContext = resolveFailureContext(context);
    const commandId = createTurnLifecycleCommandId({
      commandId: failureContext.commandBase,
      eventType: TURN_EVENT.FAILED,
      phase: failureContext.phase,
    });
    return context.commitTurnLifecycle({
      userId: failureContext.userId,
      sessionId: failureContext.sessionId,
      turnScopeId: failureContext.turnScopeId,
      dialogProcessId: failureContext.dialogProcessId,
      commandId,
      causationId: commandId,
      eventType: TURN_EVENT.FAILED,
      phase: failureContext.phase,
      failure: {
        code: isTurnLifecycleRejectedError(error) ? error.code : TURN_FAILED,
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

function createRunTransportDiagnostic() {
  return (identity) =>
    (data = {}) => {
      void recordServiceWebSocketLifecycle({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: `service.websocket.runTransport.${String(data.stage || "observed")}`,
        userId: text(identity.userId),
        sessionId: text(identity.sessionId),
        dialogProcessId: text(identity.dialogProcessId),
        turnScopeId: text(identity.turnScopeId),
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
    persistenceScope: context.persistenceScope,
    dialogProcessId: run.dialogProcessId,
    parentDialogProcessId: run.parentDialogProcessId,
    turnScopeId: run.turnScopeId,
    caller: SESSION_CALLER.USER,
    message: run.message,
    attachments: run.attachments,
    systemMessages: [],
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
    await recordReceivedCommand(command, run);
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
  context.recordRunTransportDiagnostic = createRunTransportDiagnostic();
  return {
    handleRun: createRunHandler(context),
    commitCurrentFailure: createFailureCommitter(context),
  };
}
