/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { unregisterActiveRun } from "./run-registry.js";
import {
  recordServiceAgentTransportDebug,
  recordServiceWebSocketLifecycle,
} from "./runtime-events.js";
import { isAbortLikeError, isSocketCloseRunAbort, isUserStopRunAbort } from "./stop-lifecycle.js";
import { resetRunState } from "./connection-state.js";
import { TURN_PHASE } from "@noobot/session-protocol";
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
  resolveBot,
  sessionLogConfig,
  pendingInteractionRequests,
  rejectAllPendingInteractions,
  userInteractionBridge,
  buildRunStateSnapshot,
  finalizeTimeout,
  finalizeUserStopped,
  finalizeCompleted,
  finalizeAborted,
  finalizeGenericError,
  commitTurnLifecycle,
  dispatchAuthorityEvents,
  recoverTurnFinalize,
  recoverSnapshotOrphan,
}) {
  const canonicalRunOwnerId = String(authInfo?.userId || "").trim();

  const { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize } =
    createMessageQueryHandlers({
    state, authInfo, sendEvent, translateText, resolveBot,
      pendingInteractionRequests, recoverTurnFinalize, recoverSnapshotOrphan,
    });
  const handleStop = createMessageStopHandler({
    state, canonicalRunOwnerId, sendEvent, translateText, resolveBot, sessionLogConfig,
    rejectAllPendingInteractions, commitTurnLifecycle,
  });
  const { handleRun, commitCurrentFailure } = createMessageRunHandler({
    state, authInfo, sendEvent, translateText, normalizeLocale, mapAgentRunCommand,
    resolveBot, sessionLogConfig, userInteractionBridge, buildRunStateSnapshot,
    finalizeTimeout, finalizeUserStopped, finalizeCompleted, commitTurnLifecycle, dispatchAuthorityEvents,
  });

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
      const { commandType } = command;
      if (EXECUTION_QUERY_COMMAND_TYPES.includes(commandType)) {
        await handleExecutionQuery(command, commandType);
        return;
      }
      if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET) {
        await handleSnapshotGet(command);
        return;
      }
      if (commandType === AGENT_COMMAND.FINALIZE) {
        await handleFinalize(command);
        return;
      }
      if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
        handleInteractionResponse(command);
        return;
      }
      if (commandType === AGENT_COMMAND.STOP) {
        await handleStop(command);
        return;
      }
      if (!RUN_COMMAND_TYPES.includes(commandType)) throw new Error("unsupported_agent_command");
      if (state.isRunning) {
        sendFailedCommandReceipt(sendEvent, command, {
          code: "session_already_running",
          message: translateText("ws.sessionAlreadyRunning", state.currentLocale),
        });
        return;
      }
      runMessageStarted = true;
      const runResult = await handleRun(command, {
        onRunBound: (handle) => { boundRunHandle = handle; },
      });
      if (runResult?.rebound === true) {
        runMessageStarted = false;
        sendEvent(
          AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
          createAgentCommandReceipt({
            commandId: command.commandId,
            commandType: command.commandType,
            outcome: AGENT_COMMAND_RECEIPT_OUTCOME.REBOUND,
            identity: command.identity,
          }),
        );
      }
    } catch (error) {
      if (!parsedCommand && error?.command) parsedCommand = error.command;
      if (!runMessageStarted || !state.currentRunMeta) {
        void recordServiceAgentTransportDebug({
          sessionLogConfig,
          event: parsedCommand
            ? "service.agentTransport.commandDispatchFailed"
            : "service.agentTransport.commandRejected",
          command: parsedCommand || rawMessage,
          userId: canonicalRunOwnerId,
          data: {
            accepted: Boolean(parsedCommand),
            dispatched: false,
            transport: "websocket",
            errorType: String(error?.name || "Error"),
            errorCode: String(error?.errorCode || error?.code || ""),
            validationErrors: Array.isArray(error?.errors) ? error.errors.slice(0, 20) : [],
          },
        });
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          event: "service.websocket.request.rejected",
          data: { errorType: error?.name || "Error", errorCode: String(error?.errorCode || error?.code || "") },
        });
        if (parsedCommand) {
          sendFailedCommandReceipt(sendEvent, parsedCommand, {
            code: String(error?.errors?.[0] || error?.errorCode || error?.code || "invalid_command").trim(),
            message: error?.message || translateText("ws.unknownError", state.currentLocale),
          });
        }
        webSocket.close(1008, "invalid request");
        return;
      }
      if (state.currentAbortSignal?.aborted || isAbortLikeError(error)) {
        if (state.currentRunTimedOut) {
          await finalizeTimeout(buildRunStateSnapshot(), {
            description: error?.message || "run timeout",
            errorObject: error,
          });
        } else if (
          isUserStopRunAbort({ stopRequested: state.stopRequested, abortSignal: state.currentAbortSignal })
        ) {
          await finalizeUserStopped(buildRunStateSnapshot());
        } else if (isSocketCloseRunAbort(state.currentAbortSignal)) {
          await commitCurrentFailure(error, state.currentLifecyclePhase || TURN_PHASE.ACTION);
          return;
        } else {
          void recordServiceWebSocketLifecycle({
            sessionLogConfig,
            event: "service.websocket.run.aborted",
            ...state.currentRunMeta,
            data: { errorType: error?.name || "Error" },
          });
          const committed = await commitCurrentFailure(error, TURN_PHASE.PROCESSING, "aborted");
          await finalizeAborted(buildRunStateSnapshot(), { error, committed });
        }
        return;
      }
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        event: "service.websocket.run.failed",
        ...state.currentRunMeta,
        data: { errorType: error?.name || "Error" },
      });
      const committed = await commitCurrentFailure(error);
      await finalizeGenericError(buildRunStateSnapshot(), { error, committed });
    } finally {
      if (runMessageStarted) {
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
    }
  };
}
