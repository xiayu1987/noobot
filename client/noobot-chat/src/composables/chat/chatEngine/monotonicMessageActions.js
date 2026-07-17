/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils";
import { createResendMessageTransaction } from "./resendTransaction";
import { syncSessionMessageSummary } from "./resendReconciler";
import { createSessionVersionManager } from "./sessionVersionManager";
import {
  buildMessageAnchor,
  getMessageDialogProcessId,
  findMessageIdentityIndex,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import {
  SESSION_RUN_EVENT,
  FrontendRunState,
  getMessageRuntimeChannelState,
} from "../sessionRunStateMachine";
import { SESSION_DETAIL_APPLY_MODE } from "./messageStateGuards";
import {
  resolveSessionTurnRuntime,
  removeTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../sessionRunStateMachine/turnRuntimeRegistry";

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function isStoppedTurnStatusPlaceholder(message = {}) {
  return message?.turnStatusPlaceholder === true &&
    normalizeTrimmedString(message?.turnStatus?.status || message?.status) === "user_stopped";
}

function isStoppingAssistantMessage(message = {}) {
  if (getMessageRole(message) !== "assistant") return false;
  const channelState = getMessageRuntimeChannelState(message);
  return ["frontend_user_stopping", "stopping", "user_stopped"].includes(
    normalizeTrimmedString(channelState?.state || message?.state || message?.status),
  );
}

function isUserStopConfirmedRunState(state = "") {
  return [
    FrontendRunState.USER_STOPPING,
    FrontendRunState.USER_STOP_COMPLETED,
    "user_stopped",
  ].includes(normalizeTrimmedString(state));
}

function getStoppedTurnMessage({ targetMessage = null, originalTargetMessage = null } = {}) {
  if (isStoppedTurnStatusPlaceholder(targetMessage)) return targetMessage;
  if (isStoppedTurnStatusPlaceholder(originalTargetMessage)) return originalTargetMessage;
  if (isStoppingAssistantMessage(originalTargetMessage)) return originalTargetMessage;
  if (isStoppingAssistantMessage(targetMessage)) return targetMessage;
  return null;
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
        // Mutation responses expose the authoritative revision at the top
        // level. Carry it into the document consumed by applySessionDetail so
        // a subsequent continue does not reuse the pre-delete revision.
        ...(source.version !== undefined ? { version: source.version } : {}),
        ...(source.revision !== undefined ? { revision: source.revision } : {}),
        ...(source.sessionVersion !== undefined
          ? { version: source.sessionVersion, revision: source.sessionVersion }
          : {}),
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
  canStop,
  stopSending,
  translate,
  userId,
  applySessionDetail,
  fetchSessionDetail,
  turnRuntimeRegistry,
  messageOperationStore,
  monotonicActionStopTimeoutMs,
  monotonicActionStopPollIntervalMs,
  applyRunStateEvent,
  appendMessage,
}) {
  function notifyStateMismatch() {
    notify({
      type: "warning",
      message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
    });
  }

  function activeTurnRuntime() {
    const sessionId = sessionRuntimeId(activeSession?.value || activeSessionId?.value);
    return resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId);
  }

  function isActiveTurnInFlight() {
    return ["requesting", "sending", "completing", "stopping"].includes(
      turnRuntimeDisplayState(activeTurnRuntime()),
    );
  }

  async function waitForSendingSettled({
    timeoutMs = monotonicActionStopTimeoutMs,
    pollIntervalMs = monotonicActionStopPollIntervalMs,
  } = {}) {
    if (!isActiveTurnInFlight()) return true;
    const startedAt = nowMs();
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    const normalizedPollIntervalMs = Math.max(1, Number(pollIntervalMs) || 1);
    while (isActiveTurnInFlight()) {
      if (nowMs() - startedAt >= normalizedTimeoutMs) {
        return false;
      }
      await delay(normalizedPollIntervalMs);
    }
    return true;
  }

  async function prepareMonotonicMessageAction({
    timeoutMs,
    pollIntervalMs,
    targetMessage = null,
    originalTargetMessage = null,
  } = {}) {
    const rejectStopPrecondition = () => {
      const message = translate("chat.monotonicActionStopTimeout");
      notify({ type: "warning", message });
      throw new Error(message);
    };
    const targetTurnScopeId = getMessageTurnScopeId(targetMessage) || getMessageTurnScopeId(originalTargetMessage);
    const stoppedTurnMessage = getStoppedTurnMessage({ targetMessage, originalTargetMessage }) ||
      (targetTurnScopeId
        ? (Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : []).find(
            (message) =>
              getMessageTurnScopeId(message) === targetTurnScopeId &&
              (isStoppedTurnStatusPlaceholder(message) || isStoppingAssistantMessage(message)),
          )
        : null);
    if (stoppedTurnMessage) return true;
    // A stop transaction is already in progress for this Session. Do not issue
    // a second stop request or mutate messages until its authoritative result
    // arrives.
    if (turnRuntimeDisplayState(activeTurnRuntime()) === "stopping") return false;
    // This helper is the internal stop-and-settle gate used by delete/resend.
    // The public action mutex must reject a second action, but it must not
    // prevent this helper from stopping the currently active run first.
    if (!isActiveTurnInFlight()) return true;
    stopSending();
    const settled = await waitForSendingSettled({ timeoutMs, pollIntervalMs });
    if (!settled) {
      rejectStopPrecondition();
    }
    if (activeTurnRuntime()?.terminal === "error") return false;
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
    const sessionId = sessionRuntimeId(session || activeSessionId?.value);
    const removedTurnScopeIds = new Set(removedMessages.map(getMessageTurnScopeId).filter(Boolean));
    removedTurnScopeIds.forEach((turnScopeId) => {
      removeTurnRuntime(turnRuntimeRegistry?.value, turnScopeId, { sessionId });
    });
    syncSessionMessageSummary(session);
    clearPendingInteraction?.();
    return true;
  }

  async function deleteMonotonicMessage(targetMessage = {}, options = {}) {
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const prepared = await prepareMonotonicMessageAction({
      ...options,
      targetMessage: userTargetMessage,
      originalTargetMessage: targetMessage,
    });
    if (prepared === false) return false;
    if (typeof deleteSessionMessagesFromApi === "function") {
      const sessionId = normalizeTrimmedString(
        activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSessionId.value,
      );
      const anchor = buildMessageAnchor(userTargetMessage);
      if (!Object.keys(anchor).length) return false;
      const deleteIdempotencyKey = `delete:${sessionId}:${anchor.turnScopeId || anchor.dialogProcessId || anchor.id || "anchor"}`;
      const sessionVersionManager = createSessionVersionManager({
        activeSession,
        fetchSessionDetail,
        applySessionDetail,
      });
      const mutationResult = await sessionVersionManager.runVersionedMutation({
        mutate: async ({ expectedVersion }) => {
          const result = await deleteSessionMessagesFromApi({
            userId: userId?.value || userId,
            sessionId,
            parentSessionId: normalizeTrimmedString(activeSession.value?.parentSessionId),
            anchor,
            expectedVersion,
            idempotencyKey: deleteIdempotencyKey,
          }, { fetcher: authFetch });
          const payload = typeof result?.json === "function" ? await result.json() : result;
          return { result, payload };
        },
        refreshOptions: {
          sessionId,
          detailOptions: { source: "deleteVersionConflict" },
          logContext: { turnScopeId: anchor.turnScopeId || "" },
        },
      });
      const result = mutationResult?.result;
      const payload = mutationResult?.payload;
      if (result?.ok === false || payload?.ok === false) return false;
      const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
      if (!sessionDetail) return false;
      cascadeDeleteMessagesFrom(userTargetMessage);
      applySessionDetail?.(sessionDetail, {
        mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
        preserveCurrentMessages: false,
      });
      clearPendingInteraction?.();
      return true;
    }
    const cascaded = cascadeDeleteMessagesFrom(userTargetMessage);
    return cascaded;
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
    appendMessage,
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
