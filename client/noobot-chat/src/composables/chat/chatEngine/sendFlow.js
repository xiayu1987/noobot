/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { useProcessStore } from "../../../shared/stores/useProcessStore";
import { buildChatPayload } from "./payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./sendFinalize";
import { prepareChatSend } from "./sendPrepare";
import {
  finalizeDoneSessionDetail,
  refreshFinalSessionDetail,
} from "./sessionFinalize";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./streamHandlers";
import { normalizeTrimmedString } from "./utils";
import {
  SESSION_RUN_EVENT,
  FrontendRunState,
  isInFlightSessionRunState,
} from "../sessionRunStateMachine";
import {
  getMessageRole,
  getMessageDialogProcessId,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import { hasMatchingInFlightAssistantMessage } from "./messageStateGuards";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";
import { logStateMachineDebug, summarizeStateMachineMessage } from "../debug/stateMachineLogger";
import {
  applyLatestSessionVersion,
  getCurrentSessionVersion,
  isNewerSessionVersion,
} from "./sessionVersionManager";

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function isEventForCurrentTurn(data = {}, botMessage = {}) {
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  if (!botTurnScopeId || !eventTurnScopeId) return true;
  return eventTurnScopeId === botTurnScopeId;
}

function isUserStoppedEvent(event = "", data = {}) {
  return normalizeTrimmedString(event) === StreamEventEnum.USER_STOPPED;
}

function isCompletedChannelStateEvent(event = "", data = {}) {
  return normalizeTrimmedString(event) === StreamEventEnum.CHANNEL_STATE &&
    normalizeTrimmedString(data?.state) === "completed";
}

function requirePersistedTurnStatus(data = {}, expectedStatus = "") {
  const turnStatus = data?.turnStatus;
  // Terminal channel state/DONE envelopes from an older proxy or from replay
  // may not carry the newly added turnStatus projection. The session detail
  // refresh remains authoritative, so absence must not turn a successfully
  // persisted completion into a frontend error (and a sticky Continue state).
  if (!turnStatus) return null;
  const actualStatus = normalizeTrimmedString(turnStatus?.status).toLowerCase();
  if (actualStatus !== expectedStatus) {
    const error = new Error(
      `terminal event is missing persisted turn status confirmation: expected ${expectedStatus || "unknown"}`,
    );
    error.code = "invalid_terminal_turn_status";
    error.data = data;
    throw error;
  }
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const statusTurnScopeId = normalizeTrimmedString(turnStatus?.turnScopeId);
  const statusDialogProcessId = normalizeTrimmedString(turnStatus?.dialogProcessId);
  if (
    (eventTurnScopeId && statusTurnScopeId && eventTurnScopeId !== statusTurnScopeId) ||
    (eventDialogProcessId && statusDialogProcessId && eventDialogProcessId !== statusDialogProcessId)
  ) {
    const error = new Error("terminal event turn identity does not match persisted turn status");
    error.code = "invalid_terminal_turn_status_identity";
    error.data = data;
    throw error;
  }
  return turnStatus;
}

function hasCompletableRunIdentity(data = {}, botMessage = {}) {
  return Boolean(
    normalizeTrimmedString(data?.turnScopeId) ||
      normalizeTrimmedString(data?.dialogProcessId) ||
      normalizeTrimmedString(botMessage?.dialogProcessId),
  );
}

function buildFinalDoneEventData({ data = {}, activeSession, botMessage } = {}) {
  return {
    ...(data || {}),
    sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
    dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMessage?.dialogProcessId),
    turnScopeId: data?.turnScopeId || normalizeTrimmedString(botMessage?.turnScopeId),
  };
}

function hasDialogProcessConflictForTurn({ activeSession, data = {}, botMessage = {} } = {}) {
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  if (!eventDialogProcessId || !eventTurnScopeId || !botTurnScopeId) return false;
  if (eventTurnScopeId !== botTurnScopeId) return false;
  const messages = Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : [];
  return messages.some((messageItem) => {
    if (messageItem === botMessage) return false;
    if (getMessageDialogProcessId(messageItem) !== eventDialogProcessId) return false;
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    return Boolean(messageTurnScopeId && messageTurnScopeId !== botTurnScopeId);
  });
}

function hasMatchingInFlightAssistant({ activeSession, runStateSnapshot } = {}) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const runTurnScopeId = normalizeTrimmedString(runStateSnapshot?.value?.turnScopeId);
  return hasMatchingInFlightAssistantMessage(messages, { turnScopeId: runTurnScopeId });
}

function isRunStateForActiveSession({ activeSession, runStateSnapshot } = {}) {
  const runSessionId = normalizeTrimmedString(runStateSnapshot?.value?.sessionId);
  if (!runSessionId) return true;
  const session = activeSession?.value || {};
  const activeIds = [
    session.backendSessionId,
    session.sessionId,
    session.id,
  ].map((item) => normalizeTrimmedString(item)).filter(Boolean);
  return !activeIds.length || activeIds.includes(runSessionId);
}

function hasConsistentSendingState({ sending, activeSession, runStateSnapshot, continueFromUserStopped = false } = {}) {
  if (!isRunStateForActiveSession({ activeSession, runStateSnapshot })) {
    return !sending?.value;
  }
  if (
    continueFromUserStopped === true &&
    [
      FrontendRunState.USER_STOP_COMPLETED,
      FrontendRunState.CONTINUE_REQUESTING,
    ].includes(normalizeTrimmedString(runStateSnapshot?.value?.state))
  ) {
    return true;
  }
  if (!sending?.value && !isInFlightSessionRunState(runStateSnapshot?.value?.state)) return true;
  return hasMatchingInFlightAssistant({ activeSession, runStateSnapshot });
}

export function createChatEngineSender({
  activeSession,
  activeSessionId,
  allowUserInteraction,
  applyConversationState,
  applyConversationStateFromEvent,
  applySessionDetail,
  appendMessage,
  botScenario,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  classifyRealtimeLog,
  clearMissingInteractionPayloadTimer,
  clearPendingInteraction,
  clearUploads,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  ensureConnected,
  fetchSessionDetail,
  foldMessagesForView,
  forceTool,
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
  scrollBottom,
  selectedModel,
  selectedPlugins,
  sending,
  canStop,
  runStateSnapshot,
  applyRunStateEvent,
  serializeAttachments,
  streamOutput,
  translate,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
  uploadFiles,
  userId,
  finalizePendingResendOperation,
  processStore = null,
}) {
  let resolvedProcessStore = processStore || null;
  const logSessionEvent = (event = {}) => sessionLogWebSocketClient?.log?.(event);
  function getResolvedProcessStore() {
    if (resolvedProcessStore) return resolvedProcessStore;
    try {
      resolvedProcessStore = useProcessStore();
    } catch {
      resolvedProcessStore = null;
    }
    return resolvedProcessStore;
  }
  return async function send(options = {}) {
    const explicitMessageText = typeof options?.messageText === "string" ? options.messageText.trim() : "";
    const explicitAttachmentFiles = Array.isArray(options?.attachmentFiles) ? options.attachmentFiles : null;
    const explicitUserAttachments = Array.isArray(options?.userAttachments) ? options.userAttachments : null;
    const explicitTransportAttachments = Array.isArray(options?.transportAttachments) ? options.transportAttachments : null;
    const hasExplicitAttachments = Boolean(explicitAttachmentFiles?.length || explicitTransportAttachments?.length);
    const hasTextToSend = Boolean(explicitMessageText || input.value.trim());
    const continueFromUserStopped = options?.continueFromUserStopped === true;
    const resumeDialogProcessId = normalizeTrimmedString(options?.resumeDialogProcessId);
    const resumeTurnScopeId = normalizeTrimmedString(options?.resumeTurnScopeId);
    if (!ensureConnected()) return false;
    if (options?.allowDuringResend !== true && !hasConsistentSendingState({
      sending,
      activeSession,
      runStateSnapshot,
      continueFromUserStopped,
    })) {
      notify?.({
        type: "warning",
        message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
      });
      return false;
    }
    const allowCurrentContinuationRequest = continueFromUserStopped === true;
    if ((sending.value && options?.allowDuringResend !== true && !allowCurrentContinuationRequest) || !activeSession.value) return false;
    if (!continueFromUserStopped && !hasTextToSend && uploadFiles.value.length === 0 && !hasExplicitAttachments) return false;

    const turnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    const sessionId = String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || "");
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
      sending: sending?.value,
      canStop: canStop?.value,
      runState: runStateSnapshot?.value,
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });
    chatWebSocketClient?.clearStopRequested?.();
    logResendDebug("send.clearStopRequested", { turnScopeId });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId,
      turnScopeId,
      source: "send_flow",
    });
    const {
      text,
      filesToSend,
      botMessage: botMsg,
      scrollOnFirstResponseOnce,
    } = prepareChatSend({
      input,
      uploadFiles,
      isImageMime,
      appendMessage,
      activeSession,
      applyConversationState,
      translate,
      scrollBottom,
      messageText: explicitMessageText,
      turnScopeId,
      reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      attachmentFiles: explicitAttachmentFiles,
      userAttachments: explicitUserAttachments,
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
    let finalDoneDetailPromise = null;
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
        forceTool,
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
        thinkingStartedAt: botMsg?.thinkingStartedAt || "",
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
      const activeProcessStore = getResolvedProcessStore();
      let locatedSendingStartedMessage = false;
      const locateSendingStartedMessageOnce = () => {
        // Do not navigate while the assistant response is still streaming.
        // The final navigation is performed once after DONE/finalize below.
        if (locatedSendingStartedMessage) return;
        locatedSendingStartedMessage = true;
      };
      const startFinalDoneSessionDetailOnce = (source = "") => {
        if (!finalDoneEventData || finalDoneDetailPromise) return finalDoneDetailPromise;
        logStateMachineDebug("stateMachine.done.finalize.before", {
          source,
          sessionId: finalDoneEventData.sessionId,
          dialogProcessId: finalDoneEventData.dialogProcessId,
          turnScopeId: finalDoneEventData.turnScopeId,
          botMessage: summarizeStateMachineMessage(botMsg),
        });
        finalDoneDetailPromise = finalizeDoneSessionDetail({
          activeSession,
          activeSessionId,
          botMessage: botMsg,
          finalDoneEventData,
          fetchSessionDetail,
          applySessionDetail,
          applyRunStateEvent,
          refreshSessionConnectorsAsync,
        }).then((applied) => {
          logStateMachineDebug("stateMachine.done.finalize.after", {
            source,
            applied: Boolean(applied),
            sessionId: finalDoneEventData?.sessionId || "",
            dialogProcessId: finalDoneEventData?.dialogProcessId || "",
            turnScopeId: finalDoneEventData?.turnScopeId || "",
            botMessage: summarizeStateMachineMessage(botMsg),
          });
          if (applied) {
            locateDoneMessage?.();
            finalizePendingResendOperation?.({ finalOnly: true });
          }
          return applied;
        }).catch((error) => {
          logStateMachineDebug("stateMachine.done.finalize.failed", {
            source,
            sessionId: finalDoneEventData?.sessionId || "",
            dialogProcessId: finalDoneEventData?.dialogProcessId || "",
            turnScopeId: finalDoneEventData?.turnScopeId || "",
            error: String(error?.message || error || ""),
            botMessage: summarizeStateMachineMessage(botMsg),
          });
          throw error;
        });
        return finalDoneDetailPromise;
      };

      const streamOnce = (streamPayload) => chatWebSocketClient.stream(streamPayload, ({ event, data }) => {
        logSessionEvent({
          category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
          event: `stream.${event || "event"}`,
          sessionId: data?.sessionId || sessionId,
          dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMsg.dialogProcessId),
          turnScopeId: data?.turnScopeId || turnScopeId,
          data: {
            streamEvent: event,
            state: data?.state || "",
            seq: data?.seq || 0,
            hasContent: Boolean(data?.content || data?.delta || data?.message),
          },
        });
        logResendDebug("send.stream.event", {
          event,
          eventTurnScopeId: data?.turnScopeId,
          eventDialogProcessId: data?.dialogProcessId,
          state: data?.state,
          botMessage: summarizeDebugMessage(botMsg),
        });
        if (!isEventForCurrentTurn(data || {}, botMsg)) return;
        if (event === "turn_committed") {
          const eventSessionId = normalizeTrimmedString(data?.sessionId);
          const targetSessionId = normalizeTrimmedString(
            activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId,
          );
          if (eventSessionId === targetSessionId && isNewerSessionVersion(
            data?.sessionVersion,
            getCurrentSessionVersion(activeSession),
          )) {
            applyLatestSessionVersion(activeSession.value, {
              version: data.sessionVersion,
              revision: data.sessionVersion,
            });
          }
          return;
        }
        if (isUserStoppedEvent(event, data || {}) && hasDialogProcessConflictForTurn({
          activeSession,
          data: data || {},
          botMessage: botMsg,
        })) return;
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
          fallbackTurnScopeId: normalizeTrimmedString(botMsg.turnScopeId),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
          const channelState = normalizeTrimmedString(data?.state);
          // DONE is normally the persisted completion envelope, but older or
          // interrupted streams may resolve after only the terminal channel
          // state. Keep that terminal fact as a completion input so the UI can
          // still run the authoritative detail refresh and leave `sending`.
          if (isCompletedChannelStateEvent(event, data || {}) && hasCompletableRunIdentity(data || {}, botMsg)) {
            finalDoneEventData = buildFinalDoneEventData({
              data,
              activeSession,
              botMessage: botMsg,
            });
            logStateMachineDebug("stateMachine.done.finalize.detected", {
              source: "channel_state",
              backendState: channelState,
              sessionId: finalDoneEventData.sessionId,
              dialogProcessId: finalDoneEventData.dialogProcessId,
              turnScopeId: finalDoneEventData.turnScopeId,
              botMessage: summarizeStateMachineMessage(botMsg),
            });
            startFinalDoneSessionDetailOnce("channel_state");
          }
          return;
        }
        if (event === StreamEventEnum.ERROR) {
          lastStreamErrorEventData = data || {};
          return;
        }
        if (
          handleBasicStreamEvent(event, {
            data,
            botMessage: botMsg,
            classifyRealtimeLog,
            scrollOnFirstResponseOnce,
            activeSession,
            connectorTypeSet,
            upsertConnectedConnectorInPanelState,
            refreshSessionConnectorsAsync,
            mergeAssistantAttachments,
            makeViewMessage,
            processStore: activeProcessStore,
            locateSendingStartedMessageOnce,
          })
        ) {
          return;
        }
        if (event === StreamEventEnum.INTERACTION_REQUEST) {
          handleInteractionRequestStreamEvent({
            data,
            clearMissingInteractionPayloadTimer,
            scrollOnFirstResponseOnce,
            tryAutoResolveInteraction,
            setPendingInteractionRequest,
          });
        } else if (event === StreamEventEnum.DONE) {
          requirePersistedTurnStatus(data, "completed");
          finalDoneEventData = buildFinalDoneEventData({
            data,
            activeSession,
            botMessage: botMsg,
          });
          logStateMachineDebug("stateMachine.done.finalize.detected", {
            source: "done_event",
            sessionId: finalDoneEventData.sessionId,
            dialogProcessId: finalDoneEventData.dialogProcessId,
            turnScopeId: finalDoneEventData.turnScopeId,
            botMessage: summarizeStateMachineMessage(botMsg),
          });
          startFinalDoneSessionDetailOnce("done_event");
          handleDoneStreamEvent({
            data,
            requestedTextStreaming,
            botMessage: botMsg,
            activeSession,
            activeSessionId,
            clearPendingInteraction,
            classifyRealtimeLog,
            scrollOnFirstResponseOnce,
            makeViewMessage,
            foldMessagesForView,
            mergeAssistantAttachments,
            locateDoneMessage,
            applyConversationState,
            processStore: activeProcessStore,
            locateSendingStartedMessageOnce,
            suppressCompletionConversationState: Boolean(finalDoneDetailPromise),
          });
        } else if (event === StreamEventEnum.USER_STOPPED) {
          requirePersistedTurnStatus(data, "user_stopped");
          finalUserStopEventData = {
            ...(data || {}),
            sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
            dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMsg.dialogProcessId),
          };
        }
      }, {
        onPayloadSent: continueFromUserStopped && typeof options?.onContinueUserStoppedResumeSnapshotCommitted === "function"
          ? () => options.onContinueUserStoppedResumeSnapshotCommitted({
              sessionId,
              turnScopeId,
              resumeDialogProcessId,
              resumeTurnScopeId,
            })
          : undefined,
      });
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await streamOnce(payload);
          break;
        } catch (streamError) {
          const errorData = streamError?.data || lastStreamErrorEventData || {};
          const versionConflict = normalizeTrimmedString(errorData?.errorCode) === "SESSION_VERSION_CONFLICT";
          if (!versionConflict || attempt >= 2) throw streamError;
          const previousVersion = getCurrentSessionVersion(activeSession);
          const detail = await fetchSessionDetail(sessionId, {
            source: "sendVersionConflict",
            force: true,
            reuseRecentlyLoaded: false,
          });
          if (!detail) throw streamError;
          applySessionDetail(detail, { preserveCurrentMessages: true, scrollToBottom: false });
          if (!isNewerSessionVersion(getCurrentSessionVersion(activeSession), previousVersion)) {
            throw streamError;
          }
          lastStreamErrorEventData = null;
          payload = buildPayloadForCurrentVersion();
        }
      }
      logStateMachineDebug("stateMachine.stream.resolved", {
        hasFinalDoneEventData: Boolean(finalDoneEventData),
        hasFinalDoneDetailPromise: Boolean(finalDoneDetailPromise),
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
          hasFinalDoneDetailPromise: Boolean(finalDoneDetailPromise),
        },
      });

      if (finalDoneEventData) {
        await startFinalDoneSessionDetailOnce("stream_resolved");
      }

      // Safety net: if terminal channel_state is delayed/lost, avoid sticky "stop" UI.
      // Primary source of truth remains the frontend completion detail chain once a
      // final DONE/channel_state has been detected. Run fallback only when no final
      // completion detail chain exists; otherwise a failed detail request must remain
      // an error and must not be overwritten by a late completed fallback.
      applyStreamCompletedFallback({
        sending,
        // The detail chain is the primary completion path. This fallback is
        // intentionally used only when a terminal completion was observed but
        // no detail request could be started (for example a missing session id).
        finalDoneEventData: finalDoneEventData && !finalDoneDetailPromise ? finalDoneEventData : null,
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
        // The websocket event only confirms that the backend persisted the
        // terminal fact. Re-read session detail so the rendered placeholder is
        // always derived from session.turnStatuses, not from a second frontend
        // copy of the event payload.
        const stoppedSessionId = normalizeTrimmedString(
          finalUserStopEventData?.sessionId ||
          activeSession?.value?.backendSessionId ||
          activeSession?.value?.id,
        );
        if (stoppedSessionId && finalUserStopEventData?.turnStatus) {
          try {
            const stoppedDetail = await fetchSessionDetail(stoppedSessionId, {
              source: "userStoppedFinalStatus",
              force: true,
              reuseRecentlyLoaded: false,
            });
            if (stoppedDetail) {
              applySessionDetail(stoppedDetail, {
                preserveCurrentMessages: false,
                scrollToBottom: false,
              });
            }
          } catch (detailError) {
            // Stop is already confirmed and persisted. A read-after-write UI
            // refresh failure must not turn that terminal outcome into send error.
            logResendDebug("send.stopDetailRefresh.failed", {
              sessionId: stoppedSessionId,
              turnScopeId,
              error: String(detailError?.message || detailError || ""),
            });
          }
        }
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
        logResendDebug("send.stopReturn", {
          turnScopeId,
          sending: sending?.value,
          canStop: canStop?.value,
          runState: runStateSnapshot?.value,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        // A persisted USER_STOPPED event is a successful terminal outcome for
        // the request. In particular, resendTransaction must not interpret it
        // as a transport failure and restore the snapshot from before
        // replace-turn; doing so resurrects the previous stopped turn and
        // prevents the next stop -> edit -> resend cycle from finding the
        // freshly persisted replacement turn.
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
      await finalizeDoneSessionDetail({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData: lastStreamErrorEventData || error?.data || null,
        fetchSessionDetail,
        applySessionDetail,
        applyRunStateEvent,
        refreshSessionConnectorsAsync,
      });
      return false;
    } finally {
      logResendDebug("send.cleanup", {
        turnScopeId,
        sending: sending?.value,
        canStop: canStop?.value,
        runState: runStateSnapshot?.value,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      logSessionEvent({
        category: "message",
        event: "send.cleanup",
        sessionId,
        turnScopeId,
        data: { sending: sending?.value, canStop: canStop?.value },
      });
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  };
}
