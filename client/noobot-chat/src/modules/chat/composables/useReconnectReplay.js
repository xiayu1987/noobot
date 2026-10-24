/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
} from "../runtime/interactionPayload.js";
import { tryAutoResolveReconnectInteraction } from "../runtime/reconnect/interactionHandlers.js";
import { applyReconnectDataReplay } from "../runtime/reconnect/reconnectDataReplay.js";
import { applyReconnectEventReplay } from "../runtime/reconnect/reconnectEventReplay.js";

import { createReconnectReplayContext } from "../runtime/reconnect/context.js";
import {
  ensureReconnectSessionActive as ensureReconnectSessionActiveWithContext,
  isCurrentActiveSession as isCurrentActiveSessionWithContext,
} from "../runtime/reconnect/sessionActivation.js";
import { consumeReconnectReplayCacheForSession } from "../runtime/reconnect/replayCacheConsumer.js";
import { applyReconnectReplayBatchToActiveSession } from "../runtime/reconnect/batchReplay.js";
import { createReconnectReplayPublicApi } from "../runtime/reconnect/publicApi.js";
import { isTurnRuntimeDeleted } from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../debug/loggers/stateMachineLogger.js";
import { renderActiveSessionBeforeReplay } from "../runtime/reconnect/hydrationReplay.js";
import { applyReconnectInteractionRequest } from "../runtime/reconnect/interactionReplay.js";
import { handleAttachmentLifecycleStreamEvent } from "../runtime/engine/streamHandlers.js";
import { routeRuntimeStreamEvent } from "../../../extensions/runtime-stream-router.js";
import { text, isFunction } from "@noobot/shared/value";

export function useReconnectReplay({
  sessions,
  activeSession,
  interactionSubmitting,
  chatList,
  findMessageByViewKey,
  findMessagesByPresentationId,
  materializeTurnPresentation,
  makeViewAttachments,
  clearPendingInteraction,
  setPendingInteractionRequest,
  isInteractionRequestHandled,
  sessionLogWebSocketClient,
  turnRuntimeRegistry,
  applyTurnLifecycleEnvelope,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent,
  reduceSubSessionMessageEvent,
  applyTurnLifecycleSnapshot,
}) {
  const reconnectReplayContext = createReconnectReplayContext();
  const { replayCache } = reconnectReplayContext;
  let { replayHydrationPromise } = reconnectReplayContext;

  const isDeletedTurn = ({ sessionId = "", turnScopeId = "" } = {}) =>
    isTurnRuntimeDeleted(turnRuntimeRegistry?.value || turnRuntimeRegistry, {
      sessionId,
      turnScopeId,
    });

  function tryAutoResolveInteraction(rawRequest = {}) {
    return tryAutoResolveReconnectInteraction({
      rawRequest,
      interactionSubmitting,
      normalizeInteractionRequestPayload,
      isAutoResolvedInteraction,
      clearPendingInteraction,
    });
  }

  function isCurrentActiveSession(sessionId) {
    return isCurrentActiveSessionWithContext(activeSession.value, sessionId);
  }

  async function ensureReconnectSessionActive(sessionId) {
    return ensureReconnectSessionActiveWithContext({
      sessionId,
      sessions,
      activeSession,
      chatList,
    });
  }

  async function applySubSessionReplayMessages(messages, context) {
    let appliedCount = 0;
    for (const messageEvent of messages) {
      if (reduceSubSessionMessageEvent(messageEvent).applied === true) appliedCount += 1;
    }
    sessionLogWebSocketClient.log({
      scope: "session",
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.subSessionReplayRouted",
      sessionId: context.rootSessionId,
      dialogProcessId: context.dialogProcessId,
      turnScopeId: context.turnScopeId,
      data: {
        replayEnvelopeCount: messages.length,
        appliedCount,
        rootMessageProjectionSkipped: true,
      },
    });
    return { applied: appliedCount > 0, appliedCount };
  }

  async function applyReconnectData(reconnectData) {
    return applyReconnectDataReplay({
      reconnectData,
      ensureReconnectSessionActive,
      isCurrentActiveSession,
      reconcileSessionState,
      hydrateActiveSessionBeforeReplay,
      applyTurnLifecycleEnvelope,
      applyTurnLifecycleSnapshot,
      applyPendingInteraction: (interaction, { channelSessionId } = {}) =>
        applyReconnectInteractionRequest({
          eventData: interaction,
          channelSessionId,
          normalizeInteractionRequestPayload,
          tryAutoResolveInteraction,
          isInteractionRequestHandled,
          setPendingInteractionRequest,
          clearPendingInteraction,
        }),
    });
  }

  async function hydrateActiveSessionBeforeReplay(sessionId = "", activeTurnSnapshot = null) {
    const requestedSessionId = text(sessionId);
    if (!requestedSessionId || !isCurrentActiveSession(requestedSessionId)) return false;
    const presentationMessageId = text(activeTurnSnapshot?.presentationMessageId);
    logStateMachineDebug("stateMachine.reconnect.presentationHydration.before", () => ({
      sessionId: requestedSessionId,
      dialogProcessId: text(activeTurnSnapshot?.dialogProcessId),
      turnScopeId: text(activeTurnSnapshot?.turnScopeId),
      presentationMessageId,
      messages: (Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages
        : []
      ).map(summarizeStateMachineMessage),
    }));
    const hydrated = await renderActiveSessionBeforeReplay({
      activeSession,
      chatList,
      getReplayHydrationPromise: () => replayHydrationPromise,
      setReplayHydrationPromise: (promise) => {
        replayHydrationPromise = promise;
        reconnectReplayContext.replayHydrationPromise = promise;
      },
      onError: (error) =>
        logReconnectReplaySystemEvent("reconnectReplay.hydration.failed", {
          sessionId: requestedSessionId,
          error: String(error?.message || error || ""),
        }),
    });
    if (!isCurrentActiveSession(requestedSessionId)) return false;
    const presentationMessage = presentationMessageId
      ? findMessageByViewKey?.(requestedSessionId, presentationMessageId)
      : null;
    const protocolViolation =
      presentationMessageId && !presentationMessage ? "presentation_missing" : "";
    logStateMachineDebug("stateMachine.reconnect.presentationHydration.after", () => ({
      sessionId: requestedSessionId,
      dialogProcessId: text(activeTurnSnapshot?.dialogProcessId),
      turnScopeId: text(activeTurnSnapshot?.turnScopeId),
      presentationMessageId,
      detailHydrated: hydrated === true,
      presentationHydratedFromDetail: Boolean(presentationMessage),
      presentationMaterialized: Boolean(presentationMessage),
      protocolViolation,
      presentationMessage: summarizeStateMachineMessage(presentationMessage),
      messages: (Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages
        : []
      ).map(summarizeStateMachineMessage),
    }));
    return presentationMessageId ? Boolean(presentationMessage) : hydrated;
  }

  async function reconcileSessionState({ sessionId = "" } = {}) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return false;
    let detailApplied = false;
    if (
      isFunction(chatList?.fetchSessionDetail) &&
      typeof chatList?.applySessionDetail === "function"
    ) {
      const detail = await chatList
        .fetchSessionDetail(normalizedSessionId, {
          source: "reconnectProtocolReconcile",
        })
        .catch(() => null);
      if (detail) {
        chatList.applySessionDetail(detail);
        detailApplied = true;
      }
    }
    return detailApplied;
  }

  async function consumeReplayCacheForSession(sessionId) {
    return consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId,
      applyReconnectMessagesToActiveSession,
    });
  }

  function logReconnectReplaySystemEvent(event, payload = {}) {
    sessionLogWebSocketClient.log({
      scope: "session",
      category: "system",
      event,
      sessionId: payload.sessionId,
      dialogProcessId: "",
      turnScopeId: "",
      data: {
        event,
        at: new Date().toISOString(),
        ...payload,
      },
    });
  }

  async function applyReconnectMessagesToActiveSession(messages, { turnScopeId }) {
    const { sessionId } = activeSession.value;
    if (isDeletedTurn({ sessionId, turnScopeId })) {
      return { applied: false, reason: "deleted_turn_tombstoned" };
    }
    return applyReconnectReplayBatchToActiveSession({
      activeSession,
      findMessagesByPresentationId,
      materializeTurnPresentation,
      messages,
    });
  }

  async function applyReconnectEvent(event, data) {
    return applyReconnectEventReplay({
      event,
      data,
      replayCache,
      isCurrentActiveSession,
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyTurnLifecycleEnvelope,
      applyExecutionSnapshot,
      applyExecutionChildren,
      applyExecutionTree,
      applyWorkflowRuntimeEvent,
      applyRuntimeStreamEvent: (envelope, context) =>
        routeRuntimeStreamEvent(envelope, {
          ...context,
          logRuntimeProjectionDiagnostics: logWorkflowDiagnostics,
        }),
      applyPendingInteraction: (interaction) =>
        applyReconnectInteractionRequest({
          eventData: interaction,
          normalizeInteractionRequestPayload,
          tryAutoResolveInteraction,
          isInteractionRequestHandled,
          setPendingInteractionRequest,
          clearPendingInteraction,
        }),
      applySubSessionReplayMessages,
      isDeletedTurn,
      onAttachmentLifecycle: (payload) =>
        handleAttachmentLifecycleStreamEvent({
          data: payload,
          activeSession,
          makeViewAttachments,
          logSessionEvent: ({ event, sessionId, dialogProcessId, turnScopeId, data: details }) =>
            logWorkflowDiagnostics(event, {
              sessionId,
              dialogProcessId,
              turnScopeId,
              ...(details || {}),
            }),
        }),
    });
  }

  return createReconnectReplayPublicApi({
    applyReconnectData,
    applyReconnectEvent,
    replayCache,
    isTestMode: import.meta.env.MODE === "test",
  });
}
