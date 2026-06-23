/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  reconcileStaleResendMessages,
  syncSessionMessageSummary,
} from "./resendReconciler";
import { normalizeTrimmedString } from "./utils";
import {
  getMessageRole,
  getMessageStableId,
  getMessageTurnId,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";

function resolveSessionId(activeSession, activeSessionId) {
  return normalizeTrimmedString(
    activeSession?.value?.backendSessionId || activeSession?.value?.sessionId || activeSessionId?.value,
  );
}

function createSessionSnapshot(session, inputValue) {
  return {
    messages: Array.isArray(session?.messages) ? [...session.messages] : null,
    rawMessages: Array.isArray(session?.rawMessages) ? [...session.rawMessages] : null,
    messageCount: session?.messageCount,
    lastMessage: session?.lastMessage,
    updatedAt: session?.updatedAt,
    inputValue,
  };
}

function restoreSessionSnapshot(session, snapshot) {
  if (!session || !snapshot?.messages || !snapshot?.rawMessages) return false;
  session.messages = snapshot.messages;
  session.rawMessages = snapshot.rawMessages;
  session.messageCount = snapshot.messageCount;
  session.lastMessage = snapshot.lastMessage;
  session.updatedAt = snapshot.updatedAt;
  return true;
}

function normalizeSessionDetailSnapshot(payload = {}, fallbackSessionId = "") {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (Array.isArray(source.sessions) && normalizeTrimmedString(source.sessionId || fallbackSessionId)) {
    return {
      ...source,
      sessionId: normalizeTrimmedString(source.sessionId || fallbackSessionId),
    };
  }
  const session = source.session && typeof source.session === "object" && !Array.isArray(source.session)
    ? source.session
    : Array.isArray(source.messages)
      ? source
      : null;
  if (!session) return null;
  const sessionId = normalizeTrimmedString(session.sessionId || source.sessionId || fallbackSessionId);
  if (!sessionId) return null;
  return {
    ...source,
    sessionId,
    sessions: [{ ...session, sessionId: normalizeTrimmedString(session.sessionId || sessionId) }],
  };
}

function resolveHttpStatus(value = {}) {
  return Number(
    value?.status
    || value?.statusCode
    || value?.response?.status
    || value?.response?.statusCode
    || value?.data?.status
    || value?.data?.statusCode
    || value?.cause?.status
    || value?.cause?.statusCode
    || 0,
  );
}

function isReplaceTurnUnsupported(result = {}, payload = {}) {
  const status = resolveHttpStatus(result) || resolveHttpStatus(payload);
  return Boolean(
    payload?.unsupported === true ||
    payload?.data?.unsupported === true ||
    payload?.response?.data?.unsupported === true ||
    result?.unsupported === true ||
    result?.data?.unsupported === true ||
    result?.response?.data?.unsupported === true ||
    payload?.code === "UNSUPPORTED" ||
    payload?.data?.code === "UNSUPPORTED" ||
    payload?.response?.data?.code === "UNSUPPORTED" ||
    result?.code === "UNSUPPORTED" ||
    result?.data?.code === "UNSUPPORTED" ||
    result?.response?.data?.code === "UNSUPPORTED" ||
    payload?.error === "unsupported" ||
    payload?.data?.error === "unsupported" ||
    payload?.response?.data?.error === "unsupported" ||
    result?.error === "unsupported" ||
    result?.data?.error === "unsupported" ||
    result?.response?.data?.error === "unsupported" ||
    [404, 405, 501].includes(status),
  );
}

function operationSeed({ sessionId, userTargetMessage, originalCascadeStartIndex, removedMessagesBeforeResend }) {
  return {
    type: "resend",
    sessionId,
    status: "pending",
    anchorMessage: userTargetMessage,
    originalStartIndex: originalCascadeStartIndex,
    removedMessages: removedMessagesBeforeResend,
  };
}

function normalizeMessageRole(message = {}) {
  return String(getMessageRole(message) || message?.type || "").trim().toLowerCase();
}

function getMessageText(message = {}) {
  return String(message?.content || message?.text || message?.message || "");
}


function findReplacementUserMessage({ session, payload, text }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const newTurn = payload?.newTurn && typeof payload.newTurn === "object" && !Array.isArray(payload.newTurn)
    ? payload.newTurn
    : null;
  const expectedTurnId = getMessageTurnId(newTurn);
  const expectedMessageId = getMessageStableId(newTurn);
  const expectedText = String(text || "");
  return [...messages].reverse().find((message) => {
    if (normalizeMessageRole(message) !== "user") return false;
    if (expectedTurnId && getMessageTurnId(message) === expectedTurnId) return true;
    if (expectedMessageId && getMessageStableId(message) === expectedMessageId) return true;
    return expectedText && getMessageText(message) === expectedText;
  }) || null;
}

function hasCompletedAssistantAfterReplacementUser({ session, replacementUserMessage }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const userIndex = messages.indexOf(replacementUserMessage);
  if (userIndex < 0) return false;
  return messages.slice(userIndex + 1).some((message) => {
    if (normalizeMessageRole(message) !== "assistant") return false;
    if (message?.pending === true) return false;
    return getMessageText(message).trim() || message?.done === true || message?.completed === true;
  });
}
import { nowMs } from "../../infra/timeFields";

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Frontend resend transaction for replace-turn first, delete + send fallback.
 *
 * The operation/reconcile state remains outside persisted session snapshots so
 * atomic replace-turn and legacy delete + send can share the same safety net.
 */
export function createResendMessageTransaction({
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
} = {}) {
  function applyResendReconcile(operation, options = {}) {
    const session = activeSession?.value;
    const result = reconcileStaleResendMessages(session, operation, options);
    if (result.changed) {
      syncSessionMessageSummary(session);
      clearPendingInteraction?.();
    }
    return result.changed;
  }

  function pruneStaleMessagesAfterResend(anchorMessage = {}, originalStartIndex = -1, removedMessages = [], options = {}) {
    return applyResendReconcile({
      anchorMessage,
      originalStartIndex,
      removedMessages,
    }, options);
  }

  function finalizePendingResendOperation({ finalOnly = true } = {}) {
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const operation = messageOperationStore?.getActiveOperation(sessionId, "resend")
      || messageOperationStore?.getLatestOperation("resend");
    if (!operation) return false;
    messageOperationStore?.updateOperation(operation.opId, { status: "reconciling" });
    const updatedOperation = messageOperationStore?.getOperation(operation.opId) || operation;
    applyResendReconcile(updatedOperation, { finalOnly });
    messageOperationStore?.completeOperation(updatedOperation.opId);
    return true;
  }

  async function resendMonotonicMessage(targetMessage = {}, editedContent = "", options = {}) {
    const text = String(editedContent || "").trim();
    if (!text) return false;

    await prepareMonotonicMessageAction?.(options);
    const userTargetMessage = resolveMonotonicUserTarget?.(targetMessage);
    if (!userTargetMessage) return false;

    const originalSession = activeSession?.value;
    const snapshot = createSessionSnapshot(originalSession, input?.value);
    const originalCascadeStartIndex = findMessageCascadeStartIndex?.(userTargetMessage) ?? -1;
    const removedMessagesBeforeResend = Array.isArray(originalSession?.messages) && originalCascadeStartIndex >= 0
      ? originalSession.messages.slice(originalCascadeStartIndex)
      : [];
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const resendTurnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();

    if (typeof replaceSessionTurnApi === "function") {
      const operation = messageOperationStore?.registerOperation(operationSeed({
        sessionId,
        userTargetMessage,
        originalCascadeStartIndex,
        removedMessagesBeforeResend,
      }));
      try {
        const result = await replaceSessionTurnApi({
          userId: userId?.value || userId,
          sessionId,
          parentSessionId: normalizeTrimmedString(originalSession?.parentSessionId),
          anchor: buildMonotonicMessageAnchor?.(userTargetMessage) || {},
          newContent: text,
          turnScopeId: resendTurnScopeId,
          expectedVersion: originalSession?.version ?? originalSession?.revision,
          idempotencyKey: operation?.opId || "",
        }, { fetcher: authFetch });
        const payload = typeof result?.json === "function" ? await result.json() : result;
        if (isReplaceTurnUnsupported(result, payload)) {
          if (operation) messageOperationStore?.completeOperation(operation.opId);
        } else if (result?.ok === false || payload?.ok === false) {
          if (operation) messageOperationStore?.completeOperation(operation.opId);
          restoreSessionSnapshot(activeSession?.value, snapshot);
          input.value = snapshot.inputValue;
          return false;
        } else {
          if (operation) messageOperationStore?.updateOperation(operation.opId, { status: "reconciling" });
          const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
          if (sessionDetail) {
            applySessionDetail?.(sessionDetail, { preserveCurrentMessages: false });
            if (Array.isArray(activeSession?.value?.messages)) {
              activeSession.value.messages = [...activeSession.value.messages];
            }
            if (Array.isArray(activeSession?.value?.rawMessages)) {
              activeSession.value.rawMessages = [...activeSession.value.rawMessages];
            }
          }
          if (operation) applyResendReconcile(messageOperationStore?.getOperation(operation.opId) || operation, { finalOnly: true });
          const replacementUserMessage = findReplacementUserMessage({
            session: activeSession?.value,
            payload,
            text,
          });
          const completedAssistantReturned = hasCompletedAssistantAfterReplacementUser({
            session: activeSession?.value,
            replacementUserMessage,
          });
          if (completedAssistantReturned || payload?.generation === "completed" || payload?.generated === true) {
            if (operation) messageOperationStore?.completeOperation(operation.opId);
            input.value = "";
            return true;
          }
          if (operation) messageOperationStore?.updateOperation(operation.opId, { status: "sending" });
          const sent = await send?.({
            skipUserMessageAppend: true,
            existingUserMessage: replacementUserMessage,
            messageText: text,
            reuseExistingUserTurn: true,
            turnScopeId: resendTurnScopeId || getMessageTurnScopeId(replacementUserMessage || payload?.newTurn || {}),
            existingUserTurnId: getMessageTurnId(replacementUserMessage || payload?.newTurn || {}),
            existingUserMessageId: getMessageStableId(replacementUserMessage || payload?.newTurn || {}),
          });
          if (!sent) {
            if (operation) messageOperationStore?.completeOperation(operation.opId);
            restoreSessionSnapshot(activeSession?.value, snapshot);
            input.value = snapshot.inputValue;
            return false;
          }
          if (operation && messageOperationStore?.getOperation(operation.opId)) {
            messageOperationStore.completeOperation(operation.opId);
          }
          return true;
        }
      } catch (error) {
        if (isReplaceTurnUnsupported(error)) {
          if (operation) messageOperationStore?.completeOperation(operation.opId);
        } else {
          if (operation) messageOperationStore?.completeOperation(operation.opId);
          restoreSessionSnapshot(activeSession?.value, snapshot);
          input.value = snapshot.inputValue;
          return false;
        }
      }
    }

    const deleted = await deleteMonotonicMessage?.(userTargetMessage, { ...options, timeoutMs: 0 });
    if (!deleted) return false;

    const operation = messageOperationStore?.registerOperation({
      ...operationSeed({
        sessionId,
        userTargetMessage,
        originalCascadeStartIndex,
        removedMessagesBeforeResend,
      }),
      status: "deleted",
    });

    if (operation) {
      applyResendReconcile(operation, { finalOnly: false });
      messageOperationStore?.updateOperation(operation.opId, { status: "sending" });
    }

    input.value = text;
    const sent = await send?.({ turnScopeId: resendTurnScopeId });
    if (!sent) {
      if (operation) messageOperationStore?.completeOperation(operation.opId);
      restoreSessionSnapshot(activeSession?.value, snapshot);
      input.value = snapshot.inputValue;
      return false;
    }

    if (operation && messageOperationStore?.getOperation(operation.opId)) {
      messageOperationStore.completeOperation(operation.opId);
    }
    return true;
  }

  return {
    finalizePendingResendOperation,
    pruneStaleMessagesAfterResend,
    resendMonotonicMessage,
  };
}
