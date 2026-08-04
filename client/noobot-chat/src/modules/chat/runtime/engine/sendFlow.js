/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildChatPayload } from "./payload.js";
import { getCurrentSessionVersion } from "./sessionVersionManager.js";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import {
  applySendErrorState,
  finalizeSendCleanup,
} from "./sendFinalize.js";
import { prepareChatSend } from "./sendPrepare.js";
import { createSendStreamEventHandler } from "./sendStreamEventRouter.js";
import { normalizeTrimmedString } from "./utils.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import {
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../run-state-machine/turnRuntimeRegistry.js";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
  summarizeStateMachineTurn,
} from "../../../debug/loggers/stateMachineLogger.js";
import {
  createAssistantMessageId,
  createUserMessageId,
  createTurnScopeId,
  hasActiveTurnInFlight,
} from "./sendFlowSupport.js";

export { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport.js";

export function createChatEngineSender({
  activeSession,
  activeSessionId,
  applyAssistantFailureState,
  allowUserInteraction,
  applyConversationState,
  applyConversationStateFromEvent,
  applySessionDetail,
  appendMessage,
  findCanonicalMessageById,
  upsertCanonicalAssistantMessage,
  botScenario,
  chatWebSocketClient,
  sessionLogWebSocketClient,
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
  applyTurnLifecycleEnvelope,
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
    const reuseExistingUserTurn = options?.reuseExistingUserTurn === true;
    const requestedUserMessageId = normalizeTrimmedString(options?.userMessageId);
    if (reuseExistingUserTurn) {
      const existingUserMessage = (activeSession.value?.messages || []).find((message) => (
        normalizeTrimmedString(message?.messageId) === requestedUserMessageId
      ));
      if (!requestedUserMessageId || !existingUserMessage) return false;
    }
    const userMessageId = requestedUserMessageId || createUserMessageId();
    const assistantMessageId = normalizeTrimmedString(options?.assistantMessageId) || createAssistantMessageId();
    const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || "");
    const runtimeView = () => selectSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
    logSessionEvent({
      category: "message",
      event: "send.begin",
      sessionId,
      turnScopeId,
      data: {
        reuseExistingUserTurn,
        allowDuringResend: options?.allowDuringResend === true,
        hasText: hasTextToSend,
        uploadCount: explicitAttachmentFiles?.length ?? uploadFiles.value.length,
      },
    });
    logResendDebug("send.begin", () => ({
      sessionId,
      turnScopeId,
      reuseExistingUserTurn,
      allowDuringResend: options?.allowDuringResend === true,
      ...runtimeView(),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    }));
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
      userMessage,
      botMessage: botMsg,
      navigateOnFirstResponseOnce,
    } = prepareChatSend({
      input,
      uploadFiles,
      isImageMime,
      appendMessage,
      upsertCanonicalAssistantMessage,
      activeSession,
      applyConversationState,
      translate,
      navigateToLastMessage,
      messageText: explicitMessageText,
      turnScopeId,
      userMessageId,
      assistantMessageId,
      reuseExistingUserTurn,
      attachmentFiles: explicitAttachmentFiles,
      userAttachments: explicitUserAttachments,
      turnStartedAtMs,
    });
    logStateMachineDebug("stateMachine.send.presentationCreated", () => ({
      sessionId,
      turnScopeId,
      reuseExistingUserTurn,
      requestedUserMessageId: userMessageId,
      requestedPresentationMessageId: assistantMessageId,
      userMessage: summarizeStateMachineMessage(userMessage),
      assistantMessage: summarizeStateMachineMessage(botMsg),
      messages: (Array.isArray(activeSession?.value?.messages)
        ? activeSession.value.messages
        : []).map(summarizeStateMachineMessage),
    }));
    logResendDebug("send.prepare.after", () => ({
      sessionId,
      turnScopeId,
      explicitUserAttachments: summarizeDebugAttachments(explicitUserAttachments),
      explicitTransportAttachments: summarizeDebugAttachments(explicitTransportAttachments),
      filesToSend: summarizeDebugAttachments(filesToSend),
      botMessage: summarizeDebugMessage(botMsg),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    }));

    let lastStreamErrorEventData = null;
    try {
      if (!explicitAttachmentFiles) clearUploads();
      const attachments = explicitTransportAttachments || await serializeAttachments(filesToSend);
      const requestedTextStreaming = streamOutput?.value === true;

      const buildPayloadForCurrentVersion = () => buildChatPayload({
        activeSession,
        message: text,
        idempotencyKey: turnScopeId,
        expectedVersion: getCurrentSessionVersion(activeSession) ?? 0,
        attachments,
        allowUserInteraction,
        safeConfirmLevel,
        sanitizeOutput,
        requestedTextStreaming,
        botScenario,
        selectedModel,
        pluginModelConfig,
        locale,
        selectedPlugins,
        turnScopeId,
        userMessageId: normalizeTrimmedString(userMessage?.messageId || userMessage?.id || userMessageId),
        assistantMessageId,
        continueFromStopped: continueFromUserStopped,
        resumeDialogProcessId: continueFromUserStopped ? resumeDialogProcessId : "",
        resumeTurnScopeId: continueFromUserStopped ? resumeTurnScopeId : "",
        uploadHint: translate("chat.uploadHint"),
        reuseExistingUserTurn,
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
          reuseExistingUserTurn: payload?.commandType === AGENT_COMMAND.RESEND,
        },
      });
      logResendDebug("send.stream.before", () => ({
        sessionId,
        turnScopeId,
        payloadTurnScopeId: payload?.identity?.turnScopeId,
        reuseExistingUserTurn: payload?.commandType === AGENT_COMMAND.RESEND,
        explicitUserAttachments: summarizeDebugAttachments(explicitUserAttachments),
        explicitTransportAttachments: summarizeDebugAttachments(explicitTransportAttachments),
        filesToSend: summarizeDebugAttachments(filesToSend),
        attachments: summarizeDebugAttachments(attachments),
        payloadAttachments: summarizeDebugAttachments(payload?.input?.attachments),
        botMessage: summarizeDebugMessage(botMsg),
        botThinkingStartedAt: botMsg?.thinkingStartedAt || "",
      }));
      let locatedSendingStartedMessage = false;
      // Authority terminal notifications are deliberately asynchronous: the
      // coordinator resolves the authoritative materialization before the
      // Registry can project the final message runtime. Keep that promise in
      // the send transaction so send() cannot finish with a stale assistant.
      const pendingAuthorityResolutions = [];
      const applyTrackedRunStateEvent = (event) => {
        const result = applyRunStateEvent?.(event);
        if (result && typeof result.then === "function") {
          const pending = Promise.resolve(result);
          pendingAuthorityResolutions.push(pending);
          void pending.finally(() => {
            const index = pendingAuthorityResolutions.indexOf(pending);
            if (index >= 0) pendingAuthorityResolutions.splice(index, 1);
          });
        }
        return result;
      };
      const locateSendingStartedMessageOnce = () => {
        if (locatedSendingStartedMessage) return;
        locatedSendingStartedMessage = true;
        locateSendingStartedMessage?.();
      };
      const streamState = {
        get lastStreamErrorEventData() { return lastStreamErrorEventData; },
        set lastStreamErrorEventData(value) { lastStreamErrorEventData = value; },
      };
      const handleStreamEvent = createSendStreamEventHandler({
        activeSession, activeSessionId, applyConversationState, applyConversationStateFromEvent,
        applyRunStateEvent: applyTrackedRunStateEvent, applyTurnLifecycleEnvelope,
        applyWorkflowRuntimeEvent, botMessage: botMsg, classifyRealtimeLog,
        clearMissingInteractionPayloadTimer, clearPendingInteraction, connectorTypeSet,
        findCanonicalMessageById, foldMessagesForView, locateDoneMessage, locateSendingStartedMessageOnce, logSessionEvent,
        makeViewMessage, mergeAssistantAttachments, navigateOnFirstResponseOnce, refreshSessionConnectorsAsync,
        requestedTextStreaming, sessionId, setPendingInteractionRequest,
        streamState, tryAutoResolveInteraction, turnScopeId, upsertConnectedConnectorInPanelState,
      });
      const streamOnce = (streamPayload) => chatWebSocketClient.stream(streamPayload, handleStreamEvent);
      try {
        await streamOnce(payload);
        // The stream transport may resolve before the terminal lookup does.
        // Await a stable snapshot of the promises observed during the stream;
        // a resolution may schedule a newer one, so drain until quiescent.
        while (pendingAuthorityResolutions.length > 0) {
          await Promise.all([...pendingAuthorityResolutions]);
        }
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
            applySessionDetail(detail, { scrollToBottom: false });
          }
        }
        throw streamError;
      }
      logStateMachineDebug("stateMachine.stream.resolved", () => ({
        sessionId,
        turnScopeId,
        botMessage: summarizeStateMachineMessage(botMsg),
      }));
      logSessionEvent({
        category: "message",
        event: "send.resolved",
        sessionId,
        turnScopeId,
      });

      logResendDebug("send.doneReturn", () => ({
        turnScopeId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      return true;
    } catch (error) {
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
      logResendDebug("send.catch.error", () => ({
        turnScopeId,
        error: String(error?.message || error || ""),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
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
      return false;
    } finally {
      logResendDebug("send.cleanup", () => ({
        turnScopeId,
        ...runtimeView(),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      logSessionEvent({
        category: "message",
        event: "send.cleanup",
        sessionId,
        turnScopeId,
        data: runtimeView(),
      });
      finalizeSendCleanup({
        pendingInteractionRequest,
        interactionSubmitting,
      });
      logStateMachineDebug("stateMachine.send.cleanup", () => {
        const messages = Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : [];
        const runtime = runtimeView();
        const turn = resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
        return {
          sessionId,
          turnScopeId,
          runtime: summarizeStateMachineTurn(turn, runtime),
          pendingMessageCount: messages.filter((message) => message?.pending === true).length,
          messageCount: messages.length,
          interactionPending: Boolean(pendingInteractionRequest?.value),
          interactionSubmitting: interactionSubmitting?.value === true,
        };
      });
    }
  };
}
