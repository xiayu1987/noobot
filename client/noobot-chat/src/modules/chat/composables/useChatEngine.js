/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { createAssistantMessageHelpers } from "../runtime/engine/assistantMessage.js";
import { createChatEngineConversationState } from "../runtime/engine/conversationState.js";
import { stopSending as requestStopSending } from "../runtime/engine/stop.js";
import { createMonotonicMessageActions } from "../runtime/engine/monotonicMessageActions.js";
import { createChatEngineSender } from "../runtime/engine/sendFlow.js";
import { createPendingMessageOperationStore } from "../runtime/engine/messageOperationStore.js";
import {
  logStateMachineDebug,
  summarizeStateMachineEvent,
  summarizeStateMachineTurn,
} from "../../debug/loggers/stateMachineLogger.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTerminalResolutionCoordinator } from "../runtime/terminalResolutionCoordinator.js";
import { logTerminalResolutionDebug } from "../../debug/loggers/terminalResolutionDebugLogger.js";
import { applyLatestSessionAggregateVersion } from "../runtime/engine/sessionAggregateVersionManager.js";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS =
  TIME_THRESHOLDS.client.monotonicActionStopTimeoutMs;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS =
  TIME_THRESHOLDS.client.monotonicActionStopPollIntervalMs;

export function useChatEngine({
  userId,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  streamOutput,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  frontendThresholdsEnabled,
  summaryPolicy,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  navigateToLastMessage,
  locateSendingStartedMessage,
  locateDoneMessage,
  activeSession,
  activeSessionId,
  sessions,
  turnRuntimeRegistry,
  applyTurnRuntimeEvent,
  applyTurnLifecycleEnvelope,
  commitTurnTerminalResolution,
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  findCanonicalMessageById,
  findCanonicalMessagesById,
  upsertCanonicalAssistantMessage,
  makeViewMessage,
  foldMessagesForView,
  applySessionDetail,
  refreshSessionConnectorsAsync,
  deleteSessionMessagesFromApi,
  replaceSessionTurnApi,
  authFetch,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  pendingInteractionRequest,
  interactionSubmitting,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  refreshSessionsAsync,
  onConversationState,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  applyWorkflowRuntimeEvent,
  removeWorkflowOwnersForReplacedTurns,
  ensureConnected,
  notify = () => {},
  processStore = null,
  terminalResolutionFetcher,
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  const applyAuthoritativeTerminalResolution = (response) => {
    const sessionId = String(response?.sessionId || "").trim();
    const turnScopeId = String(response?.turnScopeId || "").trim();
    const terminalStatus =
      response?.turn?.terminalStatus || response?.materialization?.terminalStatus;
    if (!sessionId || !turnScopeId || !terminalStatus || typeof terminalStatus !== "object") {
      logTerminalResolutionDebug("frontend.terminalResolution.rejected", () => ({
        sessionId,
        turnScopeId,
        reason: "invalid_terminal_status",
        responseResolved: response?.resolved,
        hasTerminalStatus: Boolean(terminalStatus),
      }));
      return { applied: false, reason: "invalid_terminal_status" };
    }
    try {
      const result = commitTurnTerminalResolution?.(response) || {
        applied: false,
        reason: "terminal_resolution_commit_unavailable",
      };
      if (result?.applied !== true) {
        const current =
          result?.current ||
          selectSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
        logTerminalResolutionDebug("frontend.terminalResolution.reducerRejected", () => ({
          sessionId,
          turnScopeId,
          reason: result?.reason || "unknown",
          currentRevision: Number(current?.revision || 0),
          currentSequence: Number(current?.seq || 0),
          terminalResolved: current?.terminalResolved === true,
          responseRevision: Number(response?.turn?.revision || response?.revision || 0),
          responseSequence: Number(response?.turn?.sequence || response?.sequence || 0),
        }));
      }
      if (result?.applied) {
        const targetSession = activeSession?.value;
        if (String(targetSession?.sessionId || "").trim() === sessionId) {
          applyLatestSessionAggregateVersion(targetSession, response);
        }
        const projected = selectSessionTurnRuntime(
          turnRuntimeRegistry?.value,
          sessionId,
          turnScopeId,
        );
        logTerminalResolutionDebug("frontend.terminalResolution.applied", () => ({
          sessionId,
          turnScopeId,
          responseState: response?.turn?.state || "",
          responseExecutionState: response?.turn?.executionState || "",
          responseRevision: Number(response?.turn?.revision || response?.revision || 0),
          responseSequence: Number(response?.turn?.sequence || response?.sequence || 0),
          startedAt: response?.turn?.startedAt || "",
          finishedAt: response?.turn?.finishedAt || "",
          projectedState: projected?.displayState || projected?.state || "",
          projectedSending: projected?.sending === true,
          projectedTerminal: projected?.terminal || null,
          activeTurnScopeId:
            turnRuntimeRegistry?.value?.sessions?.[sessionId]?.activeTurnScopeId || "",
        }));
      }
      return result;
    } catch (error) {
      return {
        applied: false,
        retryable: true,
        reason: "terminal_materialization_apply_failed",
        error,
      };
    }
  };
  const terminalResolutionCoordinator = createTerminalResolutionCoordinator({
    userId,
    fetcher: terminalResolutionFetcher || authFetch,
    applyTurnTerminalResolution: applyAuthoritativeTerminalResolution,
    onDiscovery: (details = {}) =>
      logTerminalResolutionDebug("frontend.terminalResolution.discovery", details),
    onUnresolved: (details = {}) =>
      logTerminalResolutionDebug("frontend.terminalResolution.unresolved", () => ({
        ...details,
        responseResolved: details?.response?.resolved === true,
        responseRetryable: details?.response?.retryable === true,
        responseReason: details?.response?.reason || "",
        responseRevision: Number(
          details?.response?.turn?.revision || details?.response?.revision || 0,
        ),
        responseSequence: Number(
          details?.response?.turn?.sequence || details?.response?.sequence || 0,
        ),
      })),
    onTrace: (event, details = {}) => logStateMachineDebug(event, details),
  });
  const applyRunStateEvent = (event) => {
    const eventSummary = summarizeStateMachineEvent(event);
    const before = selectSessionTurnRuntime(
      turnRuntimeRegistry?.value,
      eventSummary.sessionId,
      eventSummary.turnScopeId,
    );
    const beforeTurn = resolveSessionTurnRuntime(
      turnRuntimeRegistry?.value,
      eventSummary.sessionId,
      eventSummary.turnScopeId,
    );
    logStateMachineDebug("stateMachine.dispatch", () => ({
      ...eventSummary,
      before: summarizeStateMachineTurn(beforeTurn, before),
      activeSessionId: activeSessionId?.value || "",
    }));
    const terminalResolution = terminalResolutionCoordinator.observe(event);
    if (terminalResolution) {
      logStateMachineDebug("stateMachine.reducer.skipped", () => ({
        ...eventSummary,
        reason: "terminal_resolution_owned",
        before: summarizeStateMachineTurn(beforeTurn, before),
      }));
      logStateMachineDebug("stateMachine.terminal.scheduled", () => ({
        ...eventSummary,
        before: summarizeStateMachineTurn(beforeTurn, before),
      }));
      return terminalResolution;
    }
    const turnResult = applyTurnRuntimeEvent?.(event);
    const runtime = selectSessionTurnRuntime(
      turnRuntimeRegistry?.value,
      turnResult?.turn?.sessionId || event?.sessionId || "",
      turnResult?.turn?.turnScopeId || event?.turnScopeId || "",
    );
    logStateMachineDebug("stateMachine.reducer.decision", () => ({
      ...eventSummary,
      applied: turnResult?.applied === true,
      reason: turnResult?.reason || "",
      requestedSessionId: turnResult?.requestedSessionId || "",
      canonicalSessionId: turnResult?.canonicalSessionId || "",
      identityMatched: !String(turnResult?.reason || "").includes("identity_conflict"),
      stateChanged:
        String(before?.displayState || before?.state || "") !==
        String(runtime?.displayState || runtime?.state || ""),
      before: summarizeStateMachineTurn(beforeTurn, before),
      after: summarizeStateMachineTurn(turnResult?.turn, runtime),
    }));
    sessionLogWebSocketClient?.log?.({
      category: "state",
      event: "stateMachine.event",
      sessionId: event?.sessionId || activeSessionId?.value || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      data: {
        eventType: event?.type || "",
        source: event?.source || "",
        toState: runtime.displayState,
      },
    });
    logStateMachineDebug("stateMachine.transition", () => ({
      eventType: event?.type || "",
      toState: runtime.displayState,
      sending: runtime.sending,
      canStop: runtime.canStop,
      messageCount: Array.isArray(activeSession?.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    }));
    sessionLogWebSocketClient?.log?.({
      category: "state",
      event: "stateMachine.transition",
      sessionId: event?.sessionId || activeSessionId?.value || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      data: {
        eventType: event?.type || "",
        toState: runtime.displayState,
        sending: runtime.sending,
        canStop: runtime.canStop,
        messageCount: Array.isArray(activeSession?.value?.messages)
          ? activeSession.value.messages.length
          : 0,
      },
    });
    return turnResult;
  };
  const { applyAssistantFailureState, mergeAssistantAttachments } = createAssistantMessageHelpers({
    translate,
    makeViewMessage,
  });

  const {
    applyConversationState,
    applyConversationStateFromEvent,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
    tryAutoResolveInteraction,
  } = createChatEngineConversationState({
    activeSession,
    activeSessionId,
    applyRunStateEvent,
    interactionSubmitting,
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    refreshSessionsAsync,
    onConversationState,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    notify,
    translate,
    applyAssistantFailureState,
  });

  function stopSending(executionId = "") {
    return requestStopSending({
      userId,
      activeSession,
      turnRuntimeRegistry,
      chatWebSocketClient,
      applyRunStateEvent,
      executionId,
    });
  }

  const messageOperationStore = createPendingMessageOperationStore();
  const senderSessionDeps = {
    activeSession,
    activeSessionId,
    userId,
    turnRuntimeRegistry,
    ensureConnected,
  };
  const senderConversationDeps = {
    applyConversationState,
    applyConversationStateFromEvent,
    applyAssistantFailureState,
    applySessionDetail,
    appendMessage,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    upsertCanonicalAssistantMessage,
    foldMessagesForView,
    makeViewMessage,
    mergeAssistantAttachments,
  };
  const senderInteractionDeps = {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    clearMissingInteractionPayloadTimer,
    setPendingInteractionRequest,
    tryAutoResolveInteraction,
  };
  const senderComposerDeps = {
    allowUserInteraction,
    safeConfirm,
    safeConfirmLevel,
    sanitizeOutput,
    streamOutput,
    input,
    uploadFiles,
    clearUploads,
    serializeAttachments,
    isImageMime,
  };
  const senderModelDeps = {
    botScenario,
    selectedModel,
    memoryModel,
    pluginModelConfig,
    frontendThresholdsEnabled,
    summaryPolicy,
    selectedPlugins,
    locale,
  };
  const senderTransportDeps = {
    chatWebSocketClient,
    sessionLogWebSocketClient,
    applyWorkflowRuntimeEvent,
    applyRunStateEvent,
    applyTurnLifecycleEnvelope,
    classifyRealtimeLog,
  };
  const senderUiDeps = {
    locateSendingStartedMessage,
    locateDoneMessage,
    navigateToLastMessage,
    notify,
    translate,
  };
  const senderConnectorDeps = {
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    processStore,
  };
  const send = createChatEngineSender({
    ...senderSessionDeps,
    ...senderConversationDeps,
    ...senderInteractionDeps,
    ...senderComposerDeps,
    ...senderModelDeps,
    ...senderTransportDeps,
    ...senderUiDeps,
    ...senderConnectorDeps,
    finalizePendingResendOperation: (...args) =>
      monotonicMessageActions?.finalizePendingResendOperation?.(...args),
  });

  const monotonicMessageActions = createMonotonicMessageActions({
    activeSession,
    activeSessionId,
    authFetch,
    chatWebSocketClient,
    clearPendingInteraction,
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi,
    input,
    notify,
    send,
    stopSending,
    translate,
    userId,
    applySessionDetail,
    applyRunStateEvent,
    turnRuntimeRegistry,
    messageOperationStore,
    monotonicActionStopTimeoutMs,
    monotonicActionStopPollIntervalMs,
    appendMessage,
    removeWorkflowOwnersForReplacedTurns,
    invalidateTerminalResolution: (sessionId, turnScopeId) =>
      terminalResolutionCoordinator.invalidate(sessionId, turnScopeId),
  });
  const {
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage,
  } = monotonicMessageActions;

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposeConversationState();
      terminalResolutionCoordinator.dispose();
      messageOperationStore.clearSession(activeSessionId?.value);
    });
  }

  return {
    send,
    stopSending,
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage,
    dispatchAuthoritativeRunStateEvent: applyRunStateEvent,
    applyTurnLifecycleEnvelope,
    resolveTurnTerminalState: terminalResolutionCoordinator.resolve,
  };
}
