/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "../../../../shared/identity/secureIdentity.js";
import { normalizeTrimmedString } from "./utils.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { createSessionAggregateVersionManager } from "./sessionAggregateVersionManager.js";
import { prepareResendTransaction } from "./resendPreparation.js";
import { executeResendReplacement } from "./resendExecution.js";
import { createReplaceTurnRequester } from "./resendTurnRequest.js";

export { resolveKeptAttachments } from "./resendAttachments.js";

function resolveSessionId(activeSession, activeSessionId) {
  return normalizeTrimmedString(activeSession?.value?.sessionId || activeSessionId?.value);
}

function operationSeed({ sessionId, turnScopeId }) {
  return {
    type: "resend",
    sessionId,
    turnScopeId,
    status: "pending",
  };
}

function ownsMessageOperation(messageOperationStore, operation = null) {
  if (!operation || typeof messageOperationStore?.getActiveOperation !== "function") return true;
  return messageOperationStore.getActiveOperation(operation.sessionId)?.opId === operation.opId;
}

function finalizePendingResendOperationFor({ activeSession, activeSessionId, messageOperationStore }) {
  const sessionId = resolveSessionId(activeSession, activeSessionId);
  const operation =
    messageOperationStore?.getActiveOperation(sessionId, "resend") ||
    messageOperationStore?.getLatestOperation("resend");
  if (!operation) return false;
  messageOperationStore?.completeOperation(operation.opId);
  return true;
}

function createTurnScopeId() {
  return createSecureId("client-turn");
}

export function createResendMessageTransaction({
  activeSession,
  activeSessionId,
  applyRunStateEvent,
  applySessionDetail,
  authFetch,
  buildMonotonicMessageAnchor,
  input,
  messageOperationStore,
  prepareMonotonicMessageAction,
  replaceSessionTurnApi,
  resolveMonotonicUserTarget,
  send,
  userId,
  turnRuntimeRegistry,
  removeWorkflowOwnersForReplacedTurns,
} = {}) {
  const finalizePendingResendOperation = () =>
    finalizePendingResendOperationFor({ activeSession, activeSessionId, messageOperationStore });
  const sessionAggregateVersionManager = createSessionAggregateVersionManager({
    activeSession,
    log: (event, payload) =>
      logResendDebug(`resend.${event}`, () => ({
        ...payload,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      })),
  });
  const requestReplaceTurn = createReplaceTurnRequester({
    activeSession,
    authFetch,
    replaceSessionTurnApi,
    userId,
  });

  async function resendMonotonicMessage(targetMessage = {}, editedContent = "", options = {}) {
    const text = String(editedContent || "").trim();
    if (!text) return false;

    const userTargetMessage = resolveMonotonicUserTarget?.(targetMessage);
    if (!userTargetMessage) return false;
    const originalSession = activeSession?.value;
    const originalInputValue = input?.value;
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const resendTurnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    const operation = messageOperationStore?.registerOperation(
      operationSeed({
        sessionId,
        turnScopeId: resendTurnScopeId,
      }),
    );
    if (!normalizeTrimmedString(operation?.opId)) {
      throw new TypeError("resend command registration failed: missing_command_id");
    }
    const operationGuard = {
      owns: () => ownsMessageOperation(messageOperationStore, operation),
      complete: () => messageOperationStore?.completeOperation(operation.opId),
    };
    let preparation;
    try {
      preparation = await prepareResendTransaction({
        buildMonotonicMessageAnchor,
        operationGuard,
        options,
        originalSession,
        prepareMonotonicMessageAction,
        replaceSessionTurnApi,
        resendTurnScopeId,
        sessionId,
        userTargetMessage,
      });
    } catch (error) {
      operationGuard.complete();
      throw error;
    }
    if (preparation.rejected) {
      operationGuard.complete();
      return false;
    }
    if (preparation.aborted) return false;
    const { anchor, finalAttachments, oldTurnScopeId, pendingDisplayAttachments } = preparation;
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId,
      turnScopeId: resendTurnScopeId,
      source: "resend_transaction",
    });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
      sessionId,
      turnScopeId: resendTurnScopeId,
      source: "resend_transaction",
    });
    return executeResendReplacement({
      activeSession,
      applyRunStateEvent,
      applySessionDetail,
      anchor,
      input,
      messageOperationStore,
      oldTurnScopeId,
      operation,
      originalInputValue,
      ownsMessageOperation,
      pendingDisplayAttachments,
      removeWorkflowOwnersForReplacedTurns,
      resendTurnScopeId,
      send,
      sessionAggregateVersionManager,
      sessionId,
      text,
      turnRuntimeRegistry,
      userTargetMessage,
      requestReplaceTurn: ({ expectedAggregateVersion, attempt }) =>
        requestReplaceTurn({
          sessionId,
          originalSession,
          anchor,
          text,
          resendTurnScopeId,
          expectedAggregateVersion,
          commandId: operation?.opId || "",
          attempt,
          attachments: finalAttachments,
        }),
    });
  }

  return {
    finalizePendingResendOperation,
    resendMonotonicMessage,
  };
}
