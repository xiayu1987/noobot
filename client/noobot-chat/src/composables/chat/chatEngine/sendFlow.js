/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildChatPayload } from "./payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./sendFinalize";
import { prepareChatSend } from "./sendPrepare";
import { finalizeDoneTurnPresentation, finalizeStoppedSessionDetail } from "./sessionFinalize";
import { createDoneTurnFinalizer } from "./sendDoneFinalizer";
import { createSendStreamEventHandler } from "./sendStreamEventRouter";
import { normalizeTrimmedString } from "./utils";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import { selectSessionTurnRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";
import { logStateMachineDebug, summarizeStateMachineMessage } from "../debug/stateMachineLogger";
import {
  createTurnScopeId,
  hasActiveTurnInFlight,
} from "./sendFlowSupport";

export { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport";

export function createChatEngineSender({
  activeSession,
  activeSessionId,
  applyAssistantFailureState,
  allowUserInteraction,
  applyConversationState,
  applyConversationStateFromEvent,
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
  finalizePendingResendOperation,
}) {
  const logSessionEvent = (event = {}) => sessionLogWebSocketClient?.log?.(event);
  return async function send(options = {}) {
    const explicitMessageText = typeof options?.messageText === "string" ? options.messageText.trim() : "";
    const explicitAttachmentFiles = Array.isArray(options?.attachmentFiles) ? options.attachmentFiles : null;
    const explicitUserAttachments = Array.isArray(options?.userAttachments) ? options.userAttachments : null;
    const explicitTransportAttachments = Array.isArray(options?.transportAttachments) ? options.transportAttachments : null;
    const hasExplicitAttachments = Boolean(explicitAttachmentFiles?.length || explicitTransportAttachments?.length);
    const hasTextToSend = Boolean(explicitMessageText || input.value.trim());
    const continueFromUserStopped = options?.continueFromUserStopped === true;
    const composerRequestStarted = options?.composerRequestStarted === true;
    const resumeDialogProcessId = normalizeTrimmedString(options?.resumeDialogProcessId);
    const resumeTurnScopeId = normalizeTrimmedString(options?.resumeTurnScopeId);
    if (!ensureConnected()) return false;
    const allowCurrentContinuationRequest = continueFromUserStopped === true;
    const currentSessionInFlight = hasActiveTurnInFlight({ activeSession, turnRuntimeRegistry });
    if ((currentSessionInFlight && !composerRequestStarted && options?.allowDuringResend !== true && !allowCurrentContinuationRequest) || !activeSession.value) return false;
    if (!continueFromUserStopped && !hasTextToSend && uploadFiles.value.length === 0 && !hasExplicitAttachments) return false;

    const turnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || "");
    const runtimeView = () => selectSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
    logSessionEvent({
      category: "message",
      event: "send.begin",
      sessionId,
      turnScopeId,
      data: {
        reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
        allowDuringResend: options?.allowDuringResend === true,
        hasText: hasTextToSend,
        uploadCount: explicitAttachmentFiles?.length ?? uploadFiles.value.length,
      },
    });
    logResendDebug("send.begin", {
      sessionId,
      turnScopeId,
      reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      allowDuringResend: options?.allowDuringResend === true,
      ...runtimeView(),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });
    chatWebSocketClient?.clearStopRequested?.();
    logResendDebug("send.clearStopRequested", { turnScopeId });
    const turnStartedAtMs = Date.now();
    const thinkingStartedAt = new Date(turnStartedAtMs).toISOString();
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId,
      turnScopeId,
      thinkingStartedAt,
      source: "send_flow",
    });
    const {
      text,
      filesToSend,
      botMessage: botMsg,
      navigateOnFirstResponseOnce,
    } = prepareChatSend({
      input,
      uploadFiles,
      isImageMime,
      appendMessage,
      activeSession,
      applyConversationState,
      translate,
      navigateToLastMessage,
      messageText: explicitMessageText,
      turnScopeId,
      reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      attachmentFiles: explicitAttachmentFiles,
      userAttachments: explicitUserAttachments,
      turnStartedAtMs,
    });
    logResendDebug("send.prepare.after", {
      sessionId,
      turnScopeId,
      explicitUserAttachments: summarizeDebugAttachments(explicitUserAttachments),
      explicitTransportAttachments: summarizeDebugAttachments(explicitTransportAttachments),
      filesToSend: summarizeDebugAttachments(filesToSend),
      botMessage: summarizeDebugMessage(botMsg),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });

    let lastStreamErrorEventData = null;
    let finalDoneEventData = null;
    let finalUserStopEventData = null;
    try {
      if (!explicitAttachmentFiles) clearUploads();
      const attachments = explicitTransportAttachments || await serializeAttachments(filesToSend);
      const requestedTextStreaming = streamOutput?.value !== false;

      const buildPayloadForCurrentVersion = () => buildChatPayload({
        userId,
        activeSession,
        message: text,
        idempotencyKey: turnScopeId,
        expectedVersion: activeSession?.value?.version ?? activeSession?.value?.revision,
        attachments,
        allowUserInteraction,
        safeConfirm,
        safeConfirmLevel,
        sanitizeOutput,
        requestedTextStreaming,
        botScenario,
        selectedModel,
        pluginModelConfig,
        locale,
        selectedPlugins,
        turnScopeId,
        action: continueFromUserStopped ? "continue" : "",
        resumeDialogProcessId: continueFromUserStopped ? resumeDialogProcessId : "",
        resumeTurnScopeId: continueFromUserStopped ? resumeTurnScopeId : "",
        thinkingStartedAt,
        uploadHint: translate("chat.uploadHint"),
        reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      });
      let payload = buildPayloadForCurrentVersion();
      logSessionEvent({
        category: "transport",
        event: "stream.start",
        sessionId,
        turnScopeId,
        data: {
          requestedTextStreaming,
          attachmentCount: attachments.length,
          reuseExistingUserTurn: payload?.reuseExistingUserTurn === true,
        },
      });
      logResendDebug("send.stream.before", {
        sessionId,
        turnScopeId,
        payloadTurnScopeId: payload?.turnScopeId,
        reuseExistingUserTurn: payload?.reuseExistingUserTurn,
        explicitUserAttachments: summarizeDebugAttachments(explicitUserAttachments),
        explicitTransportAttachments: summarizeDebugAttachments(explicitTransportAttachments),
        filesToSend: summarizeDebugAttachments(filesToSend),
        attachments: summarizeDebugAttachments(attachments),
        payloadAttachments: summarizeDebugAttachments(payload?.attachments),
        botMessage: summarizeDebugMessage(botMsg),
        botThinkingStartedAt: botMsg?.thinkingStartedAt || "",
        payloadThinkingStartedAt: payload?.config?.thinkingStartedAt || "",
      });
      let locatedSendingStartedMessage = false;
      const locateSendingStartedMessageOnce = () => {
        if (locatedSendingStartedMessage) return;
        locatedSendingStartedMessage = true;
        locateSendingStartedMessage?.();
      };
      const doneTurnFinalizer = createDoneTurnFinalizer({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        getFinalDoneEventData: () => finalDoneEventData,
        fetchSessionDetail,
        applySessionDetail,
        applyAssistantFailureState,
        applyRunStateEvent,
        refreshSessionConnectorsAsync,
        logSessionEvent,
        locateDoneMessage,
        finalizePendingResendOperation,
      });
      const startFinalDoneSessionDetailOnce = doneTurnFinalizer.start;

      const streamState = {
        get finalDoneEventData() { return finalDoneEventData; },
        set finalDoneEventData(value) { finalDoneEventData = value; },
        get finalUserStopEventData() { return finalUserStopEventData; },
        set finalUserStopEventData(value) { finalUserStopEventData = value; },
        get lastStreamErrorEventData() { return lastStreamErrorEventData; },
        set lastStreamErrorEventData(value) { lastStreamErrorEventData = value; },
      };
      const handleStreamEvent = createSendStreamEventHandler({
        activeSession, activeSessionId, applyConversationState, applyConversationStateFromEvent,
        applyRunStateEvent, applyWorkflowRuntimeEvent, botMessage: botMsg, classifyRealtimeLog,
        clearMissingInteractionPayloadTimer, clearPendingInteraction, connectorTypeSet, doneTurnFinalizer,
        foldMessagesForView, locateDoneMessage, locateSendingStartedMessageOnce, logSessionEvent,
        makeViewMessage, mergeAssistantAttachments, navigateOnFirstResponseOnce, refreshSessionConnectorsAsync,
        requestedTextStreaming, sessionId, setPendingInteractionRequest, startFinalDoneSessionDetailOnce,
        streamState, tryAutoResolveInteraction, turnScopeId, upsertConnectedConnectorInPanelState,
        upsertSubSessionEvent, upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent,
      });
      const streamOnce = (streamPayload) => chatWebSocketClient.stream(streamPayload, handleStreamEvent);
      try {
        await streamOnce(payload);
      } catch (streamError) {
        const errorData = streamError?.data || lastStreamErrorEventData || {};
        const versionConflict = normalizeTrimmedString(errorData?.errorCode) === "SESSION_VERSION_CONFLICT";
        if (versionConflict) {
          const detail = await fetchSessionDetail(sessionId, {
            source: "sendVersionConflict",
            force: true,
            reuseRecentlyLoaded: false,
          }).catch(() => null);
          if (detail) {
            applySessionDetail(detail, { preserveCurrentMessages: true, scrollToBottom: false });
          }
        }
        throw streamError;
      }
      logStateMachineDebug("stateMachine.stream.resolved", {
        hasFinalDoneEventData: Boolean(finalDoneEventData),
        hasFinalDoneDetailPromise: Boolean(doneTurnFinalizer.promise),
        sessionId: finalDoneEventData?.sessionId || "",
        dialogProcessId: finalDoneEventData?.dialogProcessId || "",
        turnScopeId: finalDoneEventData?.turnScopeId || turnScopeId,
        botMessage: summarizeStateMachineMessage(botMsg),
      });
      logSessionEvent({
        category: "message",
        event: "send.resolved",
        sessionId: finalDoneEventData?.sessionId || sessionId,
        dialogProcessId: finalDoneEventData?.dialogProcessId || "",
        turnScopeId: finalDoneEventData?.turnScopeId || turnScopeId,
        data: {
          hasFinalDoneEventData: Boolean(finalDoneEventData),
          hasFinalDoneDetailPromise: Boolean(doneTurnFinalizer.promise),
        },
      });

      if (finalDoneEventData) {
        await startFinalDoneSessionDetailOnce("stream_resolved");
      }

      applyStreamCompletedFallback({
        finalDoneEventData: finalDoneEventData && !doneTurnFinalizer.promise ? finalDoneEventData : null,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
      });

      const userStoppedByFinalEvent = Boolean(finalUserStopEventData);
      const userStoppedByUserStopRequest = !finalDoneEventData && applyStopRequestedState({
        chatWebSocketClient,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
        backendStopEventData: finalUserStopEventData,
      });
      logResendDebug("send.stopCheck", {
        turnScopeId,
        userStoppedByFinalEvent,
        userStoppedByUserStopRequest,
        finalUserStopEventData,
        hasFinalDoneEventData: Boolean(finalDoneEventData),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      if (userStoppedByFinalEvent || userStoppedByUserStopRequest) {
        if (userStoppedByFinalEvent && !userStoppedByUserStopRequest) {
          applyStopRequestedState({
            chatWebSocketClient: { isStopRequested: () => true },
            activeSession,
            botMessage: botMsg,
            applyConversationState,
            backendStopEventData: finalUserStopEventData,
          });
        }
        const stoppedSessionId = normalizeTrimmedString(
          finalUserStopEventData?.sessionId ||
          activeSession?.value?.backendSessionId ||
          activeSession?.value?.id,
        );
        await finalizeStoppedSessionDetail({
          activeSession,
          activeSessionId,
          botMessage: botMsg,
          finalEventData: {
            ...finalUserStopEventData,
            sessionId: stoppedSessionId,
            turnScopeId: finalUserStopEventData?.turnScopeId || turnScopeId,
          },
          fetchSessionDetail,
          applySessionDetail,
          applyRunStateEvent,
        });
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
        logResendDebug("send.stopReturn", {
          turnScopeId,
          ...runtimeView(),
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        return true;
      }
      logResendDebug("send.doneReturn", {
        turnScopeId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      return true;
    } catch (error) {
      if (
        applyStopRequestedState({
          chatWebSocketClient,
          activeSession,
          botMessage: botMsg,
          applyConversationState,
        })
      ) {
        logResendDebug("send.catch.stopRequested", {
          turnScopeId,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
        return false;
      }
      if (!(options?.allowDuringResend === true && options?.reuseExistingUserTurn === true)) {
        applySendErrorState({
          error,
          errorEventData: lastStreamErrorEventData || error?.data || null,
          activeSession,
          botMessage: botMsg,
          applyConversationState,
          clearPendingInteraction,
          notify,
          translate,
        });
      }
      logResendDebug("send.catch.error", {
        turnScopeId,
        error: String(error?.message || error || ""),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      logSessionEvent({
        category: "message",
        level: "error",
        event: "send.error",
        sessionId,
        turnScopeId,
        message: String(error?.message || error || ""),
        data: {
          error: String(error?.message || error || ""),
          hasStreamErrorEventData: Boolean(lastStreamErrorEventData),
        },
      });
      await finalizeDoneTurnPresentation({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData: lastStreamErrorEventData || error?.data || null,
        fetchSessionDetail,
        applySessionDetail,
        applyAssistantFailureState,
        applyRunStateEvent,
        refreshSessionConnectorsAsync,
        completionSource: "realtimeErrorRecovery",
        logSessionEvent,
      });
      return false;
    } finally {
      logResendDebug("send.cleanup", {
        turnScopeId,
        ...runtimeView(),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      logSessionEvent({
        category: "message",
        event: "send.cleanup",
        sessionId,
        turnScopeId,
        data: runtimeView(),
      });
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  };
}
