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
  isStageStatusStepState,
  SESSION_RUN_EVENT,
  STATUS_STEP_STAGE,
  TURN_PENDING_COMMAND_TYPE,
  TURN_RUNTIME_TERMINAL,
} from "../sessionRunStateMachine.js";
import {
  confirmTurnRuntimeDeletion,
  selectCurrentTurnRuntime,
  removeTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { clearTurnUiState } from "./turnUiStore.js";
import {
  isUserMessage,
  resolveMonotonicUserTarget as resolveUserTargetInMessages,
} from "../../model/message-actions/monotonicMessageActionRules.js";
import { logMessageMutationDiagnostics } from "../../../debug/loggers/messageMutationDiagnosticsLogger.js";
import {
  isPlainObject,
  isObjectLike,
  requireFunctionDependencies,
  text,
} from "@noobot/shared/value";

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function summarizeDeleteMessages(messages = []) {
  return messages.map((message, index) => ({
    index,
    role: normalizeTrimmedString(getMessageRole(message)),
    type: normalizeTrimmedString(message?.type),
    sessionId: normalizeTrimmedString(message?.sessionId),
    dialogProcessId: getMessageDialogProcessId(message),
    turnScopeId: getMessageTurnScopeId(message),
    contentLength: String(message?.content || "").length,
    turnStatusPlaceholder: message?.turnStatusPlaceholder === true,
    workflowMessage: message?.workflowMessage === true,
    pluginSource: normalizeTrimmedString(message?.pluginMeta?.source),
    pluginKind: normalizeTrimmedString(message?.pluginMeta?.kind),
  }));
}

function syncSessionMessageSummary(session) {
  const { messages } = session;
  session.messageCount = messages.length;
  session.lastMessage = findVisibleLastMessage(messages);
  session.updatedAt = nowIso();
}

function normalizeSessionDetailSnapshot(payload = {}, fallbackSessionId = "") {
  const source = isPlainObject(payload) ? payload : {};
  if (Array.isArray(source.sessions) && text(source.sessionId)) {
    return source;
  }
  const session = isPlainObject(source.session)
    ? source.session
    : source.messages && Array.isArray(source.messages)
      ? source
      : null;
  if (!session) return null;
  const sessionId = normalizeTrimmedString(
    session.sessionId || source.sessionId || fallbackSessionId,
  );
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
  turnRuntimeRegistry,
  messageOperationStore,
  monotonicActionStopTimeoutMs,
  monotonicActionStopPollIntervalMs,
  applyRunStateEvent,
  removeWorkflowOwnersForReplacedTurns,
  invalidateTerminalResolution,
}) {
  requireFunctionDependencies("createMonotonicMessageActions", {
    clearPendingInteraction,
    cancelStreamForTurn: chatWebSocketClient.cancelStreamForTurn,
    deleteSessionMessagesFromApi,
    notify,
    stopSending,
    translate,
    applySessionDetail,
    applyRunStateEvent,
    invalidateTerminalResolution,
    getActiveOperation: messageOperationStore.getActiveOperation,
    registerOperation: messageOperationStore.registerOperation,
    updateOperation: messageOperationStore.updateOperation,
    completeOperation: messageOperationStore.completeOperation,
  });
  if (!(monotonicActionStopTimeoutMs >= 0) || !(monotonicActionStopPollIntervalMs >= 1)) {
    throw new TypeError(
      "createMonotonicMessageActions requires monotonicActionStopTimeoutMs >= 0 and monotonicActionStopPollIntervalMs >= 1",
    );
  }
  function activeTurnRuntime() {
    const sessionId = normalizeTrimmedString(activeSessionId.value);
    return selectCurrentTurnRuntime(turnRuntimeRegistry.value, sessionId);
  }

  function isActiveTurnInFlight() {
    return isStageStatusStepState(turnRuntimeDisplayState(activeTurnRuntime()));
  }

  async function waitForSendingSettled() {
    if (!isActiveTurnInFlight()) return true;
    const startedAt = nowMs();
    while (isActiveTurnInFlight()) {
      if (nowMs() - startedAt >= monotonicActionStopTimeoutMs) {
        return false;
      }
      await delay(monotonicActionStopPollIntervalMs);
    }
    return true;
  }

  async function prepareMonotonicMessageAction() {
    const rejectStopPrecondition = () => {
      const message = translate("chat.monotonicActionStopTimeout");
      notify({ type: "warning", message });
      throw new Error(message);
    };
    const runtime = activeTurnRuntime();
    const runtimeDisplayState = turnRuntimeDisplayState(runtime);
    if (
      runtimeDisplayState === STATUS_STEP_STAGE.STOPPING ||
      (runtimeDisplayState === STATUS_STEP_STAGE.REQUESTING &&
        runtime?.action === TURN_PENDING_COMMAND_TYPE.STOP)
    )
      return false;
    if (!isActiveTurnInFlight()) return true;
    stopSending();
    const settled = await waitForSendingSettled();
    if (!settled) {
      rejectStopPrecondition();
    }
    if (activeTurnRuntime()?.terminal === TURN_RUNTIME_TERMINAL.ERROR) return false;
    return true;
  }

  function resolveMonotonicUserTarget(targetMessage) {
    if (!isObjectLike(targetMessage)) return null;
    if (isUserMessage(targetMessage)) return targetMessage;

    const session = activeSession.value;
    if (!session) return null;
    return resolveUserTargetInMessages(targetMessage, session.messages);
  }

  function findMessageCascadeStartIndex(targetMessage, messages) {
    if (!isUserMessage(targetMessage)) return -1;
    return findMessageIdentityIndex(targetMessage, messages);
  }

  function cascadeDeleteMessagesFrom(targetMessage) {
    const session = activeSession.value;
    const { messages } = session;
    const userTargetMessage = resolveUserTargetInMessages(targetMessage, messages);
    if (!userTargetMessage) return false;
    const startIndex = findMessageCascadeStartIndex(userTargetMessage, messages);
    if (startIndex < 0) return false;
    const removedMessages = messages.slice(startIndex);
    const sessionId = sessionRuntimeId(session);
    for (const removedMessage of removedMessages) {
      chatWebSocketClient.cancelStreamForTurn({
        sessionId,
        turnScopeId: getMessageTurnScopeId(removedMessage),
        dialogProcessId: getMessageDialogProcessId(removedMessage),
      });
    }
    session.messages = messages.slice(0, startIndex);
    const removedTurnScopeIds = new Set(removedMessages.map(getMessageTurnScopeId).filter(Boolean));
    removedTurnScopeIds.forEach((turnScopeId) => {
      invalidateTerminalResolution(sessionId, turnScopeId);
      removeTurnRuntime(turnRuntimeRegistry.value, turnScopeId, { sessionId });
      clearTurnUiState({ sessionId, turnScopeId });
    });
    syncSessionMessageSummary(session);
    clearPendingInteraction();
    return true;
  }

  async function deleteMonotonicMessage(targetMessage) {
    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const startSession = activeSession.value;
    if (!startSession) return false;
    const initialSessionId = normalizeTrimmedString(activeSessionId.value);
    const initialTurnScopeId = getMessageTurnScopeId(userTargetMessage);
    const anchor = buildMessageAnchor(userTargetMessage);
    if (!initialSessionId || !initialTurnScopeId || !Object.keys(anchor).length) return false;
    const deleteCommandId = `delete:${initialSessionId}:${initialTurnScopeId}`;
    const supersededOperation = messageOperationStore.getActiveOperation(initialSessionId);
    const deleteOperation = messageOperationStore.registerOperation({
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
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
        sessionId: initialSessionId,
        turnScopeId: supersededOperation.turnScopeId,
        source: "delete_superseded_resend",
      });
    }
    logMessageMutationDiagnostics("frontend.messageDelete.started", () => ({
      sessionId: initialSessionId,
      dialogProcessId: getMessageDialogProcessId(userTargetMessage),
      turnScopeId: initialTurnScopeId,
      target: summarizeDeleteMessages([targetMessage])[0] || null,
      resolvedUserTarget: summarizeDeleteMessages([userTargetMessage])[0] || null,
      messagesBefore: summarizeDeleteMessages(startSession.messages),
    }));
    try {
      const prepared = await prepareMonotonicMessageAction();
      if (prepared === false) return false;
      if (normalizeTrimmedString(activeSessionId.value) !== initialSessionId) return false;
      const session = activeSession.value;
      if (!session) return false;
      const sessionId = initialSessionId;
      messageOperationStore.updateOperation(deleteOperation.opId, { status: "deleting" });
      logMessageMutationDiagnostics("frontend.messageDelete.requestPrepared", () => ({
        sessionId,
        dialogProcessId: getMessageDialogProcessId(userTargetMessage),
        turnScopeId: getMessageTurnScopeId(userTargetMessage),
        anchor,
        commandId: deleteCommandId,
      }));
      const sessionAggregateVersionManager = createSessionAggregateVersionManager({
        activeSession,
      });
      const mutationResult = await sessionAggregateVersionManager.runAggregateVersionedMutation({
        mutate: async ({ expectedAggregateVersion }) => {
          const result = await deleteSessionMessagesFromApi(
            {
              userId: userId.value,
              sessionId,
              parentSessionId: normalizeTrimmedString(session.parentSessionId),
              anchor,
              expectedAggregateVersion,
              commandId: deleteCommandId,
            },
            { fetcher: authFetch },
          );
          const payload = typeof result?.json === "function" ? await result.json() : result;
          return { result, payload };
        },
        conflictOptions: {
          sessionId,
          logContext: { turnScopeId: anchor.turnScopeId || "" },
        },
      });
      const result = mutationResult.result;
      const payload = mutationResult.payload;
      const responseOk = result?.ok !== false && payload?.ok !== false;
      logMessageMutationDiagnostics("frontend.messageDelete.responseReceived", () => ({
        sessionId,
        dialogProcessId: getMessageDialogProcessId(userTargetMessage),
        turnScopeId: getMessageTurnScopeId(userTargetMessage),
        responseOk,
        deletedCount: payload?.deletedCount,
        anchorIndex: payload?.anchorIndex,
        deletedTurnScopeIds: payload?.deletedTurnScopeIds,
        responseMessages: responseOk ? summarizeDeleteMessages(payload.session.messages) : [],
      }));
      if (!responseOk) return false;
      const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
      if (!sessionDetail) return false;
      const confirmedDeletedTurnScopeIds = payload.deletedTurnScopeIds;
      confirmTurnRuntimeDeletion(turnRuntimeRegistry.value, confirmedDeletedTurnScopeIds, {
        sessionId,
      });
      cascadeDeleteMessagesFrom(userTargetMessage);
      logMessageMutationDiagnostics("frontend.messageDelete.localCascadeApplied", () => ({
        sessionId,
        dialogProcessId: getMessageDialogProcessId(userTargetMessage),
        turnScopeId: getMessageTurnScopeId(userTargetMessage),
        stage: "before-detail-apply",
        messages: summarizeDeleteMessages(session.messages),
      }));
      applySessionDetail(sessionDetail);
      cascadeDeleteMessagesFrom(userTargetMessage);
      logMessageMutationDiagnostics("frontend.messageDelete.completed", () => ({
        sessionId,
        dialogProcessId: getMessageDialogProcessId(userTargetMessage),
        turnScopeId: getMessageTurnScopeId(userTargetMessage),
        confirmedDeletedTurnScopeIds,
        messagesAfter: summarizeDeleteMessages(session.messages),
      }));
      clearPendingInteraction();
      return true;
    } finally {
      messageOperationStore.completeOperation(deleteOperation.opId);
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
  };
}
