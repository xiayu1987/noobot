/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { commitResendTurnReplacement, RESEND_COMMIT_OUTCOME } from "./resendTurnCommit.js";
import { projectResendReplacement, RESEND_PROJECTION_OUTCOME } from "./resendProjection.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";

function failResend(context, restoredInputValue) {
  const { sessionId, resendTurnScopeId, operation, messageOperationStore, applyRunStateEvent, input } =
    context;
  if (operation) messageOperationStore?.completeOperation(operation.opId);
  applyRunStateEvent?.({
    type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
    sessionId,
    turnScopeId: resendTurnScopeId,
    source: "resend_transaction",
  });
  input.value = restoredInputValue;
  return false;
}

function logResendFailure(context, { error, replacementCommitted }) {
  const { sessionId, resendTurnScopeId, activeSession } = context;
  logStateMachineDebug("stateMachine.resend.failed", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    replacementCommitted,
    errorType: String(error?.name || "Error"),
    errorMessage: String(error?.message || error || "").slice(0, 240),
    messages: (activeSession?.value?.messages || []).map(summarizeStateMachineMessage),
  }));
}

export async function executeResendReplacement(context) {
  const { text, originalInputValue, operation, messageOperationStore } = context;
  let replacementCommitted = false;
  try {
    const commit = await commitResendTurnReplacement(context);
    if (commit.outcome === RESEND_COMMIT_OUTCOME.REJECTED) {
      return failResend(context, originalInputValue);
    }
    if (commit.outcome === RESEND_COMMIT_OUTCOME.ABORTED) return false;
    replacementCommitted = true;
    const projection = await projectResendReplacement({
      ...context,
      turnReplacement: commit.turnReplacement,
      replacedTurnScopeIds: commit.replacedTurnScopeIds,
      session: commit.session,
    });
    if (projection.outcome === RESEND_PROJECTION_OUTCOME.ABORTED) return false;
    if (projection.outcome === RESEND_PROJECTION_OUTCOME.REJECTED) {
      return failResend(context, text);
    }
    if (operation && messageOperationStore?.getOperation(operation.opId)) {
      messageOperationStore.completeOperation(operation.opId);
    }
    return true;
  } catch (error) {
    logResendFailure(context, { error, replacementCommitted });
    return failResend(context, replacementCommitted ? text : originalInputValue);
  }
}
