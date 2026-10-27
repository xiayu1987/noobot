/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { createAssistantMessageHelpers } from "../runtime/engine/assistantMessage.js";
import { createChatEngineConversationState } from "../runtime/engine/conversationState.js";
import { stopActiveTurn, stopExecution as requestStopExecution } from "../runtime/engine/stop.js";
import { createMonotonicMessageActions } from "../runtime/engine/monotonicMessageActions.js";
import { createChatEngineSender } from "../runtime/engine/sendFlow.js";
import { createPendingMessageOperationStore } from "../runtime/engine/messageOperationStore.js";
import {
  logStateMachineDebug,
  summarizeStateMachineEvent,
  summarizeStateMachineTurn,
} from "../../debug/loggers/stateMachineLogger.js";
import {
  projectTurnRuntimeView,
  selectSessionRuntimeBucket,
  selectTurnRuntimeByScope,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "../runtime/run-state-machine/constants.js";
import { createTerminalResolutionCoordinator } from "../runtime/terminalResolutionCoordinator.js";
import { logTerminalResolutionDebug } from "../../debug/loggers/terminalResolutionDebugLogger.js";
import { applyLatestSessionAggregateVersion } from "../runtime/engine/sessionAggregateVersionManager.js";
import { text, isObjectLike, requireFunctionDependencies } from "@noobot/shared/value";

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
  navigateToLastMessage,
  activeSession,
  activeSessionId,
  turnRuntimeRegistry,
  applyTurnRuntimeEvent,
  applyTurnLifecycleEnvelope: commitTurnLifecycleEnvelope,
  commitTurnTerminalResolution,
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  findSession,
  findUserMessageForCommit,
  findMessagesByPresentationId,
  materializeTurnPresentation,
  upsertCanonicalAssistantMessage,
  makeViewMessage,
  makeViewAttachments,
  applySessionDetail,
  deleteSessionMessagesFromApi,
  replaceSessionTurnApi,
  authFetch,
  pendingInteractionRequest,
  interactionSubmitting,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  onConversationState,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  applyWorkflowRuntimeEvent,
  reduceSubSessionMessageEvent,
  removeWorkflowOwnersForReplacedTurns,
  ensureConnected,
  notify,
  monotonicActionStopTimeoutMs,
  monotonicActionStopPollIntervalMs,
}) {
  requireFunctionDependencies("useChatEngine", {
    navigateToLastMessage,
    notify,
    onConversationState,
    applyTurnRuntimeEvent,
    logSession: sessionLogWebSocketClient.log,
  });
  const { translate, locale } = useLocale();
  const turnTerminalNavigatedKeys = new Set();
  const navigateToLastMessageOnTurnTerminalOnce = (sessionId, turnScopeId) => {
    const key = `${sessionId}::${turnScopeId}`;
    if (turnTerminalNavigatedKeys.has(key)) return;
    turnTerminalNavigatedKeys.add(key);
    navigateToLastMessage();
  };
  const applyAuthoritativeTerminalResolution = (response) => {
    const sessionId = text(response?.sessionId);
    const turnScopeId = text(response?.turnScopeId);
    const terminalStatus = response?.turn?.terminalStatus;
    if (!sessionId || !turnScopeId || !isObjectLike(terminalStatus)) {
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
      const result = commitTurnTerminalResolution(response);
      if (result.applied !== true) {
        const current = selectTurnRuntimeByScope(turnRuntimeRegistry.value, sessionId, turnScopeId);
        logTerminalResolutionDebug("frontend.terminalResolution.reducerRejected", () => ({
          sessionId,
          turnScopeId,
          reason: result.reason,
          currentRevision: Number(current?.revision || 0),
          currentSequence: Number(current?.lifecycleSeq || 0),
          terminalResolved: current?.terminalResolved === true,
          responseRevision: Number(response?.turn?.revision || response?.revision || 0),
          responseSequence: Number(response?.turn?.sequence || response?.sequence || 0),
        }));
      }
      if (result.applied) {
        const targetSession = activeSession.value;
        if (text(targetSession?.sessionId) === sessionId) {
          applyLatestSessionAggregateVersion(targetSession, response);
          navigateToLastMessageOnTurnTerminalOnce(sessionId, turnScopeId);
        }
        const projected = projectTurnRuntimeView(
          sessionId,
          selectTurnRuntimeByScope(turnRuntimeRegistry.value, sessionId, turnScopeId),
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
            selectSessionRuntimeBucket(turnRuntimeRegistry.value, sessionId)?.activeTurnScopeId ||
            "",
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
    fetcher: authFetch,
    applyTurnTerminalResolution: applyAuthoritativeTerminalResolution,
    onDiscovery: (details = {}) =>
      logTerminalResolutionDebug("frontend.terminalResolution.discovery", details),
    onUnresolved: (details = {}) =>
      logTerminalResolutionDebug("frontend.terminalResolution.unresolved", () => ({
        ...details,
        responseResolved: details?.response?.resolved === true,
        responseRetryable: details?.response?.retryable === true,
        responseReason: details?.response?.reason || "",
        responseRevision: Number(details?.response?.turn?.revision || 0),
        responseSequence: Number(details?.response?.turn?.sequence || 0),
      })),
    onTrace: (event, details = {}) => logStateMachineDebug(event, details),
  });
  const applyAuthoritativeTurnLifecycle = async (envelope) => {
    const lifecycleResult = commitTurnLifecycleEnvelope(envelope);
    await terminalResolutionCoordinator.observe({
      ...envelope,
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    });
    return lifecycleResult;
  };
  const logSessionStateEvent = (event, name, data) => {
    const sessionId = text(event?.sessionId);
    if (!sessionId) return false;
    return sessionLogWebSocketClient.log({
      scope: "session",
      category: "state",
      event: name,
      sessionId,
      dialogProcessId: text(event?.dialogProcessId),
      turnScopeId: text(event?.turnScopeId),
      data,
    });
  };
  const applyRunStateEvent = (event) => {
    const eventSummary = summarizeStateMachineEvent(event);
    const beforeTurn = eventSummary.turnScopeId
      ? selectTurnRuntimeByScope(
          turnRuntimeRegistry.value,
          eventSummary.sessionId,
          eventSummary.turnScopeId,
        )
      : null;
    const before = projectTurnRuntimeView(eventSummary.sessionId, beforeTurn);
    logStateMachineDebug("stateMachine.dispatch", () => ({
      ...eventSummary,
      before: summarizeStateMachineTurn(beforeTurn, before),
      activeSessionId: activeSessionId.value,
    }));
    const turnResult = applyTurnRuntimeEvent(event);
    const runtime = projectTurnRuntimeView(turnResult?.canonicalSessionId, turnResult?.turn);
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
    logSessionStateEvent(event, "stateMachine.event", {
      eventType: event?.type || "",
      source: event?.source || "",
      toState: runtime.displayState,
    });
    logStateMachineDebug("stateMachine.transition", () => ({
      eventType: event?.type || "",
      toState: runtime.displayState,
      sending: runtime.sending,
      canStop: runtime.canStop,
      messageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    }));
    logSessionStateEvent(event, "stateMachine.transition", {
      eventType: event?.type || "",
      toState: runtime.displayState,
      sending: runtime.sending,
      canStop: runtime.canStop,
      messageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    });
    return turnResult;
  };
  const { applyAssistantFailureState } = createAssistantMessageHelpers({
    translate,
  });

  const { applyConversationState, clearMissingInteractionPayloadTimer, disposeConversationState } =
    createChatEngineConversationState({
      activeSession,
      interactionSubmitting,
      pendingInteractionRequest,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete,
      onConversationState,
      notify,
      translate,
    });

  function stopSending() {
    return stopActiveTurn({
      activeSession,
      turnRuntimeRegistry,
      chatWebSocketClient,
      applyRunStateEvent,
    });
  }

  function stopExecution(executionId) {
    return requestStopExecution({
      executionId,
      turnRuntimeRegistry,
      chatWebSocketClient,
      applyRunStateEvent,
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
    applyAssistantFailureState,
    applySessionDetail,
    appendMessage,
    findSession,
    findUserMessageForCommit,
    findMessagesByPresentationId,
    materializeTurnPresentation,
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    makeViewAttachments,
  };
  const senderInteractionDeps = {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    clearMissingInteractionPayloadTimer,
    setPendingInteractionRequest,
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
    reduceSubSessionMessageEvent,
    applyRunStateEvent,
    applyTurnLifecycleEnvelope: applyAuthoritativeTurnLifecycle,
  };
  const senderUiDeps = {
    navigateToLastMessage,
    notify,
    translate,
  };
  const send = createChatEngineSender({
    ...senderSessionDeps,
    ...senderConversationDeps,
    ...senderInteractionDeps,
    ...senderComposerDeps,
    ...senderModelDeps,
    ...senderTransportDeps,
    ...senderUiDeps,
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
      messageOperationStore.clearSession(activeSessionId.value);
    });
  }

  return {
    send,
    stopSending,
    stopExecution,
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage,
    dispatchAuthoritativeRunStateEvent: applyRunStateEvent,
    applyTurnLifecycleEnvelope: applyAuthoritativeTurnLifecycle,
    resolveTurnTerminalState: terminalResolutionCoordinator.resolve,
  };
}
