/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose, toRaw } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { applyRunStateMessageRuntimePatch } from "./chatEngine/messageRuntimePatch";
import { createAssistantMessageHelpers } from "./chatEngine/assistantMessage";
import { createChatEngineConversationState } from "./chatEngine/conversationState";
import {
  handleStopConfirmationTimeout,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import { createMonotonicMessageActions } from "./chatEngine/monotonicMessageActions";
import { createChatEngineSender } from "./chatEngine/sendFlow";
import { createPendingMessageOperationStore } from "./chatEngine/messageOperationStore";
import { logStateMachineDebug } from "./debug/stateMachineLogger";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  applyTurnTerminalResolution,
  selectSessionTurnRuntime,
} from "./sessionRunStateMachine/turnRuntimeRegistry";
import { createTerminalResolutionCoordinator } from "./terminalResolutionCoordinator";
import { logTerminalResolutionDebug } from "./debug/terminalResolutionDebugLogger";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS =
  TIME_THRESHOLDS.client.monotonicActionStopTimeoutMs;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS =
  TIME_THRESHOLDS.client.monotonicActionStopPollIntervalMs;

function cloneTerminalDraft(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  const raw = toRaw(value);
  if (seen.has(raw)) return seen.get(raw);
  if (raw instanceof Date) return new Date(raw.getTime());
  if (raw instanceof Map) {
    const clone = new Map();
    seen.set(raw, clone);
    for (const [key, item] of raw) clone.set(cloneTerminalDraft(key, seen), cloneTerminalDraft(item, seen));
    return clone;
  }
  if (raw instanceof Set) {
    const clone = new Set();
    seen.set(raw, clone);
    for (const item of raw) clone.add(cloneTerminalDraft(item, seen));
    return clone;
  }
  const clone = Array.isArray(raw) ? [] : {};
  seen.set(raw, clone);
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor?.enumerable) continue;
    clone[key] = cloneTerminalDraft(raw[key], seen);
  }
  return clone;
}

export function useChatEngine({
  userId,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
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
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  makeViewMessage,
  foldMessagesForView,
  fetchSessionDetail,
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
  upsertWorkflowNodeStateEvent,
  upsertWorkflowPlanningEvent,
  upsertSubSessionEvent,
  applyWorkflowRuntimeEvent,
  ensureConnected,
  notify = () => {},
  processStore = null,
  runtimeEventsAlreadyProjected = false,
  terminalResolutionFetcher,
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  const applyAuthoritativeTerminalResolution = (response) => {
    const sessionId = String(response?.sessionId || "").trim();
    const turnScopeId = String(response?.turnScopeId || "").trim();
    const terminalStatus = response?.turn?.terminalStatus || response?.materialization?.terminalStatus;
    if (!sessionId || !turnScopeId || !terminalStatus || typeof terminalStatus !== "object") {
      logTerminalResolutionDebug("frontend.terminalResolution.rejected", {
        sessionId, turnScopeId, reason: "invalid_terminal_status",
        responseResolved: response?.resolved, hasTerminalStatus: Boolean(terminalStatus),
      });
      return { applied: false, reason: "invalid_terminal_status" };
    }
    try {
      const nextRegistry = cloneTerminalDraft(turnRuntimeRegistry?.value || {});
      const result = applyTurnTerminalResolution(nextRegistry, response);
      if (result?.applied !== true) {
        const current = result?.current || selectSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
        logTerminalResolutionDebug("frontend.terminalResolution.reducerRejected", {
          sessionId, turnScopeId, reason: result?.reason || "unknown",
          currentRevision: Number(current?.revision || 0), currentSequence: Number(current?.seq || 0),
          terminalResolved: current?.terminalResolved === true,
          responseRevision: Number(response?.turn?.revision || response?.revision || 0),
          responseSequence: Number(response?.turn?.sequence || response?.sequence || 0),
        });
      }
      if (result?.applied) {
        turnRuntimeRegistry.value = nextRegistry;
        const projected = selectSessionTurnRuntime(nextRegistry, sessionId, turnScopeId);
        logTerminalResolutionDebug("frontend.terminalResolution.applied", {
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
          activeTurnScopeId: nextRegistry?.sessions?.[sessionId]?.activeTurnScopeId || "",
        });
        if (!runtimeEventsAlreadyProjected) {
          applyRunStateMessageRuntimePatch({
            sessions,
            activeSession,
            turnRuntimeRegistry,
            event: {
              ...(response?.turn || {}),
              sessionId,
              turnScopeId,
            },
          });
        }
      }
      return result;
    } catch (error) {
      return { applied: false, retryable: true, reason: "terminal_materialization_apply_failed", error };
    }
  };
  const terminalResolutionCoordinator = createTerminalResolutionCoordinator({
    userId,
    fetcher: terminalResolutionFetcher || authFetch,
    applyTurnTerminalResolution: applyAuthoritativeTerminalResolution,
    onDiscovery: (details = {}) => logTerminalResolutionDebug(
      "frontend.terminalResolution.discovery", details,
    ),
    onUnresolved: (details = {}) => logTerminalResolutionDebug(
      "frontend.terminalResolution.unresolved", {
        ...details,
        responseResolved: details?.response?.resolved === true,
        responseRetryable: details?.response?.retryable === true,
        responseReason: details?.response?.reason || "",
        responseRevision: Number(details?.response?.turn?.revision || details?.response?.revision || 0),
        responseSequence: Number(details?.response?.turn?.sequence || details?.response?.sequence || 0),
      },
    ),
  });
  const applyRunStateEvent = (event) => {
    const terminalResolution = terminalResolutionCoordinator.observe(event);
    if (terminalResolution) return terminalResolution;
    const turnResult = applyTurnRuntimeEvent?.(event);
    const runtime = selectSessionTurnRuntime(
      turnRuntimeRegistry?.value,
      turnResult?.turn?.sessionId || event?.sessionId || "",
      turnResult?.turn?.turnScopeId || event?.turnScopeId || "",
    );
    logStateMachineDebug("stateMachine.event", {
      eventType: event?.type || "",
      sessionId: event?.sessionId || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      toState: runtime.displayState,
    });
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
    logStateMachineDebug("stateMachine.transition", {
      eventType: event?.type || "",
      toState: runtime.displayState,
      sending: runtime.sending,
      canStop: runtime.canStop,
      messageCount: Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages.length : 0,
    });
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
        messageCount: Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages.length : 0,
      },
    });
    if (!runtimeEventsAlreadyProjected) {
      applyRunStateMessageRuntimePatch({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        event: turnResult?.turn || event,
      });
    }
    return turnResult;
  };
  const {
    applyAssistantFailureState,
    mergeAssistantAttachments,
  } = createAssistantMessageHelpers({
    translate,
    makeViewMessage,
  });

  const {
    applyConversationState,
    applyConversationStateFromEvent,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
    findTargetAssistantMessage,
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

  function onStopConfirmationTimeout(stopScope = {}) {
    return handleStopConfirmationTimeout({
      applyRunStateEvent,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
      stopScope,
    });
  }

  function stopSending(executionId = "") {
    return requestStopSending({
      userId,
      activeSession,
      turnRuntimeRegistry,
      chatWebSocketClient,
      onStopConfirmationTimeout,
      applyRunStateEvent,
      executionId,
    });
  }

  let monotonicMessageActions;
  const messageOperationStore = createPendingMessageOperationStore();
  const send = createChatEngineSender({
    activeSession,
    activeSessionId,
    allowUserInteraction,
    applyConversationState,
    applyConversationStateFromEvent,
    applyAssistantFailureState,
    applySessionDetail,
    appendMessage,
    botScenario,
    chatWebSocketClient,
    sessionLogWebSocketClient,
    upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent,
    upsertSubSessionEvent,
    applyWorkflowRuntimeEvent,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearUploads,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    ensureConnected,
    fetchSessionDetail,
    foldMessagesForView,
    safeConfirm,
    safeConfirmLevel,
    sanitizeOutput,
    input,
    interactionSubmitting,
    isImageMime,
    locale,
    locateSendingStartedMessage,
    locateDoneMessage,
    makeViewMessage,
    mergeAssistantAttachments,
    notify,
    pendingInteractionRequest,
    pluginModelConfig,
    refreshSessionConnectorsAsync,
    navigateToLastMessage,
    selectedModel,
    selectedPlugins,
    turnRuntimeRegistry,
    applyRunStateEvent,
    serializeAttachments,
    streamOutput,
    translate,
    tryAutoResolveInteraction,
    setPendingInteractionRequest,
    uploadFiles,
    userId,
    processStore,
    finalizePendingResendOperation: (...args) => monotonicMessageActions?.finalizePendingResendOperation?.(...args),
  });


  monotonicMessageActions = createMonotonicMessageActions({
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
    fetchSessionDetail,
    applyRunStateEvent,
    turnRuntimeRegistry,
    messageOperationStore,
    monotonicActionStopTimeoutMs,
    monotonicActionStopPollIntervalMs,
    appendMessage,
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
    resolveTurnTerminalState: terminalResolutionCoordinator.resolve,
  };
}
