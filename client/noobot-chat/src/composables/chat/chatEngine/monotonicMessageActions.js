/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils";
import { createResendMessageTransaction } from "./resendTransaction";
import { syncSessionMessageSummary } from "./resendReconciler";
import { getCurrentSessionVersion } from "./sessionVersionManager";
import {
  buildMessageAnchor,
  findMessageIdentityIndex,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import { isInFlightSessionRunState } from "../sessionRunStateMachine";
import { MESSAGE_IN_FLIGHT_CHANNEL_STATES } from "../sessionRunStateMachine/constants";

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function isInFlightAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== "assistant") return false;
  if (!getMessageTurnScopeId(messageItem)) return false;
  if (messageItem?.pending === true) return true;
  const channelState = normalizeTrimmedString(messageItem?.channelState?.state);
  return MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(channelState);
}

function hasMatchingInFlightAssistant({ activeSession, runStateSnapshot } = {}) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const runTurnScopeId = normalizeTrimmedString(runStateSnapshot?.value?.turnScopeId);
  if (!runTurnScopeId) return messages.some((messageItem) => isInFlightAssistantMessage(messageItem));
  return messages.some((messageItem) => (
    isInFlightAssistantMessage(messageItem) &&
    getMessageTurnScopeId(messageItem) === runTurnScopeId
  ));
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

export function createMonotonicMessageActions({
  activeSession,
  activeSessionId,
  authFetch,
  clearPendingInteraction,
  deleteSessionMessagesFromApi,
  replaceSessionTurnApi,
  input,
  notify,
  send,
  sending,
  stopSending,
  translate,
  userId,
  applySessionDetail,
  fetchSessionDetail,
  runStateSnapshot,
  messageOperationStore,
  monotonicActionStopTimeoutMs,
  monotonicActionStopPollIntervalMs,
  applyRunStateEvent,
}) {
  function notifyStateMismatch() {
    notify({
      type: "warning",
      message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
    });
  }

  function hasConsistentSendingState() {
    if (!sending?.value && !isInFlightSessionRunState(runStateSnapshot?.value?.state)) return true;
    return hasMatchingInFlightAssistant({ activeSession, runStateSnapshot });
  }

  async function waitForSendingSettled({
    timeoutMs = monotonicActionStopTimeoutMs,
    pollIntervalMs = monotonicActionStopPollIntervalMs,
  } = {}) {
    if (!sending?.value) return true;
    const startedAt = nowMs();
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    const normalizedPollIntervalMs = Math.max(1, Number(pollIntervalMs) || 1);
    while (sending.value) {
      if (nowMs() - startedAt >= normalizedTimeoutMs) {
        return false;
      }
      await delay(normalizedPollIntervalMs);
    }
    return true;
  }

  async function prepareMonotonicMessageAction({ timeoutMs, pollIntervalMs } = {}) {
    if (!sending?.value) return true;
    if (!hasConsistentSendingState()) {
      notifyStateMismatch();
      return false;
    }
    stopSending();
    const settled = await waitForSendingSettled({ timeoutMs, pollIntervalMs });
    if (!settled) {
      const message = translate("chat.monotonicActionStopTimeout");
      notify({ type: "warning", message });
      throw new Error(message);
    }
    return true;
  }

  function resolveMonotonicUserTarget(targetMessage = {}) {
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!targetMessage || typeof targetMessage !== "object") return null;
    if (isUserMessage(targetMessage)) return targetMessage;

    const directIndex = findMessageIdentityIndex(targetMessage, messages);
    if (directIndex >= 0 && isUserMessage(messages[directIndex])) {
      return messages[directIndex];
    }

    const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
    if (!targetTurnScopeId) return null;
    return messages.find(
      (message) => isUserMessage(message) && getMessageTurnScopeId(message) === targetTurnScopeId,
    ) || null;
  }

  function findMessageCascadeStartIndex(targetMessage = {}) {
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!isUserMessage(targetMessage)) return -1;
    return findMessageIdentityIndex(targetMessage, messages);
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
      const rawStartIndex = findMessageIdentityIndex(userTargetMessage, session.rawMessages);
      if (rawStartIndex >= 0) {
        session.rawMessages = session.rawMessages.slice(0, rawStartIndex);
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
        activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSessionId.value,
      );
      const anchor = buildMessageAnchor(userTargetMessage);
      if (!Object.keys(anchor).length) return false;
      const result = await deleteSessionMessagesFromApi({
        userId: userId?.value || userId,
        sessionId,
        parentSessionId: normalizeTrimmedString(activeSession.value?.parentSessionId),
        anchor,
        expectedVersion: getCurrentSessionVersion(activeSession),
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

  const resendTransaction = createResendMessageTransaction({
    activeSession,
    activeSessionId,
    applyRunStateEvent,
    applySessionDetail,
    authFetch,
    buildMonotonicMessageAnchor: buildMessageAnchor,
    clearPendingInteraction,
    findMessageCascadeStartIndex,
    input,
    messageOperationStore,
    prepareMonotonicMessageAction,
    replaceSessionTurnApi,
    fetchSessionDetail,
    resolveMonotonicUserTarget,
    send,
    userId,
  });

  return {
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage: resendTransaction.resendMonotonicMessage,
    pruneStaleMessagesAfterResend: resendTransaction.pruneStaleMessagesAfterResend,
    finalizePendingResendOperation: resendTransaction.finalizePendingResendOperation,
  };
}
