/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
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
import { isTurnLifecycleRejectedError } from "@noobot/session-protocol";
import { isWorkspaceMaintenanceError } from "@noobot/workspace-protocol";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  EXECUTION_QUERY_COMMAND_TYPES,
  RUN_COMMAND_TYPES,
  isAgentTransportProtocolError,
  parseAgentCommand,
} from "@noobot/agent-transport-protocol";
import { createMessageQueryHandlers } from "./message-query-handlers.js";
import { createMessageStopHandler } from "./message-stop-handler.js";
import { createMessageRunHandler, createRunBusyError } from "./message-run-handler.js";
import { sendCommandReceipt, sendFailedCommandReceipt } from "./command-receipt.js";
import { text } from "@noobot/shared/value";

export function createMessageHandler({
  state,
  authInfo,
  webSocket,
  sendEvent,
  translateText,
  mapAgentRunCommand,
  connectorAccessPort,
  runNewOperation,
  resolveBot,
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
  turnRecovery,
  persistenceScope,
}) {
  if (typeof runNewOperation !== "function")
    throw new TypeError("Chat requires operation admission");
  const canonicalRunOwnerId = text(authInfo?.userId);

  const { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize } =
    createMessageQueryHandlers({
      state,
      sendEvent,
      translateText,
      resolveBot,
      canonicalRunOwnerId,
      turnRecovery,
    });
  const handleStop = createMessageStopHandler({
    state,
    canonicalRunOwnerId,
    sendEvent,
    translateText,
    rejectTurnInteractions,
    commitTurnLifecycle,
  });
  const { handleRun, rebindRun, commitCurrentFailure } = createMessageRunHandler({
    state,
    authInfo,
    sendEvent,
    translateText,
    mapAgentRunCommand,
    connectorAccessPort,
    resolveBot,
    userInteractionBridge,
    buildRunStateSnapshot,
    finalizeTimeout,
    finalizeUserStopped,
    finalizeCompleted,
    commitTurnLifecycle,
    dispatchAuthorityEvents,
    persistenceScope,
  });

  const context = {
    state,
    webSocket,
    sendEvent,
    translateText,
    canonicalRunOwnerId,
    buildRunStateSnapshot,
    finalizeTimeout,
    finalizeUserStopped,
    finalizeAborted,
    finalizeGenericError,
    commitUserInterjection,
    dispatchAuthorityEvents,
    persistenceScope,
    commitCurrentFailure,
    routes: {
      handleExecutionQuery,
      handleSnapshotGet,
      handleFinalize,
      handleStop,
    },
  };

  async function startRun(command, continueOperation) {
    let boundRunHandle = null;
    try {
      await handleRun(command, (handle) => {
        boundRunHandle = handle;
        runOperations.set(handle, {
          runNewOperation,
          continueOperation: AsyncLocalStorage.bind(continueOperation),
        });
      });
    } catch (error) {
      if (!boundRunHandle || !state.currentRunMeta) throw error;
      await settleFailedRun(context, error);
    } finally {
      if (boundRunHandle) releaseRun(context, boundRunHandle);
    }
  }

  async function dispatch(command) {
    const { commandType, identity } = command;
    if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
      handleInteractionResponse(command);
      return;
    }
    const activeRun = findCommandRun(canonicalRunOwnerId, commandType, identity);
    const owner = runOperations.get(activeRun);
    const continuation =
      owner?.runNewOperation === runNewOperation ? owner.continueOperation : null;
    if (!RUN_COMMAND_TYPES.includes(commandType)) {
      await (continuation ?? runNewOperation)(() => routeNonRunCommand(context, command));
    } else if (state.isRunning) {
      throw createRunBusyError();
    } else if (continuation && !activeRun.abortController.signal.aborted) {
      await continuation(async () => {
        await rebindRun(activeRun);
        sendCommandReceipt(sendEvent, command, AGENT_COMMAND_RECEIPT_OUTCOME.REBOUND);
      });
    } else {
      await runNewOperation((continueOperation) =>
        resolveBot().runWorkspaceOperation(canonicalRunOwnerId, () =>
          startRun(command, continueOperation),
        ),
      );
    }
  }

  return async function onMessage(rawMessage) {
    let parsedCommand = null;
    try {
      const command = parseAgentCommand(rawMessage);
      parsedCommand = command;
      void recordServiceAgentTransportDebug({
        event: "service.agentTransport.commandReceived",
        command,
        userId: canonicalRunOwnerId,
        data: { accepted: true, transport: "websocket" },
      });
      await dispatch(command);
    } catch (error) {
      rejectCommand(context, error, parsedCommand, rawMessage);
    }
  };
}

const INTERJECT_IDENTITY_FIELDS = ["sessionId", "dialogProcessId", "turnScopeId"];
const runOperations = new WeakMap();

function findCommandRun(userId, commandType, { sessionId, turnScopeId, dialogProcessId }) {
  if (
    !RUN_COMMAND_TYPES.includes(commandType) &&
    commandType !== AGENT_COMMAND.STOP &&
    commandType !== AGENT_COMMAND.INTERJECT
  )
    return null;
  if (!userId || !sessionId || !turnScopeId) return null;
  const run = findActiveRun({ userId, sessionId, turnScopeId });
  return run && (!dialogProcessId || run.dialogProcessId === dialogProcessId) ? run : null;
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
  } else if (commandType === AGENT_COMMAND.INTERJECT) {
    await handleInterject(context, command);
  } else if (commandType === AGENT_COMMAND.STOP) {
    await routes.handleStop(command);
  } else {
    throw new Error(`Unsupported chat command: ${commandType}`);
  }
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
    (field) => text(activeRun[field]) === text(command.identity[field]),
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

async function dispatchInterjectionAuthority(
  { dispatchAuthorityEvents, persistenceScope },
  activeRun,
) {
  try {
    return await dispatchAuthorityEvents(
      {
        userId: activeRun.userId,
        sessionId: activeRun.sessionId,
        persistenceScope,
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
      event: "service.userInterjection.authorityDispatchDeferred",
      userId: activeRun.userId,
      sessionId: activeRun.sessionId,
      dialogProcessId: activeRun.dialogProcessId,
      turnScopeId: activeRun.turnScopeId,
      data: { reason: dispatch?.reason || "authority_dispatch_unavailable" },
    });
  }
  sendCommandReceipt(context.sendEvent, command, AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED);
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

const COMMAND_DISPATCH_FAILED = "command_dispatch_failed";

function resolveRejectedCommand({ state, translateText }, error, parsedCommand) {
  if (parsedCommand && error?.code === "session_already_running") {
    return {
      command: parsedCommand,
      error: {
        code: error.code,
        message: translateText("ws.sessionAlreadyRunning", state.currentLocale),
      },
    };
  }
  if (
    parsedCommand &&
    (isTurnLifecycleRejectedError(error) ||
      isWorkspaceMaintenanceError(error) ||
      error?.code === "RUNTIME_CLOSED")
  ) {
    return {
      command: parsedCommand,
      error: {
        code: error.code,
        message: translateText("ws.commandRejected", state.currentLocale),
        ...(Object.hasOwn(error, "currentVersion") ? { currentVersion: error.currentVersion } : {}),
      },
    };
  }
  if (parsedCommand) {
    return {
      command: parsedCommand,
      error: {
        code: COMMAND_DISPATCH_FAILED,
        message: translateText("ws.commandDispatchFailed", state.currentLocale),
      },
    };
  }
  if (isAgentTransportProtocolError(error) && error.command) {
    return { command: error.command, error: { code: error.errors[0], message: error.message } };
  }
  return null;
}

function rejectCommand(context, error, parsedCommand, rawMessage) {
  const rejected = resolveRejectedCommand(context, error, parsedCommand);
  void recordServiceAgentTransportDebug({
    event: parsedCommand
      ? "service.agentTransport.commandDispatchFailed"
      : "service.agentTransport.commandRejected",
    command: rejected ? rejected.command : rawMessage,
    userId: context.canonicalRunOwnerId,
    data: buildRejectionDebugData(error, parsedCommand),
  });
  void recordServiceWebSocketLifecycle({
    event: "service.websocket.request.rejected",
    data: {
      errorType: error?.name || "Error",
      errorCode: String(error?.code || ""),
    },
  });
  if (rejected) {
    sendFailedCommandReceipt(context.sendEvent, rejected.command, rejected.error);
    return;
  }
  context.webSocket.close(1008, "invalid request");
}

async function settleAbortedRun(context, error) {
  const { state, buildRunStateSnapshot } = context;
  if (state.currentRunTimedOut) {
    await context.finalizeTimeout(buildRunStateSnapshot());
  } else if (isUserStopRunAbort(state.currentAbortSignal)) {
    await context.finalizeUserStopped(buildRunStateSnapshot());
  } else if (isSocketCloseRunAbort(state.currentAbortSignal)) {
    await context.commitCurrentFailure(error);
  } else {
    void recordServiceWebSocketLifecycle({
      event: "service.websocket.run.aborted",
      ...state.currentRunMeta,
      data: { errorType: error?.name || "Error" },
    });
    const committed = await context.commitCurrentFailure(error, "aborted");
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
    event: "service.websocket.run.failed",
    ...state.currentRunMeta,
    data: { errorType: error?.name || "Error" },
  });
  const committed = await context.commitCurrentFailure(error);
  await context.finalizeGenericError(context.buildRunStateSnapshot(), { error, committed });
}

function releaseRun({ state }, boundRunHandle) {
  if (boundRunHandle) {
    runOperations.delete(boundRunHandle);
    unregisterActiveRun(boundRunHandle);
  }
  if (!boundRunHandle || state.currentRunHandle === boundRunHandle) {
    resetRunState(state);
  }
  void recordServiceWebSocketLifecycle({
    event: "service.websocket.run.stateReset",
    data: { completed: true },
  });
}
