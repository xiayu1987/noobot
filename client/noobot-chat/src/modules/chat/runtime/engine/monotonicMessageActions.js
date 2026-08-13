/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { createResendMessageTransaction } from "./resendTransaction.js";
import { findVisibleLastMessage } from "../../model/messageModel.js";
import { createSessionAggregateVersionManager } from "./sessionAggregateVersionManager.js";
import {
  buildMessageAnchor,
  getMessageDialogProcessId,
  findMessageIdentityIndex,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { nowIso, nowMs } from "../../model/timeFields.js";
import {
  SESSION_RUN_EVENT,
} from "../sessionRunStateMachine.js";
import { SESSION_DETAIL_APPLY_MODE } from "./messageStateGuards.js";
import {
  confirmTurnRuntimeDeletion,
  resolveSessionTurnRuntime,
  removeTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { clearTurnUiState } from "./turnUiStore.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function summarizeDeleteMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message = {}, index) => ({
    index,
    id: normalizeTrimmedString(message?.id || message?.messageId),
    role: normalizeTrimmedString(getMessageRole(message)),
    type: normalizeTrimmedString(message?.type),
    sessionId: normalizeTrimmedString(message?.sessionId || message?.session_id),
    dialogProcessId: getMessageDialogProcessId(message),
    turnScopeId: getMessageTurnScopeId(message),
    contentLength: String(message?.content || "").length,
    turnStatusPlaceholder: message?.turnStatusPlaceholder === true,
    workflowMessage: message?.workflowMessage === true,
    pluginSource: normalizeTrimmedString(message?.pluginMeta?.source),
    pluginKind: normalizeTrimmedString(message?.pluginMeta?.kind),
  }));
}

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function syncSessionMessageSummary(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  session.messageCount = messages.length;
  session.lastMessage = findVisibleLastMessage(messages);
  session.updatedAt = nowIso();
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
        ...(source.aggregateVersion !== undefined
          ? { aggregateVersion: source.aggregateVersion }
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
  chatWebSocketClient,
  deleteSessionMessagesFromApi,
  replaceSessionTurnApi,
  input,
  notify,
  send,
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
  removeWorkflowOwnersForReplacedTurns,
  invalidateTerminalResolution,
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
  } = {}) {
    const rejectStopPrecondition = () => {
      const message = translate("chat.monotonicActionStopTimeout");
      notify({ type: "warning", message });
      throw new Error(message);
    };
    const runtime = activeTurnRuntime();
    const runtimeDisplayState = turnRuntimeDisplayState(runtime);
    if (
      runtimeDisplayState === "stopping" ||
      (runtimeDisplayState === "requesting" && runtime?.action === "stop")
    ) return false;
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

  function collectMessageCascadeTurnScopeIds(targetMessage = {}) {
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    const startIndex = userTargetMessage ? findMessageCascadeStartIndex(userTargetMessage) : -1;
    if (startIndex < 0) return [];
    return [...new Set(
      (activeSession.value?.messages || []).slice(startIndex).map(getMessageTurnScopeId).filter(Boolean),
    )];
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
    const sessionId = sessionRuntimeId(session || activeSessionId?.value);
    for (const removedMessage of removedMessages) {
      chatWebSocketClient?.cancelStreamForTurn?.({
        sessionId,
        turnScopeId: getMessageTurnScopeId(removedMessage),
        dialogProcessId: getMessageDialogProcessId(removedMessage),
      });
    }
    session.messages = messages.slice(0, startIndex);
    const removedTurnScopeIds = new Set(removedMessages.map(getMessageTurnScopeId).filter(Boolean));
    removedTurnScopeIds.forEach((turnScopeId) => {
      invalidateTerminalResolution?.(sessionId, turnScopeId);
      removeTurnRuntime(turnRuntimeRegistry?.value, turnScopeId, { sessionId });
      clearTurnUiState({ sessionId, turnScopeId });
    });
    syncSessionMessageSummary(session);
    clearPendingInteraction?.();
    return true;
  }

  async function deleteMonotonicMessage(targetMessage = {}, options = {}) {
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const initialSessionId = normalizeTrimmedString(
      activeSession.value?.sessionId || activeSessionId.value,
    );
    const initialTurnScopeId = getMessageTurnScopeId(userTargetMessage);
    const anchor = buildMessageAnchor(userTargetMessage);
    if (!Object.keys(anchor).length) return false;
    const deleteCommandId = `delete:${initialSessionId}:${anchor.turnScopeId || anchor.dialogProcessId || anchor.id || "anchor"}`;
    const supersededOperation = messageOperationStore?.getActiveOperation?.(initialSessionId);
    const deleteOperation = messageOperationStore?.registerOperation?.({
      type: "delete",
      opId: deleteCommandId,
      sessionId: initialSessionId,
      status: "stopping",
      turnScopeId: anchor.turnScopeId || "",
    });
    if (
      supersededOperation?.type === "resend" &&
      normalizeTrimmedString(supersededOperation.turnScopeId)
    ) {
      applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
        sessionId: initialSessionId,
        turnScopeId: supersededOperation.turnScopeId,
        source: "delete_superseded_resend",
      });
    }
    logWorkflowDiagnostics("frontend.messageDelete.started", () => ({
      sessionId: initialSessionId,
      dialogProcessId: getMessageDialogProcessId(userTargetMessage),
      turnScopeId: initialTurnScopeId,
      target: summarizeDeleteMessages([targetMessage])[0] || null,
      resolvedUserTarget: summarizeDeleteMessages([userTargetMessage])[0] || null,
      messagesBefore: summarizeDeleteMessages(activeSession.value?.messages),
    }));
    try {
      const prepared = await prepareMonotonicMessageAction({
        ...options,
        targetMessage: userTargetMessage,
        originalTargetMessage: targetMessage,
      });
      if (prepared === false) return false;
      if (typeof deleteSessionMessagesFromApi === "function") {
        const sessionId = normalizeTrimmedString(
          activeSession.value?.sessionId || activeSessionId.value,
        );
        const locallyDeletedTurnScopeIds = collectMessageCascadeTurnScopeIds(userTargetMessage);
        messageOperationStore?.updateOperation?.(deleteOperation?.opId, { status: "deleting" });
        logWorkflowDiagnostics("frontend.messageDelete.requestPrepared", () => ({
          sessionId,
          dialogProcessId: getMessageDialogProcessId(userTargetMessage),
          turnScopeId: getMessageTurnScopeId(userTargetMessage),
          anchor,
          locallyDeletedTurnScopeIds,
          commandId: deleteCommandId,
        }));
        const sessionAggregateVersionManager = createSessionAggregateVersionManager({
          activeSession,
          fetchSessionDetail,
          applySessionDetail,
        });
        const mutationResult = await sessionAggregateVersionManager.runAggregateVersionedMutation({
          mutate: async ({ expectedAggregateVersion }) => {
            const result = await deleteSessionMessagesFromApi({
              userId: userId?.value || userId,
              sessionId,
              parentSessionId: normalizeTrimmedString(activeSession.value?.parentSessionId),
              anchor,
              expectedAggregateVersion,
              commandId: deleteCommandId,
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
        logWorkflowDiagnostics("frontend.messageDelete.responseReceived", () => ({
          sessionId,
          dialogProcessId: getMessageDialogProcessId(userTargetMessage),
          turnScopeId: getMessageTurnScopeId(userTargetMessage),
          responseOk: result?.ok !== false && payload?.ok !== false,
          deletedCount: Number(payload?.deletedCount || 0),
          anchorIndex: Number(payload?.anchorIndex ?? -1),
          deletedTurnScopeIds: Array.isArray(payload?.deletedTurnScopeIds)
            ? payload.deletedTurnScopeIds.map(normalizeTrimmedString).filter(Boolean)
            : [],
          responseMessages: summarizeDeleteMessages(payload?.session?.messages),
          responseTurnStatuses: (Array.isArray(payload?.session?.turnStatuses)
            ? payload.session.turnStatuses
            : []).map((status = {}) => ({
              turnScopeId: normalizeTrimmedString(status?.turnScopeId),
              dialogProcessId: normalizeTrimmedString(status?.dialogProcessId),
              status: normalizeTrimmedString(status?.status),
            })),
        }));
        if (result?.ok === false || payload?.ok === false) return false;
        const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
        if (!sessionDetail) return false;
        const protocolDeletedTurnScopeIds = Array.isArray(payload?.deletedTurnScopeIds)
          ? payload.deletedTurnScopeIds.map(normalizeTrimmedString).filter(Boolean)
          : [];
        const confirmedDeletedTurnScopeIds = protocolDeletedTurnScopeIds.length
          ? protocolDeletedTurnScopeIds
          : locallyDeletedTurnScopeIds;
        confirmTurnRuntimeDeletion(turnRuntimeRegistry?.value, confirmedDeletedTurnScopeIds, { sessionId });
        cascadeDeleteMessagesFrom(userTargetMessage);
        logWorkflowDiagnostics("frontend.messageDelete.localCascadeApplied", () => ({
          sessionId,
          dialogProcessId: getMessageDialogProcessId(userTargetMessage),
          turnScopeId: getMessageTurnScopeId(userTargetMessage),
          stage: "before-detail-apply",
          messages: summarizeDeleteMessages(activeSession.value?.messages),
        }));
        applySessionDetail?.(sessionDetail, {
          mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
          deletedTurnScopeIds: confirmedDeletedTurnScopeIds,
        });
        cascadeDeleteMessagesFrom(userTargetMessage);
        logWorkflowDiagnostics("frontend.messageDelete.completed", () => ({
          sessionId,
          dialogProcessId: getMessageDialogProcessId(userTargetMessage),
          turnScopeId: getMessageTurnScopeId(userTargetMessage),
          confirmedDeletedTurnScopeIds,
          messagesAfter: summarizeDeleteMessages(activeSession.value?.messages),
        }));
        clearPendingInteraction?.();
        return true;
      }
      const sessionId = sessionRuntimeId(activeSession.value || activeSessionId?.value);
      confirmTurnRuntimeDeletion(
        turnRuntimeRegistry?.value,
        collectMessageCascadeTurnScopeIds(userTargetMessage),
        { sessionId },
      );
      const cascaded = cascadeDeleteMessagesFrom(userTargetMessage);
      return cascaded;
    } finally {
      if (deleteOperation) messageOperationStore?.completeOperation?.(deleteOperation.opId);
    }
  }

  const resendTransaction = createResendMessageTransaction({
    activeSession,
    activeSessionId,
    applyRunStateEvent,
    applySessionDetail,
    authFetch,
    buildMonotonicMessageAnchor: buildMessageAnchor,
    input,
    messageOperationStore,
    prepareMonotonicMessageAction,
    replaceSessionTurnApi,
    fetchSessionDetail,
    resolveMonotonicUserTarget,
    send,
    userId,
    turnRuntimeRegistry,
    removeWorkflowOwnersForReplacedTurns,
  });

  return {
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage: resendTransaction.resendMonotonicMessage,
    finalizePendingResendOperation: resendTransaction.finalizePendingResendOperation,
  };
}
