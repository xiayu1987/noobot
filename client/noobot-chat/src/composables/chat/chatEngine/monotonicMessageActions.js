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
  BackendChannelState,
  FrontendRunState,
  evaluateSessionRunState,
  isInFlightSessionRunState,
  getMessageRuntimeChannelState,
} from "../sessionRunStateMachine";
import {
  SESSION_DETAIL_APPLY_MODE,
  hasMatchingInFlightAssistantMessage,
} from "./messageStateGuards";

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function isStoppedMonotonicMessage(message = {}) {
  return Boolean(
    message?.stopState === "user_stopped" ||
    message?.monotonicState === "monotonic" ||
    message?.isMonotonic === true ||
    message?.monotonic === true,
  );
}

function isStoppingAssistantMessage(message = {}) {
  if (getMessageRole(message) !== "assistant") return false;
  const channelState = getMessageRuntimeChannelState(message);
  return ["frontend_user_stopping", "stopping", "user_stopped"].includes(
    normalizeTrimmedString(channelState?.state || message?.state || message?.status),
  );
}

function isUserStopPendingRunState(state = "") {
  return [
    FrontendRunState.USER_STOP_REQUESTED,
    FrontendRunState.USER_STOPPING,
    FrontendRunState.USER_STOP_COMPLETED,
    BackendChannelState.USER_STOPPED,
  ].includes(normalizeTrimmedString(state));
}

function hasMatchingInFlightAssistant({ activeSession, runStateSnapshot } = {}) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const runTurnScopeId = normalizeTrimmedString(runStateSnapshot?.value?.turnScopeId);
  return hasMatchingInFlightAssistantMessage(messages, { turnScopeId: runTurnScopeId });
}

function getStoppedTurnMessage({ targetMessage = null, originalTargetMessage = null } = {}) {
  if (isStoppedMonotonicMessage(targetMessage)) return targetMessage;
  if (isStoppedMonotonicMessage(originalTargetMessage)) return originalTargetMessage;
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
    const stoppedTurnMessage = getStoppedTurnMessage({ targetMessage, originalTargetMessage });
    if (sending?.value && stoppedTurnMessage) {
      const session = activeSession?.value || {};
      if (isUserStopPendingRunState(runStateSnapshot?.value?.state)) {
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
          state: BackendChannelState.USER_STOPPED,
          sessionId: normalizeTrimmedString(session.backendSessionId || session.sessionId || session.id || activeSessionId?.value),
          dialogProcessId: getMessageDialogProcessId(stoppedTurnMessage),
          turnScopeId: getMessageTurnScopeId(stoppedTurnMessage),
          source: "monotonic_delete_stopped_turn",
          updatedAtMs: nowMs(),
        });
        return true;
      }
    }
    const runStateEvaluation = evaluateSessionRunState(runStateSnapshot?.value);
    if (runStateEvaluation.canRetryMessage === false || runStateEvaluation.canDeleteMessage === false) {
      return false;
    }
    if (!sending?.value) return true;
    if (!hasConsistentSendingState()) {
      notifyStateMismatch();
      return false;
    }
    stopSending();
    const settled = await waitForSendingSettled({ timeoutMs, pollIntervalMs });
    if (!settled) {
      rejectStopPrecondition();
    }
    if (evaluateSessionRunState(runStateSnapshot?.value).state === BackendChannelState.ERROR) {
      rejectStopPrecondition();
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
      const sessionVersionManager = createSessionVersionManager({
        activeSession,
        fetchSessionDetail,
        applySessionDetail,
      });
      const mutationResult = await sessionVersionManager.runVersionedMutation({
        mutate: async ({ expectedVersion, attempt }) => {
          const result = await deleteSessionMessagesFromApi({
            userId: userId?.value || userId,
            sessionId,
            parentSessionId: normalizeTrimmedString(activeSession.value?.parentSessionId),
            anchor,
            expectedVersion,
            idempotencyKey: attempt > 1 ? `${anchor.turnScopeId || "delete"}:retry-version` : "",
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
