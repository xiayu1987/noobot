/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { StreamEventEnum } from "../../shared/constants/chatConstants";
import { mergeAttachmentMetas } from "../infra/dialogProcessChain";
import { useLocale } from "../../shared/i18n/useLocale";
import { createChatEngineConversationState } from "./chatEngine/conversationState";
import { buildChatPayload } from "./chatEngine/payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./chatEngine/sendFinalize";
import { prepareChatSend } from "./chatEngine/sendPrepare";
import { finalizeDoneSessionDetail } from "./chatEngine/sessionFinalize";
import {
  forceStopUiFinalize as finalizeForceStopUi,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./chatEngine/streamHandlers";
import { normalizeTrimmedString } from "./chatEngine/utils";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS = 3000;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS = 50;
const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export function useChatEngine({
  userId,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  locateDoneMessage,
  activeSession,
  activeSessionId,
  sending,
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
  ensureConnected,
  notify = () => {},
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    targetAssistantMessage.statusLabel = translate("chat.failed");
    targetAssistantMessage.error = String(errorMessage || "").trim();
    if (!String(targetAssistantMessage.content || "").trim()) {
      targetAssistantMessage.content = `> ${translate("chat.occurredError", {
        error: targetAssistantMessage.error || translate("chat.unknownError"),
      })}`;
    }
  }

  function mergeAssistantAttachmentMetas(targetAssistantMessage, attachmentMetas = []) {
    if (!targetAssistantMessage || !Array.isArray(attachmentMetas) || !attachmentMetas.length) {
      return;
    }
    const normalizedAttachmentMetas =
      makeViewMessage({ attachmentMetas })?.attachmentMetas || attachmentMetas;
    targetAssistantMessage.attachmentMetas = mergeAttachmentMetas(
      Array.isArray(targetAssistantMessage.attachmentMetas)
        ? targetAssistantMessage.attachmentMetas
        : [],
      normalizedAttachmentMetas,
    );
  }

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
    sending,
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

  function forceStopUiFinalize() {
    return finalizeForceStopUi({
      sending,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
    });
  }

  function stopSending() {
    return requestStopSending({
      sending,
      activeSession,
      chatWebSocketClient,
      onForceStopUiFinalize: forceStopUiFinalize,
    });
  }

  async function waitForSendingSettled({
    timeoutMs = monotonicActionStopTimeoutMs,
    pollIntervalMs = monotonicActionStopPollIntervalMs,
  } = {}) {
    if (!sending?.value) return true;
    const startedAt = Date.now();
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    const normalizedPollIntervalMs = Math.max(1, Number(pollIntervalMs) || 1);
    while (sending.value) {
      if (Date.now() - startedAt >= normalizedTimeoutMs) {
        return false;
      }
      await delay(normalizedPollIntervalMs);
    }
    return true;
  }

  async function prepareMonotonicMessageAction({ timeoutMs, pollIntervalMs } = {}) {
    if (!sending?.value) return true;
    stopSending();
    const settled = await waitForSendingSettled({ timeoutMs, pollIntervalMs });
    if (!settled) {
      const message = translate("chat.monotonicActionStopTimeout");
      notify({ type: "warning", message });
      throw new Error(message);
    }
    return true;
  }

  function isUserMessage(message = {}) {
    return normalizeTrimmedString(message?.role).toLowerCase() === "user";
  }

  function getDialogProcessId(message = {}) {
    return normalizeTrimmedString(message?.dialogProcessId || message?.dialogId);
  }

  function findMessageIndex(targetMessage = {}, messages = []) {
    const targetId = normalizeTrimmedString(targetMessage?.id || targetMessage?.messageId);
    const targetTs = targetMessage?.ts;
    const targetDialogProcessId = getDialogProcessId(targetMessage);
    const targetRole = normalizeTrimmedString(targetMessage?.role).toLowerCase();
    const targetContent = normalizeTrimmedString(targetMessage?.content);
    return messages.findIndex((message) => {
      if (message === targetMessage) return true;
      if (targetId && normalizeTrimmedString(message?.id || message?.messageId) === targetId) return true;
      if (targetTs !== undefined && message?.ts === targetTs) return true;
      if (
        targetDialogProcessId &&
        getDialogProcessId(message) === targetDialogProcessId &&
        (!targetRole || normalizeTrimmedString(message?.role).toLowerCase() === targetRole)
      ) return true;
      return Boolean(
        targetRole &&
        targetContent &&
        normalizeTrimmedString(message?.role).toLowerCase() === targetRole &&
        normalizeTrimmedString(message?.content) === targetContent,
      );
    });
  }

  function resolveMonotonicUserTarget(targetMessage = {}) {
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!targetMessage || typeof targetMessage !== "object") return null;
    if (isUserMessage(targetMessage)) return targetMessage;

    const directIndex = findMessageIndex(targetMessage, messages);
    if (directIndex >= 0 && isUserMessage(messages[directIndex])) {
      return messages[directIndex];
    }

    const targetDialogProcessId = getDialogProcessId(targetMessage);
    if (targetDialogProcessId) {
      const sameDialogProcessUserMessage = messages.find(
        (message) => isUserMessage(message) && getDialogProcessId(message) === targetDialogProcessId,
      );
      if (sameDialogProcessUserMessage) return sameDialogProcessUserMessage;
    }

    const targetIndex = directIndex;
    if (targetIndex >= 0) {
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        if (isUserMessage(messages[index])) return messages[index];
      }
    }

    return null;
  }

  function findMessageCascadeStartIndex(targetMessage = {}) {
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!isUserMessage(targetMessage)) return -1;
    return findMessageIndex(targetMessage, messages);
  }

  function createRemovedTurnPredicate(anchorMessage = {}, removedMessages = []) {
    const anchorId = normalizeTrimmedString(anchorMessage?.id || anchorMessage?.messageId);
    const anchorTs = anchorMessage?.ts;
    const anchorDialogProcessId = getDialogProcessId(anchorMessage);
    const anchorContent = normalizeTrimmedString(anchorMessage?.content);
    const anchorRole = normalizeTrimmedString(anchorMessage?.role).toLowerCase();
    const removedIds = new Set(
      removedMessages
        .map((message) => normalizeTrimmedString(message?.id || message?.messageId))
        .filter(Boolean),
    );
    const removedDialogProcessIds = new Set(
      removedMessages
        .map((message) => getDialogProcessId(message))
        .filter(Boolean),
    );
    return (message = {}) => {
      if (message === anchorMessage) return true;
      const messageId = normalizeTrimmedString(message?.id || message?.messageId);
      if (messageId && (messageId === anchorId || removedIds.has(messageId))) return true;
      if (anchorTs !== undefined && message?.ts === anchorTs) return true;
      const messageDialogProcessId = getDialogProcessId(message);
      if (
        messageDialogProcessId &&
        (messageDialogProcessId === anchorDialogProcessId || removedDialogProcessIds.has(messageDialogProcessId))
      ) return true;
      return Boolean(
        anchorRole &&
        anchorContent &&
        normalizeTrimmedString(message?.role).toLowerCase() === anchorRole &&
        normalizeTrimmedString(message?.content) === anchorContent
      );
    };
  }

  function createStableRemovedTurnPredicate(anchorMessage = {}, removedMessages = []) {
    const anchorId = normalizeTrimmedString(anchorMessage?.id || anchorMessage?.messageId);
    const anchorTs = anchorMessage?.ts;
    const anchorDialogProcessId = getDialogProcessId(anchorMessage);
    const removedIds = new Set(
      removedMessages
        .map((message) => normalizeTrimmedString(message?.id || message?.messageId))
        .filter(Boolean),
    );
    const removedDialogProcessIds = new Set(
      removedMessages
        .map((message) => getDialogProcessId(message))
        .filter(Boolean),
    );
    return (message = {}) => {
      if (message === anchorMessage) return true;
      const messageId = normalizeTrimmedString(message?.id || message?.messageId);
      if (messageId && (messageId === anchorId || removedIds.has(messageId))) return true;
      if (anchorTs !== undefined && message?.ts === anchorTs) return true;
      const messageDialogProcessId = getDialogProcessId(message);
      return Boolean(
        messageDialogProcessId &&
        (messageDialogProcessId === anchorDialogProcessId || removedDialogProcessIds.has(messageDialogProcessId))
      );
    };
  }

  function createFinalRemovedTurnPredicate(anchorMessage = {}, removedMessages = []) {
    const anchorId = normalizeTrimmedString(anchorMessage?.id || anchorMessage?.messageId);
    const anchorTs = anchorMessage?.ts;
    const removedIds = new Set(
      removedMessages
        .map((message) => normalizeTrimmedString(message?.id || message?.messageId))
        .filter(Boolean),
    );
    const removedTsValues = new Set(
      removedMessages
        .map((message) => message?.ts)
        .filter((value) => value !== undefined && value !== null),
    );
    const removedReferences = new Set(removedMessages.filter(Boolean));
    return (message = {}) => {
      if (message === anchorMessage || removedReferences.has(message)) return true;
      const messageId = normalizeTrimmedString(message?.id || message?.messageId);
      if (messageId && (messageId === anchorId || removedIds.has(messageId))) return true;
      if (anchorTs !== undefined && anchorTs !== null && message?.ts === anchorTs) return true;
      return removedTsValues.has(message?.ts);
    };
  }

  function pruneStaleMessagesAfterResend(
    anchorMessage = {},
    originalStartIndex = -1,
    removedMessages = [],
    options = {},
  ) {
    const session = activeSession.value;
    if (!session || originalStartIndex < 0) return false;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const isRemovedTurnMessage = createRemovedTurnPredicate(anchorMessage, removedMessages);
    const finalOnly = options.finalOnly === true;
    const isStableRemovedTurnMessage = finalOnly
      ? createFinalRemovedTurnPredicate(anchorMessage, removedMessages)
      : createStableRemovedTurnPredicate(anchorMessage, removedMessages);
    const findAppendedResendStartIndex = (sourceMessages = []) => {
      if (!Array.isArray(sourceMessages) || sourceMessages.length <= originalStartIndex) return -1;
      for (let index = originalStartIndex; index < sourceMessages.length; index += 1) {
        const message = sourceMessages[index];
        if (isUserMessage(message) && !isRemovedTurnMessage(message)) {
          return index;
        }
      }
      return -1;
    };
    const pruneMessages = (sourceMessages = []) => {
      const appendedResendStartIndex = findAppendedResendStartIndex(sourceMessages);
      const kept = [];
      let changed = false;
      sourceMessages.forEach((message, index) => {
        if (
          index >= originalStartIndex &&
          (
            appendedResendStartIndex < 0 ||
            index < appendedResendStartIndex ||
            isStableRemovedTurnMessage(message)
          ) &&
          (finalOnly ? isStableRemovedTurnMessage(message) : isRemovedTurnMessage(message))
        ) {
          changed = true;
          return;
        }
        kept.push(message);
      });
      return { kept, changed };
    };
    const messagesResult = pruneMessages(messages);
    if (messagesResult.changed) session.messages = messagesResult.kept;
    let rawMessagesChanged = false;
    if (Array.isArray(session.rawMessages)) {
      const rawMessagesResult = pruneMessages(session.rawMessages);
      if (rawMessagesResult.changed) session.rawMessages = rawMessagesResult.kept;
      rawMessagesChanged = rawMessagesResult.changed;
    }
    if (messagesResult.changed || rawMessagesChanged) {
      syncSessionMessageSummary(session);
      clearPendingInteraction?.();
    }
    return messagesResult.changed || rawMessagesChanged;
  }

  function removeMessageFromListByReference(messages = [], targetMessage = null) {
    if (!Array.isArray(messages) || !targetMessage) return { kept: messages, removed: false };
    let removed = false;
    const kept = messages.filter((message) => {
      if (message === targetMessage) {
        removed = true;
        return false;
      }
      return true;
    });
    return { kept, removed };
  }

  function buildMonotonicMessageAnchor(targetMessage = {}) {
    const messageId = normalizeTrimmedString(targetMessage?.id || targetMessage?.messageId);
    if (messageId) return { messageId };
    const dialogProcessId = normalizeTrimmedString(
      targetMessage?.dialogProcessId || targetMessage?.dialogId,
    );
    if (dialogProcessId) return { dialogProcessId };
    if (targetMessage?.ts !== undefined && targetMessage?.ts !== null) {
      return { ts: targetMessage.ts };
    }
    return {};
  }

  function normalizeSessionDetailSnapshot(payload = {}, fallbackSessionId = "") {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    if (Array.isArray(source.sessions) && String(source.sessionId || "").trim()) {
      return source;
    }
    const session = source.session && typeof source.session === "object" && !Array.isArray(source.session)
      ? source.session
      : source.messages && Array.isArray(source.messages)
        ? source
        : null;
    if (!session) return null;
    const sessionId = normalizeTrimmedString(session.sessionId || source.sessionId || fallbackSessionId);
    if (!sessionId) return null;
    return {
      ...source,
      sessionId,
      sessions: [
        {
          ...session,
          sessionId: normalizeTrimmedString(session.sessionId || sessionId),
        },
      ],
    };
  }

  function syncSessionMessageSummary(session) {
    if (!session) return;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    session.messageCount = messages.length;
    session.lastMessage = messages.length ? messages[messages.length - 1] : null;
    session.updatedAt = new Date().toISOString();
  }

  function cascadeDeleteMessagesFrom(targetMessage = {}) {
    const session = activeSession.value;
    if (!session) return false;
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const startIndex = findMessageCascadeStartIndex(userTargetMessage);
    if (startIndex < 0) return false;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const removedMessages = messages.slice(startIndex);
    session.messages = messages.slice(0, startIndex);
    if (Array.isArray(session.rawMessages)) {
      const rawStartIndex = findMessageIndex(userTargetMessage, session.rawMessages);
      if (rawStartIndex >= 0) {
        session.rawMessages = session.rawMessages.slice(0, rawStartIndex);
      } else {
        const removedSet = new Set(removedMessages);
        session.rawMessages = session.rawMessages.filter((message) => !removedSet.has(message));
        if (session.rawMessages.length > session.messages.length) {
          session.rawMessages = session.rawMessages.slice(0, session.messages.length);
        }
      }
    }
    syncSessionMessageSummary(session);
    clearPendingInteraction?.();
    return true;
  }

  async function deleteMonotonicMessage(targetMessage = {}, options = {}) {
    await prepareMonotonicMessageAction(options);
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    if (typeof deleteSessionMessagesFromApi === "function") {
      const sessionId = normalizeTrimmedString(
        activeSession.value?.backendSessionId || activeSessionId.value,
      );
      const result = await deleteSessionMessagesFromApi({
        userId: userId?.value || userId,
        sessionId,
        parentSessionId: normalizeTrimmedString(activeSession.value?.parentSessionId),
        anchor: buildMonotonicMessageAnchor(userTargetMessage),
        expectedVersion: activeSession.value?.version ?? activeSession.value?.revision,
      }, { fetcher: authFetch });
      const payload = typeof result?.json === "function" ? await result.json() : result;
      if (result?.ok === false || payload?.ok === false) return false;
      const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
      if (!sessionDetail) return false;
      applySessionDetail?.(sessionDetail, { preserveCurrentMessages: false });
      clearPendingInteraction?.();
      return true;
    }
    return cascadeDeleteMessagesFrom(userTargetMessage);
  }

  async function resendMonotonicMessage(targetMessage = {}, editedContent = "", options = {}) {
    const text = String(editedContent || "").trim();
    if (!text) return false;
    await prepareMonotonicMessageAction(options);
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const session = activeSession.value;
    const previousMessages = Array.isArray(session?.messages) ? [...session.messages] : null;
    const previousRawMessages = Array.isArray(session?.rawMessages) ? [...session.rawMessages] : null;
    const previousMessageCount = session?.messageCount;
    const previousLastMessage = session?.lastMessage;
    const previousUpdatedAt = session?.updatedAt;
    const previousInput = input.value;
    const originalCascadeStartIndex = findMessageCascadeStartIndex(userTargetMessage);
    const removedMessagesBeforeResend = Array.isArray(session?.messages) && originalCascadeStartIndex >= 0
      ? session.messages.slice(originalCascadeStartIndex)
      : [];
    const deleted = await deleteMonotonicMessage(userTargetMessage, { ...options, timeoutMs: 0 });
    if (!deleted) return false;
    if (session) {
      session.pendingResendStalePrune = {
        anchorMessage: userTargetMessage,
        originalStartIndex: originalCascadeStartIndex,
        removedMessages: removedMessagesBeforeResend,
      };
      pruneStaleMessagesAfterResend(
        userTargetMessage,
        originalCascadeStartIndex,
        removedMessagesBeforeResend,
      );
    }
    input.value = text;
    const sent = await send();
    if (session?.pendingResendStalePrune) delete session.pendingResendStalePrune;
    if (!sent) {
      if (session && previousMessages && previousRawMessages) {
        session.messages = previousMessages;
        session.rawMessages = previousRawMessages;
        session.messageCount = previousMessageCount;
        session.lastMessage = previousLastMessage;
        session.updatedAt = previousUpdatedAt;
      }
      input.value = previousInput;
      return false;
    }
    return true;
  }

  async function send() {
    if (!ensureConnected()) return false;
    if (sending.value || !activeSession.value) return false;
    if (!input.value.trim() && uploadFiles.value.length === 0) return false;

    sending.value = true;
    const {
      text,
      filesToSend,
      userMessage,
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
    });

    let lastStreamErrorEventData = null;
    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;
      const requestedTextStreaming = streamOutput?.value !== false;

      const payload = buildChatPayload({
        userId,
        activeSession,
        message: text,
        attachments,
        allowUserInteraction,
        forceTool,
        requestedTextStreaming,
        botScenario,
        selectedModel,
        pluginModelConfig,
        locale,
        selectedPlugins,
        uploadHint: translate("chat.uploadHint"),
      });

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
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
            mergeAssistantAttachmentMetas,
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
          finalDoneEventData = data || {};
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
            mergeAssistantAttachmentMetas,
            locateDoneMessage,
          });
        }
      });

      // Safety net: if terminal channel_state is delayed/lost, avoid sticky "stop" UI.
      // Primary source of truth remains channel_state; this fallback only runs when
      // stream is already ended and UI is still in-flight.
      applyStreamCompletedFallback({
        sending,
        finalDoneEventData,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
      });

      if (
        applyStopRequestedState({
          chatWebSocketClient,
          activeSession,
          botMessage: botMsg,
          applyConversationState,
        })
      ) {
        return;
      }

      await finalizeDoneSessionDetail({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData,
        fetchSessionDetail,
        applySessionDetail,
        refreshSessionConnectorsAsync,
      });
      if (activeSession.value?.pendingResendStalePrune) {
        pruneStaleMessagesAfterResend(
          activeSession.value.pendingResendStalePrune.anchorMessage,
          activeSession.value.pendingResendStalePrune.originalStartIndex,
          activeSession.value.pendingResendStalePrune.removedMessages,
          { finalOnly: true },
        );
        delete activeSession.value.pendingResendStalePrune;
      }
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
        return false;
      }
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
      await finalizeDoneSessionDetail({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData: lastStreamErrorEventData || error?.data || null,
        fetchSessionDetail,
        applySessionDetail,
        refreshSessionConnectorsAsync,
      });
      return false;
    } finally {
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposeConversationState();
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
  };
}
