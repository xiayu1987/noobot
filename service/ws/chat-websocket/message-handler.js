/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  enqueueUserInterjection,
  findActiveRun,
  publishRunEvent,
  unregisterActiveRun,
} from "./run-registry.js";
import {
  recordServiceAgentTransportDebug,
  recordServiceWebSocketLifecycle,
} from "./runtime-events.js";
import { isAbortLikeError, isSocketCloseRunAbort, isUserStopRunAbort } from "./stop-lifecycle.js";
import { resetRunState } from "./connection-state.js";
import { TURN_PHASE } from "@noobot/session-protocol";
import { resolveExecutionAbortMessage } from "@noobot/session-protocol/execution-abort";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  EXECUTION_QUERY_COMMAND_TYPES,
  RUN_COMMAND_TYPES,
  createAgentCommandReceipt,
  parseAgentCommand,
} from "@noobot/agent-transport-protocol";
import { createMessageQueryHandlers } from "./message-query-handlers.js";
import { createMessageStopHandler } from "./message-stop-handler.js";
import { createMessageRunHandler } from "./message-run-handler.js";
import { sendFailedCommandReceipt } from "./command-receipt.js";

export function createMessageHandler({
  state,
  authInfo,
  webSocket,
  sendEvent,
  translateText,
  normalizeLocale,
  mapAgentRunCommand,
  connectorAccessPort,
  resolveBot,
  sessionLogConfig,
  rejectTurnInteractions,
  userInteractionBridge,
  buildRunStateSnapshot,
  finalizeTimeout,
  finalizeUserStopped,
  finalizeCompleted,
  finalizeAborted,
  finalizeGenericError,
  commitTurnLifecycle,
  commitUserInterjection,
  dispatchAuthorityEvents,
  recoverTurnFinalize,
  recoverSnapshotOrphan,
}) {
  const canonicalRunOwnerId = String(authInfo?.userId || "").trim();

  const { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize } =
    createMessageQueryHandlers({
      state,
      authInfo,
      sendEvent,
      translateText,
      resolveBot,
      canonicalRunOwnerId,
      recoverTurnFinalize,
      recoverSnapshotOrphan,
    });
  const handleStop = createMessageStopHandler({
    state,
    canonicalRunOwnerId,
    sendEvent,
    translateText,
    resolveBot,
    sessionLogConfig,
    rejectTurnInteractions,
    commitTurnLifecycle,
  });
  const { handleRun, commitCurrentFailure } = createMessageRunHandler({
    state,
    authInfo,
    sendEvent,
    translateText,
    normalizeLocale,
    mapAgentRunCommand,
    connectorAccessPort,
    resolveBot,
    sessionLogConfig,
    userInteractionBridge,
    buildRunStateSnapshot,
    finalizeTimeout,
    finalizeUserStopped,
    finalizeCompleted,
    commitTurnLifecycle,
    dispatchAuthorityEvents,
  });

  const context = {
    state,
    webSocket,
    sendEvent,
    translateText,
    sessionLogConfig,
    canonicalRunOwnerId,
    buildRunStateSnapshot,
    finalizeTimeout,
    finalizeUserStopped,
    finalizeAborted,
    finalizeGenericError,
    commitUserInterjection,
    dispatchAuthorityEvents,
    commitCurrentFailure,
    routes: {
      handleExecutionQuery,
      handleSnapshotGet,
      handleFinalize,
      handleInteractionResponse,
      handleStop,
    },
  };

  return async function onMessage(rawMessage) {
    let runMessageStarted = false;
    let boundRunHandle = null;
    let parsedCommand = null;
    try {
      const command = parseAgentCommand(rawMessage);
      parsedCommand = command;
      void recordServiceAgentTransportDebug({
        sessionLogConfig,
        event: "service.agentTransport.commandReceived",
        command,
        userId: canonicalRunOwnerId,
        data: { accepted: true, transport: "websocket" },
      });
      if (await routeNonRunCommand(context, command)) return;
      if (!RUN_COMMAND_TYPES.includes(command.commandType)) {
        throw new Error("unsupported_agent_command");
      }
      if (state.isRunning) {
        sendFailedCommandReceipt(sendEvent, command, {
          code: "session_already_running",
          message: translateText("ws.sessionAlreadyRunning", state.currentLocale),
        });
        return;
      }
      runMessageStarted = true;
      const runResult = await handleRun(command, {
        onRunBound: (handle) => {
          boundRunHandle = handle;
        },
      });
      if (runResult?.rebound === true) {
        runMessageStarted = false;
        sendCommandReceipt(context, command, AGENT_COMMAND_RECEIPT_OUTCOME.REBOUND);
      }
    } catch (error) {
      if (!parsedCommand && error?.command) parsedCommand = error.command;
      if (!runMessageStarted || !state.currentRunMeta) {
        rejectCommand(context, error, parsedCommand, rawMessage);
        return;
      }
      await settleFailedRun(context, error);
    } finally {
      if (runMessageStarted) releaseRun(context, boundRunHandle);
    }
  };
}

const INTERJECT_IDENTITY_FIELDS = ["sessionId", "dialogProcessId", "turnScopeId"];

function sendCommandReceipt({ sendEvent }, command, outcome) {
  sendEvent(
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({
      commandId: command.commandId,
      commandType: command.commandType,
      outcome,
      identity: command.identity,
    }),
  );
}

async function routeNonRunCommand(context, command) {
  const { routes } = context;
  const { commandType } = command;
  if (EXECUTION_QUERY_COMMAND_TYPES.includes(commandType)) {
    await routes.handleExecutionQuery(command, commandType);
  } else if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET) {
    await routes.handleSnapshotGet(command);
  } else if (commandType === AGENT_COMMAND.FINALIZE) {
    await routes.handleFinalize(command);
  } else if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
    routes.handleInteractionResponse(command);
  } else if (commandType === AGENT_COMMAND.INTERJECT) {
    await handleInterject(context, command);
  } else if (commandType === AGENT_COMMAND.STOP) {
    await routes.handleStop(command);
  } else {
    return false;
  }
  return true;
}

function findInterjectTarget({ sendEvent, canonicalRunOwnerId }, command) {
  const activeRun = findActiveRun({ userId: canonicalRunOwnerId, ...command.identity });
  if (!activeRun) {
    sendFailedCommandReceipt(sendEvent, command, {
      code: "active_turn_not_found",
      message: "active turn not found",
    });
    return null;
  }
  const identityMatches = INTERJECT_IDENTITY_FIELDS.every(
    (field) =>
      String(activeRun[field] || "").trim() === String(command.identity[field] || "").trim(),
  );
  if (identityMatches) return activeRun;
  sendFailedCommandReceipt(sendEvent, command, {
    code: "active_turn_identity_mismatch",
    message: "active turn identity mismatch",
  });
  return null;
}

async function enqueueInterjection({ sendEvent, commitUserInterjection }, command, activeRun) {
  try {
    await enqueueUserInterjection(
      activeRun,
      { commandId: command.commandId, message: command.interaction.message },
      (interjection) => commitUserInterjection({ activeRun, interjection }),
    );
    return true;
  } catch (error) {
    if (error?.code !== "active_turn_stopping") throw error;
    sendFailedCommandReceipt(sendEvent, command, { code: error.code, message: error.message });
    return false;
  }
}

async function dispatchInterjectionAuthority({ dispatchAuthorityEvents }, activeRun) {
  try {
    return await dispatchAuthorityEvents?.(
      {
        userId: activeRun.userId,
        sessionId: activeRun.sessionId,
        parentSessionId: activeRun.parentSessionId,
      },
      (...args) => publishRunEvent(activeRun, ...args),
    );
  } catch (error) {
    return { dispatched: false, reason: error?.message || "authority_dispatch_failed" };
  }
}

async function handleInterject(context, command) {
  const activeRun = findInterjectTarget(context, command);
  if (!activeRun) return;
  if (!(await enqueueInterjection(context, command, activeRun))) return;
  const dispatch = await dispatchInterjectionAuthority(context, activeRun);
  if (dispatch?.dispatched !== true) {
    void recordServiceWebSocketLifecycle({
      sessionLogConfig: context.sessionLogConfig,
      event: "service.userInterjection.authorityDispatchDeferred",
      userId: activeRun.userId,
      sessionId: activeRun.sessionId,
      dialogProcessId: activeRun.dialogProcessId,
      turnScopeId: activeRun.turnScopeId,
      data: { reason: dispatch?.reason || "authority_dispatch_unavailable" },
    });
  }
  sendCommandReceipt(context, command, AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED);
}

function buildRejectionDebugData(error, parsedCommand) {
  return {
    accepted: Boolean(parsedCommand),
    dispatched: false,
    transport: "websocket",
    errorType: String(error?.name || "Error"),
    errorCode: String(error?.code || ""),
    validationErrors: Array.isArray(error?.errors) ? error.errors.slice(0, 20) : [],
  };
}

function buildRejectionReceiptError({ state, translateText }, error) {
  return {
    code: String(error?.errors?.[0] || error?.code || "invalid_command").trim(),
    message: error?.message || translateText("ws.unknownError", state.currentLocale),
  };
}

function rejectCommand(context, error, parsedCommand, rawMessage) {
  const { sendEvent, sessionLogConfig } = context;
  void recordServiceAgentTransportDebug({
    sessionLogConfig,
    event: parsedCommand
      ? "service.agentTransport.commandDispatchFailed"
      : "service.agentTransport.commandRejected",
    command: parsedCommand || rawMessage,
    userId: context.canonicalRunOwnerId,
    data: buildRejectionDebugData(error, parsedCommand),
  });
  void recordServiceWebSocketLifecycle({
    sessionLogConfig,
    event: "service.websocket.request.rejected",
    data: {
      errorType: error?.name || "Error",
      errorCode: String(error?.code || ""),
    },
  });
  const receiptSent =
    parsedCommand &&
    sendFailedCommandReceipt(sendEvent, parsedCommand, buildRejectionReceiptError(context, error));
  if (receiptSent) return;
  context.webSocket.close(1008, "invalid request");
}

async function settleAbortedRun(context, error) {
  const { state, buildRunStateSnapshot } = context;
  if (state.currentRunTimedOut) {
    const timeoutMessage = resolveExecutionAbortMessage({
      error,
      abortSignal: state.currentAbortSignal,
      fallback: "run timeout",
    });
    await context.finalizeTimeout(buildRunStateSnapshot(), {
      description: timeoutMessage,
      errorObject: { message: timeoutMessage, code: "run_timeout" },
    });
  } else if (
    isUserStopRunAbort({
      stopRequested: state.stopRequested,
      abortSignal: state.currentAbortSignal,
    })
  ) {
    await context.finalizeUserStopped(buildRunStateSnapshot());
  } else if (isSocketCloseRunAbort(state.currentAbortSignal)) {
    await context.commitCurrentFailure(error, state.currentLifecyclePhase || TURN_PHASE.ACTION);
  } else {
    void recordServiceWebSocketLifecycle({
      sessionLogConfig: context.sessionLogConfig,
      event: "service.websocket.run.aborted",
      ...state.currentRunMeta,
      data: { errorType: error?.name || "Error" },
    });
    const committed = await context.commitCurrentFailure(error, TURN_PHASE.PROCESSING, "aborted");
    await context.finalizeAborted(buildRunStateSnapshot(), { error, committed });
  }
}

async function settleFailedRun(context, error) {
  const { state } = context;
  if (state.currentAbortSignal?.aborted || isAbortLikeError(error)) {
    await settleAbortedRun(context, error);
    return;
  }
  void recordServiceWebSocketLifecycle({
    sessionLogConfig: context.sessionLogConfig,
    event: "service.websocket.run.failed",
    ...state.currentRunMeta,
    data: { errorType: error?.name || "Error" },
  });
  const committed = await context.commitCurrentFailure(error);
  await context.finalizeGenericError(context.buildRunStateSnapshot(), { error, committed });
}

function releaseRun({ state, sessionLogConfig }, boundRunHandle) {
  if (boundRunHandle) {
    unregisterActiveRun(boundRunHandle);
  }
  if (!boundRunHandle || state.currentRunHandle === boundRunHandle) {
    resetRunState(state);
  }
  void recordServiceWebSocketLifecycle({
    sessionLogConfig,
    event: "service.websocket.run.stateReset",
    data: { completed: true },
  });
}
