/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  recordServiceWebSocketLifecycle,
  recordServiceWebSocketRuntimeError,
} from "./runtime-events.js";
import { createConnectionState } from "./connection-state.js";
import { createOutboundEventSender } from "./outbound-event-sender.js";
import { createAuthorityEventDispatcher } from "./authority-event-dispatcher.js";
import { createInteractionAuthorityBridge } from "./interaction-authority-bridge.js";
import { createUserInterjectionAuthorityBridge } from "./user-interjection-authority-bridge.js";
import { createTurnLifecycleBridge } from "./turn-lifecycle-bridge.js";
import { finalizeTurnSnapshot, readAnnotatedTurnSnapshot } from "./turn-recovery.js";
import { createTurnFinalizer, snapshotRunState } from "./terminal-outcomes.js";
import { createUserInteractionBridge } from "./user-interaction-bridge.js";
import { createMessageHandler } from "./message-handler.js";
import {
  createExecutionLivenessInspector,
  detachRunTransport,
  isRunTransportAttached,
} from "./run-registry.js";
import { EXECUTION_ABORT_TYPE, createExecutionAbortReason } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

const CHAT_CONNECTION_PERSISTENCE_SCOPE = null;

export const CONNECTION_CLOSE_POLICY = Object.freeze({
  DETACH_RUN: "detach_run",
  ABORT_RUN: "abort_run",
});

const CONNECTION_CLOSE_POLICIES = new Set(Object.values(CONNECTION_CLOSE_POLICY));

function createConnectionLogger(state) {
  return (event, data = {}, routing = {}) => {
    const meta = state.currentRunMeta || {};
    void recordServiceWebSocketLifecycle({
      event,
      ...routing,
      userId: meta.userId,
      sessionId: meta.sessionId,
      dialogProcessId: meta.dialogProcessId,
      turnScopeId: meta.turnScopeId,
      data,
    });
  };
}

function registerConnectionDiagnostics(webSocket, authInfo, logConnection) {
  logConnection("service.websocket.connection.opened", { authenticated: Boolean(authInfo) });
  webSocket.once("close", (code, reason) =>
    logConnection("service.websocket.connection.closed", {
      code,
      reasonLength: text(reason).length,
    }),
  );
  webSocket.once("error", (error) =>
    logConnection("service.websocket.connection.error", {
      error: error?.message || String(error || ""),
    }),
  );
}

function createTurnStatusRejection({ webSocket }) {
  return ({ runMeta, status, result = null }) => {
    const errorCode = "turn_status_persistence_failed";
    const errorMessage = `failed to persist terminal turn status: ${text(status)}`;
    void recordServiceWebSocketRuntimeError({
      event: "service.websocket.turnStatusPersistenceFailed",
      error: new Error(errorMessage),
      userId: runMeta.userId,
      sessionId: runMeta.sessionId,
      dialogProcessId: runMeta.dialogProcessId,
      turnScopeId: runMeta.turnScopeId,
      data: {
        errorCode,
        status,
        reason: text(result?.reason),
        currentRevision: result?.currentRevision ?? null,
      },
    });
    webSocket.close(1011, errorCode);
  };
}

function createTurnRecovery({ resolveBot, commitTurnLifecycle, authInfo, persistenceScope }) {
  const inspectorFor = (request) =>
    createExecutionLivenessInspector({
      userId: text(authInfo?.userId),
      sessionId: request.sessionId,
    });
  return {
    readSnapshot: (request) =>
      readAnnotatedTurnSnapshot({
        ...request,
        persistenceScope,
        bot: resolveBot(),
        inspectExecution: inspectorFor(request),
      }),
    finalize: (request) =>
      finalizeTurnSnapshot({
        ...request,
        persistenceScope,
        bot: resolveBot(),
        commitTurnLifecycle,
        inspectExecution: inspectorFor(request),
      }),
  };
}

function createRunStateSnapshot(state) {
  return () =>
    snapshotRunState({
      runMeta: state.currentRunMeta,
      abortSignal: state.currentAbortSignal,
      locale: state.currentLocale,
    });
}

function registerMessageListener({ webSocket, messageHandler, logConnection }) {
  webSocket.on("message", (rawMessage) => {
    void messageHandler(rawMessage).catch((error) => {
      void recordServiceWebSocketLifecycle({
        event: "service.websocket.message.unhandledFailure",
        data: { errorType: error?.name || "Error", errorCode: text(error?.code) },
      });
      try {
        webSocket.close(1011, "message handler failed");
      } catch (closeError) {
        logConnection("service.websocket.connection.closeFailed", {
          errorType: closeError?.name || "Error",
          errorCode: text(closeError?.code),
        });
      }
    });
  });
}

function decodeCloseReason(reason) {
  if (typeof reason === "string") return reason;
  return Buffer.isBuffer(reason) ? reason.toString("utf8") : "";
}

function registerCloseListener({
  webSocket,
  state,
  closePolicy,
  rejectTurnInteractions,
  translateText,
}) {
  webSocket.on("close", (code, reasonBuffer) => {
    const transportStillOwned =
      !state.currentRunHandle ||
      isRunTransportAttached(state.currentRunHandle, state.currentRunTransportBinding);
    const abortRun = closePolicy === CONNECTION_CLOSE_POLICY.ABORT_RUN;
    if (abortRun && state.currentAbortController && transportStillOwned) {
      const reasonText = decodeCloseReason(reasonBuffer);
      state.currentAbortController.abort(
        createExecutionAbortReason({
          type: EXECUTION_ABORT_TYPE.SOCKET_CLOSE,
          code: Number(code || 0) || undefined,
          reason: reasonText || "websocket closed",
        }),
      );
    }
    if (transportStillOwned && state.currentRunHandle) {
      detachRunTransport(state.currentRunHandle, state.currentRunTransportBinding);
    }
    if (abortRun && state.currentRunTimeoutTimer) {
      clearTimeout(state.currentRunTimeoutTimer);
      state.currentRunTimeoutTimer = null;
    }
    if (abortRun && state.currentRunMeta) {
      rejectTurnInteractions(
        state.currentRunMeta,
        new Error(translateText("ws.socketClosed", state.currentLocale)),
      );
    }
  });
}

function createConnectionMessageRuntime(context) {
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: context.resolveBot,
    sendEvent: context.sendEvent,
    consumerId: context.consumerId,
  });
  const commitInteractionRequest = createInteractionAuthorityBridge({
    resolveBot: context.resolveBot,
    dispatchAuthorityEvents,
  });
  const commitTurnLifecycle = createTurnLifecycleBridge({
    resolveBot: context.resolveBot,
    dispatchAuthorityEvents,
    persistenceScope: CHAT_CONNECTION_PERSISTENCE_SCOPE,
  });
  const commitUserInterjection = createUserInterjectionAuthorityBridge({
    resolveBot: context.resolveBot,
    persistenceScope: CHAT_CONNECTION_PERSISTENCE_SCOPE,
  });
  const finalizers = createTurnFinalizer({
    sendEvent: context.sendEvent,
    commitInteractionRequest,
    rejectUnpersistedTurnStatus: createTurnStatusRejection(context),
    resolveBot: context.resolveBot,
    translateText: context.translateText,
    webSocket: context.webSocket,
    commitTurnLifecycle,
  });
  const interaction = createUserInteractionBridge({
    ownerUserId: context.authInfo?.userId,
    commitInteractionRequest,
    translateText: context.translateText,
    getCurrentLocale: () => context.state.currentLocale,
  });
  return {
    commitTurnLifecycle,
    commitUserInterjection,
    dispatchAuthorityEvents,
    ...finalizers,
    ...interaction,
    turnRecovery: createTurnRecovery({
      resolveBot: context.resolveBot,
      commitTurnLifecycle,
      authInfo: context.authInfo,
      persistenceScope: CHAT_CONNECTION_PERSISTENCE_SCOPE,
    }),
  };
}

function createConnectionMessageHandler(context, runtime) {
  return createMessageHandler({
    state: context.state,
    authInfo: context.authInfo,
    webSocket: context.webSocket,
    sendEvent: context.sendEvent,
    translateText: context.translateText,
    mapAgentRunCommand: context.mapAgentRunCommand,
    connectorAccessPort: context.connectorAccessPort,
    resolveBot: context.resolveBot,
    rejectTurnInteractions: runtime.rejectTurnInteractions,
    userInteractionBridge: runtime.userInteractionBridge,
    buildRunStateSnapshot: createRunStateSnapshot(context.state),
    finalizeTimeout: runtime.finalizeTimeout,
    finalizeUserStopped: runtime.finalizeUserStopped,
    finalizeCompleted: runtime.finalizeCompleted,
    finalizeAborted: runtime.finalizeAborted,
    finalizeGenericError: runtime.finalizeGenericError,
    commitTurnLifecycle: runtime.commitTurnLifecycle,
    commitUserInterjection: runtime.commitUserInterjection,
    dispatchAuthorityEvents: runtime.dispatchAuthorityEvents,
    turnRecovery: runtime.turnRecovery,
    persistenceScope: CHAT_CONNECTION_PERSISTENCE_SCOPE,
  });
}

export function createChatConnectionHandler(options) {
  if (!CONNECTION_CLOSE_POLICIES.has(options?.closePolicy)) {
    throw new Error("createChatConnectionHandler requires an explicit closePolicy");
  }
  return (webSocket, request) => {
    const authInfo = request?.auth || null;
    const state = createConnectionState({
      locale: options.normalizeLocale(request?.locale, options.defaultLocale),
    });
    const logConnection = createConnectionLogger(state);
    registerConnectionDiagnostics(webSocket, authInfo, logConnection);
    const context = {
      ...options,
      webSocket,
      authInfo,
      state,
      logConnection,
    };
    context.sendEvent = createOutboundEventSender(context);
    const runtime = createConnectionMessageRuntime(context);
    const messageHandler = createConnectionMessageHandler(context, runtime);
    registerMessageListener({
      webSocket,
      messageHandler,
      logConnection,
    });
    registerCloseListener({
      webSocket,
      state,
      closePolicy: options.closePolicy,
      rejectTurnInteractions: runtime.rejectTurnInteractions,
      translateText: options.translateText,
    });
  };
}
