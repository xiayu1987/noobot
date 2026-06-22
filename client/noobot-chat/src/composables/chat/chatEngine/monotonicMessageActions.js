/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils";
import { createResendMessageTransaction } from "./resendTransaction";
import { syncSessionMessageSummary } from "./resendReconciler";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageStableId,
  getMessageTurnId,
} from "../../infra/messageIdentity";

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function findMessageIndex(targetMessage = {}, messages = []) {
  const targetTurnId = getMessageTurnId(targetMessage);
  const targetId = getMessageStableId(targetMessage);
  const targetTs = targetMessage?.ts;
  const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
  const targetRole = getMessageRole(targetMessage).toLowerCase();
  const targetContent = normalizeTrimmedString(targetMessage?.content);
  return messages.findIndex((message) => {
    if (message === targetMessage) return true;
    if (
      targetTurnId &&
      getMessageTurnId(message) === targetTurnId
    ) return true;
    if (
      targetId &&
      getMessageStableId(message) === targetId
    ) return true;
    if (targetTs !== undefined && message?.ts === targetTs) return true;
    if (
      targetDialogProcessId &&
      getMessageDialogProcessId(message) === targetDialogProcessId &&
      (!targetRole || getMessageRole(message).toLowerCase() === targetRole)
    ) return true;
    return Boolean(
      targetRole &&
      targetContent &&
      getMessageRole(message).toLowerCase() === targetRole &&
      normalizeTrimmedString(message?.content) === targetContent,
    );
  });
}

function buildMonotonicMessageAnchor(targetMessage = {}) {
  const turnId = getMessageTurnId(targetMessage);
  if (turnId) return { turnId };
  const messageId = getMessageStableId(targetMessage);
  if (messageId) return { messageId };
  const dialogProcessId = getMessageDialogProcessId(targetMessage);
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
  messageOperationStore,
  monotonicActionStopTimeoutMs,
  monotonicActionStopPollIntervalMs,
}) {
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

    const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
    if (targetDialogProcessId) {
      const sameDialogProcessUserMessage = messages.find(
        (message) => isUserMessage(message) && getMessageDialogProcessId(message) === targetDialogProcessId,
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
        activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSessionId.value,
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

  const resendTransaction = createResendMessageTransaction({
    activeSession,
    activeSessionId,
    applySessionDetail,
    authFetch,
    buildMonotonicMessageAnchor,
    clearPendingInteraction,
    deleteMonotonicMessage,
    findMessageCascadeStartIndex,
    input,
    messageOperationStore,
    prepareMonotonicMessageAction,
    replaceSessionTurnApi,
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
