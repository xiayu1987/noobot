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

function isReplaceTurnUnsupported(result = {}, payload = {}) {
  const status = Number(result?.status || payload?.status || 0);
  return Boolean(
    payload?.unsupported === true ||
    payload?.code === "UNSUPPORTED" ||
    payload?.error === "unsupported" ||
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
          }
          if (operation) applyResendReconcile(messageOperationStore?.getOperation(operation.opId) || operation, { finalOnly: true });
          if (operation) messageOperationStore?.completeOperation(operation.opId);
          input.value = "";
          return true;
        }
      } catch (error) {
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        restoreSessionSnapshot(activeSession?.value, snapshot);
        input.value = snapshot.inputValue;
        return false;
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
    const sent = await send?.();
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
