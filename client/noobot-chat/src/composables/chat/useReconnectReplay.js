/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  isCurrentActiveSessionId,
  promoteSessionIdentityToBackendId,
} from "../infra/sessionIdentity";
import { getCurrentScope, onScopeDispose } from "vue";
import {
  collectReconnectDeltaText,
  findLatestPendingAssistantAfterLastUser,
  findRecoverableReconnectSessionId,
  findReconnectDoneEnvelopeWithMessages,
  findReusableMessageObject,
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isDialogProcessRecoverable,
  isPendingInteractionReplay,
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
  resolveDialogProcessIdFromReplay,
  splitReconnectMessagesByDialogProcessId,
} from "../infra/reconnectReplayModel";
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
import {
  normalizeInteractionRequestPayload,
  resolveConnectorStatusPayload,
} from "./interactionPayload";

export function useReconnectReplay({
  sessions,
  activeSession,
  activeSessionId,
  sending,
  interactionSubmitting,
  chatList,
  chatWebSocketClient,
  appendMessage,
  makeViewMessage,
  foldMessagesForView,
  applyCompletedToolLogsToMessages,
  sessionTitleFromMessages,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  isInteractionRequestHandled,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  classifyRealtimeLog,
  scrollBottom,
  translate,
  onConversationState,
  notify = () => {},
} = {}) {
  const replayCache = {};
  const appliedReconnectSeqByDialogProcessId = {};
  const terminalDialogProcessIdSet = new Set();
  let cacheExpiredRefreshTimer = null;
  let replayHydrationPromise = null;

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

  function emitSyntheticErrorConversationState({
    sessionId = "",
    dialogProcessId = "",
    sourceEvent = "",
  } = {}) {
    if (typeof onConversationState !== "function") return;
    onConversationState({
      source: "reconnect",
      state: "error",
      sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      sourceEvent: String(sourceEvent || "").trim(),
      seq: 0,
      applied: true,
    });
  }

  function isCurrentActiveSession(sessionId = "") {
    return isCurrentActiveSessionId({
      sessionId,
      activeSession: activeSession.value,
      activeSessionId: activeSessionId.value,
    });
  }

  async function ensureReconnectSessionActive(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || isCurrentActiveSession(normalizedSessionId)) return true;
    const targetSession = findSessionByAnyIdInList(sessions.value, normalizedSessionId);
    if (!targetSession) {
      await chatList.fetchSessions(normalizedSessionId, {
        silent: true,
        preserveCurrentMessages: true,
      });
    }
    const resolvedTargetSession = findSessionByAnyIdInList(
      sessions.value,
      normalizedSessionId,
    );
    if (!resolvedTargetSession) return false;
    await chatList.selectSession(resolvedTargetSession.id, {
      force: true,
      silent: true,
      preserveCurrentMessages: true,
    });
    return isCurrentActiveSession(normalizedSessionId);
  }

  async function applyReconnectData(reconnectData) {
    const reconnectSessions = Array.isArray(reconnectData?.sessions)
      ? reconnectData.sessions
      : [];
    const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
    if (recoverableSessionId) {
      await ensureReconnectSessionActive(recoverableSessionId);
      sending.value = true;
      const recoverableSessionEntry = reconnectSessions.find(
        (sessionEntry) =>
          String(sessionEntry?.sessionId || "").trim() === recoverableSessionId,
      );
      const recoverableDialogProcesses = Array.isArray(
        recoverableSessionEntry?.dialogProcesses,
      )
        ? recoverableSessionEntry.dialogProcesses
        : [];
      const hasReconnectMessages = recoverableDialogProcesses.some(
        (dialogProcess) =>
          Array.isArray(dialogProcess?.messages) && dialogProcess.messages.length,
      );
      if (!hasReconnectMessages && isCurrentActiveSession(recoverableSessionId)) {
        resolveReconnectTargetAssistantMessage("", { allowCreate: true });
      }
    }

    for (const sessionEntry of reconnectSessions) {
      const sessionId = String(sessionEntry?.sessionId || "").trim();
      if (!sessionId) continue;
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      for (const dp of dialogProcesses) {
        const dpMessages = Array.isArray(dp?.messages) ? dp.messages : [];
        if (!dpMessages.length) continue;
        for (const replayGroup of splitReconnectMessagesByDialogProcessId(
          dpMessages,
          dp?.dialogProcessId || "",
        )) {
          const messages = replayGroup.messages;
          const dpId = resolveDialogProcessIdFromReplay(
            messages,
            replayGroup.dialogProcessId || dp?.dialogProcessId || "",
          );
          if (!messages.length) continue;
          if (!isCurrentActiveSession(sessionId)) {
            const replayKey = dpId || `__unknown_${Date.now()}_${Math.random()}`;
            if (!replayCache[sessionId]) replayCache[sessionId] = {};
            replayCache[sessionId][replayKey] = messages;
          } else {
            await applyReconnectMessagesToActiveSession(messages, dpId, {
              allowCreate: isDialogProcessRecoverable(sessionEntry, messages),
            });
          }
        }
      }
    }

    reconnectSessions.forEach((sessionEntry) => {
      const stateEntries = Array.isArray(sessionEntry?.conversationStates)
        ? sessionEntry.conversationStates
        : [];
      stateEntries.forEach((stateEntry) => {
        applyChannelState(stateEntry);
      });
    });

    if (reconnectData?.cacheExpired) {
      scheduleCacheExpiredSessionRefresh();
    }
  }

  function isInFlightConversationState(state = "") {
    return ["sending", "interaction_pending", "stopping", "reconnecting"].includes(
      String(state || "").trim(),
    );
  }

  function isTerminalConversationState(state = "") {
    return ["stopped", "completed", "error", "no_conversation", "expired"].includes(
      String(state || "").trim(),
    );
  }

  function applyChannelState(stateData = {}) {
    const sessionId = String(stateData?.sessionId || "").trim();
    const forActiveSession = !sessionId || isCurrentActiveSession(sessionId);
    if (typeof onConversationState === "function") {
      onConversationState({
        source: "reconnect",
        state: String(stateData?.state || "").trim(),
        sessionId,
        dialogProcessId: String(stateData?.dialogProcessId || "").trim(),
        sourceEvent: String(stateData?.sourceEvent || "").trim(),
        seq: Number(stateData?.seq || 0),
        applied: forActiveSession,
      });
    }
    if (!forActiveSession) return;
    const state = String(stateData?.state || "").trim();
    const dialogProcessId = String(stateData?.dialogProcessId || "").trim();
    const targetAssistantMessage = findAssistantMessageByDialogProcessId(dialogProcessId);
    if (isInFlightConversationState(state)) {
      sending.value = true;
      if (
        state === "sending" &&
        String(stateData?.sourceEvent || "").trim().toLowerCase() === "interaction_response" &&
        typeof clearPendingInteractionIfObsolete === "function"
      ) {
        clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
      }
      if (state === "interaction_pending") {
        interactionSubmitting.value = false;
        const pendingInteractionPayload =
          stateData?.pendingInteraction && typeof stateData.pendingInteraction === "object"
            ? stateData.pendingInteraction
            : null;
        if (pendingInteractionPayload) {
          const interactionRequest = normalizeInteractionRequestPayload({
            ...pendingInteractionPayload,
            interactionType: String(pendingInteractionPayload?.interactionType || "").trim(),
          });
          if (!isInteractionRequestHandled(interactionRequest)) {
            setPendingInteractionRequest(interactionRequest);
          }
        } else {
          sending.value = false;
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const missingInteractionError = translate("chat.interactionPayloadMissing");
          const fallbackAssistantMessage =
            targetAssistantMessage ||
            findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []);
          applyAssistantFailureState(fallbackAssistantMessage, missingInteractionError);
          emitSyntheticErrorConversationState({
            sessionId,
            dialogProcessId,
            sourceEvent: "interaction_payload_missing",
          });
          notify({ type: "error", message: missingInteractionError });
          return;
        }
      }
      if (targetAssistantMessage) {
        targetAssistantMessage.pending = true;
        if (state === "stopping") {
          targetAssistantMessage.statusLabel = translate("chat.stopping");
        } else if (state === "reconnecting") {
          targetAssistantMessage.statusLabel = translate("chat.reconnecting");
        } else if (state === "sending") {
          targetAssistantMessage.statusLabel = "";
        }
      }
      return;
    }
    if (isTerminalConversationState(state)) {
      if (dialogProcessId) {
        terminalDialogProcessIdSet.add(dialogProcessId);
      }
      chatWebSocketClient.clearStopRequested();
      interactionSubmitting.value = false;
      if (state === "expired") {
        scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
      }
      sending.value = false;
      if (
        state === "completed" ||
        state === "stopped" ||
        state === "error" ||
        state === "no_conversation" ||
        state === "expired"
      ) {
        if (typeof clearPendingInteractionIfObsolete === "function") {
          clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
        }
      }
      if (state === "no_conversation" || state === "expired") {
        clearPendingInteraction();
        interactionSubmitting.value = false;
        if (targetAssistantMessage) {
          targetAssistantMessage.pending = false;
        }
        return;
      }
      if (targetAssistantMessage) {
        targetAssistantMessage.pending = false;
        if (state === "completed") {
          targetAssistantMessage.statusLabel = translate("chat.generated");
        } else if (state === "stopped") {
          targetAssistantMessage.statusLabel = translate("chat.stopped");
        } else if (state === "error") {
          targetAssistantMessage.statusLabel = translate("chat.failed");
        }
      }
    }
  }

  function resolveReconnectTargetAssistantMessage(
    dialogProcessId = "",
    { allowCreate = true } = {},
  ) {
    if (!activeSession.value) return null;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const messageList = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const matchedAssistantMessage = messageList.find(
      (messageItem) =>
        normalizedDpId &&
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
    );
    if (matchedAssistantMessage) {
      return matchedAssistantMessage.pending ? matchedAssistantMessage : null;
    }

    const latestPendingAssistant = findLatestPendingAssistantAfterLastUser(messageList);
    if (latestPendingAssistant) {
      const latestPendingDpId = String(latestPendingAssistant?.dialogProcessId || "").trim();
      // Never write a replay for dialogProcess A into a pending assistant that
      // already belongs to dialogProcess B. That is the main cause of replay
      // touching the previous turn.
      if (normalizedDpId && latestPendingDpId && latestPendingDpId !== normalizedDpId) {
        return null;
      }
      if (normalizedDpId && !latestPendingDpId) {
        latestPendingAssistant.dialogProcessId = normalizedDpId;
      }
      return latestPendingAssistant;
    }
    if (!allowCreate) return null;
    const appendedMessage = appendMessage(RoleEnum.ASSISTANT, "");
    appendedMessage.pending = true;
    appendedMessage.statusLabel = "";
    if (normalizedDpId) {
      appendedMessage.dialogProcessId = normalizedDpId;
    }
    return appendedMessage;
  }

  function scheduleCacheExpiredSessionRefresh({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    if (cacheExpiredRefreshTimer) clearTimeout(cacheExpiredRefreshTimer);
    cacheExpiredRefreshTimer = setTimeout(() => {
      cacheExpiredRefreshTimer = null;
      Object.keys(replayCache).forEach((sessionKey) => {
        delete replayCache[sessionKey];
      });
      Promise.resolve(
        chatList.fetchSessions(String(activeSessionId.value || ""), {
          silent: true,
          preserveCurrentMessages: true,
        }),
      )
        .then((ok) => {
          if (ok !== false) return;
          sending.value = false;
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          const fallbackAssistantMessage =
            targetAssistantMessage ||
            findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []);
          applyAssistantFailureState(fallbackAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: String(sessionId || activeSession.value?.id || "").trim(),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        })
        .catch(() => {
          sending.value = false;
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          const fallbackAssistantMessage =
            targetAssistantMessage ||
            findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []);
          applyAssistantFailureState(fallbackAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: String(sessionId || activeSession.value?.id || "").trim(),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        });
    }, 1200);
  }

  function normalizeReplayCacheKey(dialogProcessId = "", sessionId = "") {
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (normalizedDpId) return normalizedDpId;
    const normalizedSessionId = String(sessionId || "").trim();
    return normalizedSessionId ? `__session__${normalizedSessionId}` : "__session__unknown";
  }

  async function consumeReplayCacheForSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    const sessionReplayCache = replayCache[normalizedSessionId];
    if (!sessionReplayCache) return;
    const replayGroups = Object.entries(sessionReplayCache);
    delete replayCache[normalizedSessionId];
    for (const [replayKey, replayMessages] of replayGroups) {
      const dialogProcessId = String(replayKey || "").startsWith("__session__")
        ? ""
        : String(replayKey || "");
      await applyReconnectMessagesToActiveSession(replayMessages, dialogProcessId);
    }
  }

  function markReconnectSequenceApplied(dialogProcessId = "", sequence = 0) {
    const normalizedDpId = String(dialogProcessId || "").trim();
    const normalizedSequence = Number(sequence || 0);
    if (!normalizedDpId || normalizedSequence <= 0) return;
    const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId[normalizedDpId] || 0);
    if (normalizedSequence > lastAppliedSeq) {
      appliedReconnectSeqByDialogProcessId[normalizedDpId] = normalizedSequence;
    }
  }

  function findAssistantMessageByDialogProcessId(dialogProcessId = "") {
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!normalizedDpId || !activeSession.value) return null;
    return (activeSession.value.messages || []).find(
      (messageItem) =>
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
    ) || null;
  }

  function hasAssistantMessageWithContent(content = "") {
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent || !activeSession.value) return false;
    return (activeSession.value.messages || []).some(
      (messageItem) =>
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.content || "").trim() === normalizedContent,
    );
  }

  function applyFoldedMessagesToActiveSession(foldedMessages = []) {
    if (!activeSession.value) return [];
    const existingMessages = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const nextMessages = mergeCurrentUserMessagesIntoFoldedMessages({
      foldedMessages,
      existingMessages,
    }).map((nextMessage) => {
      const reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
      return reusableMessage
        ? patchMessageObjectPreservingUiState(reusableMessage, nextMessage)
        : nextMessage;
    });
    if (activeSession.value.messages !== existingMessages) {
      activeSession.value.messages = existingMessages;
    }
    existingMessages.splice(0, existingMessages.length, ...nextMessages);
    return existingMessages;
  }

  function applyFoldedMessagesForDialogProcess(foldedMessages = [], dialogProcessId = "") {
    if (!activeSession.value) return [];
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!normalizedDpId) return applyFoldedMessagesToActiveSession(foldedMessages);
    const existingMessages = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const assistantMessagesForDialogProcess = (Array.isArray(foldedMessages) ? foldedMessages : [])
      .filter(
        (messageItem) =>
          String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
          String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
      );
    if (!assistantMessagesForDialogProcess.length) return existingMessages;

    for (const nextMessage of assistantMessagesForDialogProcess) {
      let reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
      if (!reusableMessage) {
        reusableMessage = findLatestPendingAssistantAfterLastUser(existingMessages);
        if (reusableMessage && String(reusableMessage?.dialogProcessId || "").trim()) {
          reusableMessage = null;
        }
      }
      if (reusableMessage) {
        reusableMessage.dialogProcessId = normalizedDpId;
        patchMessageObjectPreservingUiState(reusableMessage, nextMessage);
        continue;
      }
      existingMessages.push(nextMessage);
    }
    return existingMessages;
  }

  function hasReconnectInFlightEvent(messages = []) {
    return (Array.isArray(messages) ? messages : []).some((envelope) => {
      const eventName = String(envelope?.event || "").trim();
      return (
        eventName === StreamEventEnum.DELTA ||
        eventName === StreamEventEnum.THINKING ||
        eventName === StreamEventEnum.INTERACTION_REQUEST
      );
    });
  }

  function createFinalAssistantFromReconnectReplay(messages = [], dialogProcessId = "") {
    if (!activeSession.value) return null;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const replayText =
      collectReconnectDeltaText(messages) ||
      String(
        [...(Array.isArray(messages) ? messages : [])]
          .reverse()
          .find((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.DONE)
          ?.data?.answer || "",
      );
    if (!String(replayText || "").trim()) return null;

    const existingAssistantMessage = findAssistantMessageByDialogProcessId(normalizedDpId);
    const targetAssistantMessage = existingAssistantMessage ||
      (hasAssistantMessageWithContent(replayText)
        ? null
        : appendMessage(RoleEnum.ASSISTANT, replayText));
    if (!targetAssistantMessage) return null;

    const currentContent = String(targetAssistantMessage?.content || "");
    if (!currentContent.trim()) {
      targetAssistantMessage.content = replayText;
    } else if (!currentContent.includes(replayText) && !replayText.includes(currentContent)) {
      targetAssistantMessage.content = `${currentContent}${replayText}`;
    }

    if (normalizedDpId) targetAssistantMessage.dialogProcessId = normalizedDpId;
    const errorEnvelope = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.ERROR);
    if (errorEnvelope) {
      targetAssistantMessage.error = String(errorEnvelope?.data?.error || "");
    }
    return targetAssistantMessage;
  }

  function applyDoneMessagesFromReconnect(eventData = {}) {
    if (!activeSession.value) return false;
    const sessionMessages = Array.isArray(eventData?.messages) ? eventData.messages : [];
    if (!sessionMessages.length) return false;
    const returnedSessionId = String(eventData?.sessionId || "").trim();
    if (returnedSessionId) {
      const promotionResult = promoteSessionIdentityToBackendId({
        sessionItem: activeSession.value,
        backendSessionId: returnedSessionId,
        activeSessionId: activeSessionId.value,
      });
      activeSessionId.value = promotionResult.nextActiveSessionId;
    }
    activeSession.value.loaded = true;
    activeSession.value.rawMessages = sessionMessages.map((messageItem) =>
      makeViewMessage(messageItem),
    );
    const foldedSessionMessages = foldMessagesForView(sessionMessages);
    const doneDialogProcessId = String(eventData?.dialogProcessId || "").trim();
    if (
      doneDialogProcessId &&
      Array.isArray(activeSession.value.messages) &&
      activeSession.value.messages.length
    ) {
      // DONE snapshots may contain the whole conversation. During reconnect we
      // should only finalize the dialog process that emitted DONE; patching the
      // entire folded history can mutate/remount the previous assistant message.
      applyFoldedMessagesForDialogProcess(foldedSessionMessages, doneDialogProcessId);
    } else {
      applyFoldedMessagesToActiveSession(foldedSessionMessages);
    }
    applyCompletedToolLogsToMessages(
      activeSession.value.messages,
      activeSession.value.sessionDocs || [],
    );
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = activeSession.value.messages.length
      ? activeSession.value.messages[activeSession.value.messages.length - 1]
      : null;
    activeSession.value.title = sessionTitleFromMessages(
      activeSession.value.messages,
      activeSession.value.title || returnedSessionId.slice(0, 8),
    );
    activeSession.value.updatedAt = new Date().toISOString();
    return true;
  }

  function shouldHydrateSessionBeforeReplay(messages = [], dialogProcessId = "", allowCreate = true) {
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!allowCreate || !normalizedDpId || !activeSession.value) return false;
    if (findAssistantMessageByDialogProcessId(normalizedDpId)) return false;
    const messageList = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    if (findLatestPendingAssistantAfterLastUser(messageList)) return false;
    const lastMessage = messageList.length ? messageList[messageList.length - 1] : null;
    if (String(lastMessage?.role || "").trim() === RoleEnum.USER) return false;
    return (Array.isArray(messages) ? messages : []).some((envelope) => {
      const eventName = String(envelope?.event || "").trim();
      return eventName === StreamEventEnum.DELTA || eventName === StreamEventEnum.THINKING;
    });
  }

  async function renderActiveSessionBeforeReplay() {
    if (!activeSession.value) return false;
    if (replayHydrationPromise) return replayHydrationPromise;
    const backendSessionId = String(
      activeSession.value?.backendSessionId || activeSessionId.value || "",
    ).trim();
    if (
      !backendSessionId ||
      typeof chatList?.fetchSessionDetail !== "function" ||
      typeof chatList?.applySessionDetail !== "function"
    ) {
      return false;
    }
    replayHydrationPromise = (async () => {
      try {
        const detail = await chatList.fetchSessionDetail(backendSessionId);
        chatList.applySessionDetail(detail, { preserveCurrentMessages: false });
        return true;
      } catch (error) {
        console.warn("Reconnect replay pre-render session failed:", error);
        return false;
      } finally {
        replayHydrationPromise = null;
      }
    })();
    return replayHydrationPromise;
  }

  async function applyReconnectMessagesToActiveSession(
    messages,
    dialogProcessId,
    { allowCreate = true } = {},
  ) {
    if (!activeSession.value) return;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId[normalizedDpId] || 0);
    const nextMessages = (Array.isArray(messages) ? messages : []).filter((envelope) => {
      if (isPendingInteractionReplay(envelope)) return true;
      const sequence = getReconnectEnvelopeSequence(envelope);
      return !sequence || sequence > lastAppliedSeq;
    });
    if (!nextMessages.length) return;
    const maxSequence = getReconnectMaxSequence(nextMessages, lastAppliedSeq);
    if (normalizedDpId && terminalDialogProcessIdSet.has(normalizedDpId)) {
      if (!isReconnectTerminalBatch(nextMessages)) {
        markReconnectSequenceApplied(normalizedDpId, maxSequence);
        return;
      }
    }
    const batchHasTerminalEvent = isReconnectTerminalBatch(nextMessages);
    const shouldCreateTarget = Boolean(allowCreate) && !batchHasTerminalEvent;
    if (shouldHydrateSessionBeforeReplay(nextMessages, normalizedDpId, shouldCreateTarget)) {
      await renderActiveSessionBeforeReplay();
    }
    const doneEnvelopeWithMessages = findReconnectDoneEnvelopeWithMessages(nextMessages);
    if (doneEnvelopeWithMessages) {
      applyDoneMessagesFromReconnect(doneEnvelopeWithMessages.data || {});
      markReconnectSequenceApplied(normalizedDpId, maxSequence);
      scrollBottom();
      return;
    }

    const targetMessage = resolveReconnectTargetAssistantMessage(normalizedDpId, {
      allowCreate: shouldCreateTarget,
    });
    if (!targetMessage) {
      createFinalAssistantFromReconnectReplay(nextMessages, normalizedDpId);
      markReconnectSequenceApplied(normalizedDpId, maxSequence);
      scrollBottom();
      return;
    }
    let maxAppliedSeq = lastAppliedSeq;
    for (const envelope of nextMessages) {
      maxAppliedSeq = Math.max(maxAppliedSeq, getReconnectEnvelopeSequence(envelope));
      const eventName = String(envelope?.event || "").trim();
      const eventData = envelope?.data || {};
      if (
        terminalDialogProcessIdSet.has(normalizedDpId) &&
        !isReconnectTerminalEvent(eventName)
      ) {
        continue;
      }
      if (eventName === StreamEventEnum.DELTA) {
        targetMessage.content += String(eventData?.text || "");
      } else if (eventName === StreamEventEnum.THINKING) {
        const logItem = classifyRealtimeLog(eventData);
        if (logItem?.dialogProcessId && !String(targetMessage?.dialogProcessId || "").trim()) {
          targetMessage.dialogProcessId = String(logItem.dialogProcessId || "").trim();
        }
        targetMessage.executionLogTotal = Number(targetMessage.executionLogTotal || 0) + 1;
        targetMessage.realtimeLogs = [...(targetMessage.realtimeLogs || []), logItem].slice(-10);
      } else if (eventName === StreamEventEnum.INTERACTION_REQUEST) {
        const interactionRequest = normalizeInteractionRequestPayload(eventData);
        if (!isInteractionRequestHandled(interactionRequest)) {
          setPendingInteractionRequest(interactionRequest);
        }
      } else if (eventName === StreamEventEnum.CONNECTOR_STATUS) {
        const { connectorType, connectorName, status } =
          resolveConnectorStatusPayload(eventData);
        if (
          connectorTypeSet?.has?.(connectorType) &&
          connectorName &&
          typeof upsertConnectedConnectorInPanelState === "function"
        ) {
          upsertConnectedConnectorInPanelState(activeSession.value, {
            connectorType,
            connectorName,
            status,
          });
          if (typeof refreshSessionConnectorsAsync === "function") {
            refreshSessionConnectorsAsync(activeSession.value?.id || "");
          }
        }
      } else if (eventName === StreamEventEnum.DONE) {
        terminalDialogProcessIdSet.add(normalizedDpId);
        if (Array.isArray(eventData?.messages) && eventData.messages.length) {
          applyDoneMessagesFromReconnect(eventData);
        }
      } else if (eventName === StreamEventEnum.STOPPED) {
        terminalDialogProcessIdSet.add(normalizedDpId);
      } else if (eventName === StreamEventEnum.ERROR) {
        targetMessage.error = String(eventData?.error || targetMessage?.error || "");
        terminalDialogProcessIdSet.add(normalizedDpId);
      }
    }
    markReconnectSequenceApplied(normalizedDpId, maxAppliedSeq);
    scrollBottom();
  }

  async function applyReconnectEvent(event, data) {
    if (String(event || "").trim() === StreamEventEnum.CHANNEL_STATE) {
      applyChannelState(data || {});
      return;
    }
    const dpId = String(data?.dialogProcessId || "").trim();
    const sessionId = String(data?.sessionId || "").trim();
    if (sessionId && isCurrentActiveSession(sessionId)) {
      await consumeReplayCacheForSession(sessionId);
      await applyReconnectMessagesToActiveSession([{ event, data }], dpId);
      return;
    }
    if (sessionId) {
      const replayKey = normalizeReplayCacheKey(dpId, sessionId);
      if (!replayCache[sessionId]) replayCache[sessionId] = {};
      if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
      replayCache[sessionId][replayKey].push({ event, data });
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (cacheExpiredRefreshTimer) {
        clearTimeout(cacheExpiredRefreshTimer);
        cacheExpiredRefreshTimer = null;
      }
    });
  }

  return {
    applyReconnectData,
    applyReconnectEvent,
    applyChannelState,
    __test:
      import.meta.env.MODE === "test"
        ? {
            replayCache,
            appliedReconnectSeqByDialogProcessId,
            terminalDialogProcessIdSet,
          }
        : undefined,
  };
}
