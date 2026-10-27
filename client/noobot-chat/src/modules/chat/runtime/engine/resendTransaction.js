/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
import { requireFunctionDependencies, text } from "@noobot/shared/value";
import { createTurnScopeId } from "./sendFlowSupport.js";

export { resolveKeptAttachments } from "./resendAttachments.js";

function resolveSessionId(activeSessionId) {
  return normalizeTrimmedString(activeSessionId.value);
}

function operationSeed({ sessionId, turnScopeId }) {
  return {
    type: "resend",
    sessionId,
    turnScopeId,
    status: "pending",
  };
}

function ownsMessageOperation(messageOperationStore, operation) {
  const activeOperation = messageOperationStore.getActiveOperation(operation.sessionId);
  return activeOperation !== null && activeOperation.opId === operation.opId;
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
}) {
  requireFunctionDependencies("createResendMessageTransaction", {
    applyRunStateEvent,
    applySessionDetail,
    authFetch,
    buildMonotonicMessageAnchor,
    prepareMonotonicMessageAction,
    replaceSessionTurnApi,
    resolveMonotonicUserTarget,
    send,
    removeWorkflowOwnersForReplacedTurns,
  });
  const sessionAggregateVersionManager = createSessionAggregateVersionManager({
    activeSession,
    log: (event, payload) =>
      logResendDebug(`resend.${event}`, () => ({
        ...payload,
        messages: summarizeDebugMessages(activeSession.value.messages),
      })),
  });
  const requestReplaceTurn = createReplaceTurnRequester({
    activeSession,
    authFetch,
    replaceSessionTurnApi,
    userId,
  });

  async function resendMonotonicMessage(targetMessage, editedContent, options) {
    const normalizedText = text(editedContent);
    if (!normalizedText) return false;

    const userTargetMessage = resolveMonotonicUserTarget(targetMessage);
    if (!userTargetMessage) return false;
    const originalSession = activeSession.value;
    const originalInputValue = input.value;
    const sessionId = resolveSessionId(activeSessionId);
    const resendTurnScopeId = createTurnScopeId();
    const operation = messageOperationStore.registerOperation(
      operationSeed({
        sessionId,
        turnScopeId: resendTurnScopeId,
      }),
    );
    if (!normalizeTrimmedString(operation.opId)) {
      throw new TypeError("resend command registration failed: missing_command_id");
    }
    const operationGuard = {
      owns: () => ownsMessageOperation(messageOperationStore, operation),
      complete: () => messageOperationStore.completeOperation(operation.opId),
    };
    let preparation;
    try {
      preparation = await prepareResendTransaction({
        buildMonotonicMessageAnchor,
        operationGuard,
        options,
        originalSession,
        prepareMonotonicMessageAction,
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
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId,
      turnScopeId: resendTurnScopeId,
      source: "resend_transaction",
    });
    applyRunStateEvent({
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
      text: normalizedText,
      turnRuntimeRegistry,
      userTargetMessage,
      requestReplaceTurn: ({ expectedAggregateVersion, attempt }) =>
        requestReplaceTurn({
          sessionId,
          originalSession,
          anchor,
          text: normalizedText,
          resendTurnScopeId,
          expectedAggregateVersion,
          commandId: operation.opId,
          attempt,
          attachments: finalAttachments,
        }),
    });
  }

  return {
    resendMonotonicMessage,
  };
}
