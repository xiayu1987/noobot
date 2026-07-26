/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  MESSAGE_EVENT_ENVELOPE_KIND,
  isMessageEventEnvelope,
} from "@noobot/shared/message-event-protocol";
import { buildChatPayload } from "./payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./sendFinalize";
import { prepareChatSend } from "./sendPrepare";
import {
  finalizeDoneTurnPresentation,
  finalizeStoppedSessionDetail,
  refreshFinalSessionDetail,
} from "./sessionFinalize";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./streamHandlers";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./turnProjectionStore";
import { normalizeTrimmedString } from "./utils";
import {
  SESSION_RUN_EVENT,
  FrontendRunState,
} from "../sessionRunStateMachine";
import {
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../sessionRunStateMachine/turnRuntimeRegistry";
import {
  getMessageRole,
  getMessageDialogProcessId,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
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
import { normalizeTurnTransportEnvelope } from "./turnTransportEnvelope";

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

function activeTurnScopeIdForSession({ activeSession, turnRuntimeRegistry, sessionId = "" } = {}) {
  const canonicalSessionId = normalizeTrimmedString(
    turnRuntimeRegistry?.value?.sessionAliases?.[sessionId] || sessionId,
  );
  const activeScope = normalizeTrimmedString(
    turnRuntimeRegistry?.value?.sessions?.[canonicalSessionId]?.activeTurnScopeId,
  );
  if (activeScope) return activeScope;
  const messages = Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const scope = getMessageTurnScopeId(messages[index]);
    if (scope) return scope;
  }
  return "";
}

function hasActiveTurnInFlight({ activeSession, turnRuntimeRegistry } = {}) {
  const sessionId = sessionRuntimeId(activeSession?.value);
  const turnScopeId = activeTurnScopeIdForSession({ activeSession, turnRuntimeRegistry, sessionId });
  const turn = resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
  return ["requesting", "sending", "completing", "stopping"].includes(turnRuntimeDisplayState(turn));
}

export function shouldProjectSubSessionEvent(event = "", data = {}) {
  return event === "subagent_message_event" &&
    data?.channelKind === "message_event" &&
    Number(data?.channelVersion) === 1 &&
    isMessageEventEnvelope(data?.event);
}

export function shouldProjectMainSessionEvent(event = "", data = {}) {
  return event === "message_event" &&
    data?.channelKind === "message_event" &&
    Number(data?.channelVersion) === 1 &&
    data?.route?.scope === "main_session" &&
    isMessageEventEnvelope(data?.event);
}

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
        // The send event, optimistic message and transport payload must share
        // one start instant. In particular, continue creates a fresh Turn scope,
        // so looking it up in the pre-existing timing index can return empty.
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
      const startFinalDoneSessionDetailOnce = (source = "") => {
        if (!finalDoneEventData || finalDoneDetailPromise) return finalDoneDetailPromise;
        logStateMachineDebug("stateMachine.done.finalize.before", {
          source,
          sessionId: finalDoneEventData.sessionId,
          dialogProcessId: finalDoneEventData.dialogProcessId,
          turnScopeId: finalDoneEventData.turnScopeId,
          botMessage: summarizeStateMachineMessage(botMsg),
        });
        finalDoneDetailPromise = finalizeDoneTurnPresentation({
          activeSession,
          activeSessionId,
          botMessage: botMsg,
          finalDoneEventData,
          fetchSessionDetail,
          applySessionDetail,
          applyAssistantFailureState,
          applyRunStateEvent,
          refreshSessionConnectorsAsync,
          logSessionEvent,
          completionSource: "realtimeDone",
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

      const streamOnce = (streamPayload) => chatWebSocketClient.stream(streamPayload, (incomingEnvelope) => {
        const { event, data } = normalizeTurnTransportEnvelope({
          ...(incomingEnvelope || {}),
          source: "realtime",
        });
        const authoritativeEvent = data?.event || {};
        const subProjectionChecks = {
          eventName: event === "subagent_message_event",
          channelKind: data?.channelKind === "message_event",
          channelVersion: Number(data?.channelVersion) === 1,
          envelopeKind: authoritativeEvent?.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND,
        };
        if (event === "subagent_message_event" || data?.route?.scope === "sub_session") {
          logSessionEvent({
            category: "debug",
            level: "debug",
            debugType: "workflow-diagnostics",
            event: "frontend.subagentMessage.projectionEvaluated",
            sessionId: data?.route?.rootSessionId || sessionId,
            dialogProcessId: authoritativeEvent?.dialogProcessId || data?.dialogProcessId || "",
            turnScopeId: authoritativeEvent?.turnScopeId || data?.turnScopeId || turnScopeId,
            data: {
              projected: Object.values(subProjectionChecks).every(Boolean),
              checks: subProjectionChecks,
              eventType: authoritativeEvent?.eventType || "",
              messageId: authoritativeEvent?.messageId || "",
              childSessionId: authoritativeEvent?.sessionId || data?.route?.sessionId || "",
              parentSessionId: authoritativeEvent?.parentSessionId || data?.route?.parentSessionId || "",
              workflowRunId: authoritativeEvent?.workflowRunId || "",
              nodeExecutionId: authoritativeEvent?.nodeExecutionId || "",
              hasContent: Boolean(authoritativeEvent?.content || authoritativeEvent?.delta || authoritativeEvent?.text),
              hasTool: Boolean(authoritativeEvent?.tool),
              hasResult: authoritativeEvent?.result !== undefined,
            },
          });
        }
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
        if (event === "workflow_node_state_committed") {
          logSessionEvent({
            category: "debug",
            level: "debug",
            debugType: "workflow-diagnostics",
            event: "frontend.workflowTransport.nodeStateReceived",
            sessionId: data?.parentSessionId || data?.sessionId || sessionId,
            dialogProcessId: data?.dialogProcessId || "",
            turnScopeId: data?.turnScopeId || turnScopeId,
            data: {
              workflowRunId: String(data?.workflowRunId || ""),
              nodeExecutionId: String(data?.nodeExecutionId || ""),
              status: String(data?.status || ""),
              revision: Number(data?.revision || 0),
              sequence: Number(data?.sequence || 0),
              dataKeys: Object.keys(data || {}).sort(),
            },
          });
          if (typeof applyWorkflowRuntimeEvent === "function") {
            applyWorkflowRuntimeEvent({
              event,
              data: data || {},
              transportSequence: Number(data?.seq || 0),
            }, { source: "live" });
          } else {
            upsertWorkflowNodeStateEvent?.(data || {});
          }
          return;
        }
        if (event === "workflow_planning_message_prepared") {
          logSessionEvent({
            category: "debug",
            level: "debug",
            debugType: "workflow-diagnostics",
            event: "frontend.workflowTransport.planningReceived",
            sessionId: data?.sessionId || sessionId,
            dialogProcessId: data?.dialogProcessId || "",
            turnScopeId: data?.turnScopeId || turnScopeId,
            data: {
              workflowRunId: String(data?.workflowRunId || ""),
              nodeSessionCount: Array.isArray(data?.nodeSessions) ? data.nodeSessions.length : 0,
              semanticTextLength: String(data?.semanticText || "").length,
              dataKeys: Object.keys(data || {}).sort(),
            },
          });
          if (typeof applyWorkflowRuntimeEvent === "function") {
            applyWorkflowRuntimeEvent({
              event,
              data: data || {},
              transportSequence: Number(data?.seq || 0),
            }, { source: "live" });
          } else {
            upsertWorkflowPlanningEvent?.(data || {});
          }
          return;
        }
        if (shouldProjectSubSessionEvent(event, data || {})) {
          // Explicit channel is a type proof. This layer does not inspect
          // message identity, workflow scope, or event semantics.
          const subSessionResult = typeof applyWorkflowRuntimeEvent === "function"
            ? applyWorkflowRuntimeEvent({
                event: "workflow_message_event",
                data: data.event || {},
                transportSequence: Number(data?.seq || 0),
              }, { source: "live" })
            : upsertSubSessionEvent?.(data.event?.eventType, data.event || {});
          logSessionEvent({
            category: "debug",
            level: "debug",
            debugType: "workflow-diagnostics",
            event: "frontend.workflowTransport.subSessionMessageReduced",
            sessionId: data.event?.sessionId || data.route?.subSessionId || "",
            dialogProcessId: data.event?.dialogProcessId || "",
            turnScopeId: data.event?.turnScopeId || "",
            data: {
              eventType: String(data.event?.eventType || ""),
              eventId: String(data.event?.eventId || ""),
              messageId: String(data.event?.messageId || ""),
              sequence: Number(data.event?.sequence || 0),
              applied: subSessionResult?.applied === true,
              reason: String(subSessionResult?.reason || ""),
              projectedMessageCount: Array.isArray(subSessionResult?.session?.messages)
                ? subSessionResult.session.messages.length
                : 0,
            },
          });
          return;
        }
        if (event === "subagent_message_event") {
          logSessionEvent({
            category: "debug",
            level: "warn",
            debugType: "workflow-diagnostics",
            event: "frontend.workflowTransport.subSessionMessageRejected",
            sessionId: data?.event?.sessionId || data?.route?.subSessionId || "",
            dialogProcessId: data?.event?.dialogProcessId || "",
            turnScopeId: data?.event?.turnScopeId || "",
            data: {
              channelKind: String(data?.channelKind || ""),
              channelVersion: Number(data?.channelVersion || 0),
              routeScope: String(data?.route?.scope || ""),
              hasEvent: Boolean(data?.event),
              eventKeys: Object.keys(data?.event || {}).sort(),
              packetKeys: Object.keys(data || {}).sort(),
            },
          });
          return;
        }
        if (shouldProjectMainSessionEvent(event, data || {})) {
          const messageEvent = data.event || {};
          const reduction = dispatchTurnEnvelope({
            targetMessage: botMsg,
            envelope: messageEvent,
            classifyRealtimeLog,
            source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
          });
          logSessionEvent({
            category: "transport",
            level: reduction.applied ? "debug" : "warn",
            event: "frontend.messageEvent.reduced",
            sessionId: messageEvent.sessionId || sessionId,
            dialogProcessId: messageEvent.dialogProcessId || "",
            turnScopeId: messageEvent.turnScopeId || turnScopeId,
            data: {
              source: "normal_live",
              eventId: messageEvent.eventId || "",
              eventType: messageEvent.eventType || "",
              messageId: messageEvent.messageId || "",
              sequence: messageEvent.sequence ?? null,
              result: reduction.result,
              errors: reduction.errors || [],
            },
          });
          if (reduction.applied) {
            navigateOnFirstResponseOnce?.();
            locateSendingStartedMessageOnce?.();
          }
          return;
        }
        const subSessionScopedEvent = data?.scope === "sub_session";
        if (subSessionScopedEvent || (typeof event === "string" && event.startsWith("subagent_"))) {
          // Legacy/lifecycle child events have no authority to create or alter
          // messages. They remain available to their dedicated state channels.
          return;
        }
        if (event === StreamEventEnum.TURN_LIFECYCLE) {
          const eventSessionId = normalizeTrimmedString(data?.sessionId);
          const mainSessionId = normalizeTrimmedString(
            activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId,
          );
          if (eventSessionId && mainSessionId && eventSessionId !== mainSessionId) {
            upsertSubSessionEvent?.(event, data || {});
            return;
          }
        }
        if (!isEventForCurrentTurn(data || {}, botMsg)) return;
        if (event === StreamEventEnum.TURN_LIFECYCLE) {
          applyRunStateEvent?.({
            ...data,
            type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
            source: "turn_lifecycle",
          });
          return;
        }
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
          if (["completed", "user_stopped", "error", "expired", "cancelled"].includes(channelState)) {
            const terminalNotice = buildFinalDoneEventData({ data, activeSession, botMessage: botMsg });
            // A channel terminal is only a notification. Route it through the
            // common coordinator; never settle messages or capabilities here.
            applyRunStateEvent?.({
              ...terminalNotice,
              type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
              state: channelState,
              backendState: channelState,
              source: "realtime_channel_terminal_notification",
            });
          }
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
            navigateOnFirstResponseOnce,
            activeSession,
            connectorTypeSet,
            upsertConnectedConnectorInPanelState,
            refreshSessionConnectorsAsync,
            mergeAssistantAttachments,
            makeViewMessage,
            locateSendingStartedMessageOnce,
          })
        ) {
          return;
        }
        if (event === StreamEventEnum.INTERACTION_REQUEST) {
          handleInteractionRequestStreamEvent({
            data,
            clearMissingInteractionPayloadTimer,
            navigateOnFirstResponseOnce,
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
          // DONE is a persisted-completion notification as well. Some servers
          // do not emit a separate terminal channel_state, so omitting this
          // trigger would leave those Turns permanently unresolved.
          applyRunStateEvent?.({
            ...finalDoneEventData,
            type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
            // Notification metadata only. The coordinator recognizes this as a
            // query trigger; no reducer lifecycle state is written here.
            backendState: "completed",
            source: "realtime_done_terminal_notification",
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
            navigateOnFirstResponseOnce,
            makeViewMessage,
            foldMessagesForView,
            mergeAssistantAttachments,
            locateDoneMessage,
            applyConversationState,
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
        // The websocket event is only a change notification. Re-read Session
        // detail for the historical message projection; runtime terminal state
        // is resolved separately by the authoritative terminal service.
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
