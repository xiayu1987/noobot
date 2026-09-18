/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { SESSION_DETAIL_APPLY_MODE } from "./messageStateGuards.js";
import { enrichPersistedAttachmentsWithDraftMetadata } from "./resendAttachments.js";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";

export const RESEND_PROJECTION_OUTCOME = {
  SENT: "sent",
  REJECTED: "rejected",
  ABORTED: "aborted",
};

function findReplacementUserMessageById({ session, messageId }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const expectedMessageId = normalizeTrimmedString(messageId);
  if (!expectedMessageId) return null;
  return (
    messages.find((message) => normalizeTrimmedString(message?.messageId) === expectedMessageId) ||
    null
  );
}

function createSessionDetailSnapshot(session = {}) {
  return {
    sessionId: session.sessionId,
    sessions: [session],
  };
}

function applyReplacementProjection({
  sessionId,
  resendTurnScopeId,
  session,
  replacedTurnScopeIds,
  applySessionDetail,
  activeSession,
}) {
  const sessionDetail = createSessionDetailSnapshot(session);
  logResendDebug("resend.detail.apply.before", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  applySessionDetail?.(sessionDetail, {
    mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
    deletedTurnScopeIds: replacedTurnScopeIds,
  });
}

function logMaterializationCommitted({
  sessionId,
  resendTurnScopeId,
  turnReplacement,
  replacedTurnScopeIds,
  replacementUserMessage,
  activeSession,
}) {
  logStateMachineDebug("stateMachine.resend.materializationCommitted", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    committedAggregateVersion: turnReplacement.committedAggregateVersion,
    replacedTurnScopeIds,
    replacementUser: summarizeStateMachineMessage(replacementUserMessage),
    messages: (activeSession?.value?.messages || []).map(summarizeStateMachineMessage),
  }));
  logResendDebug("resend.detail.apply.after", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
}

export async function projectResendReplacement(context) {
  const {
    sessionId,
    resendTurnScopeId,
    text,
    turnReplacement,
    replacedTurnScopeIds,
    session,
    pendingDisplayAttachments,
    activeSession,
    applySessionDetail,
    applyRunStateEvent,
    input,
    operation,
    messageOperationStore,
    ownsMessageOperation,
    send,
  } = context;
  applyReplacementProjection({
    sessionId,
    resendTurnScopeId,
    session,
    replacedTurnScopeIds,
    applySessionDetail,
    activeSession,
  });
  const replacementUserMessage = findReplacementUserMessageById({
    session: activeSession?.value,
    messageId: turnReplacement.replacementUserMessageId,
  });
  if (!replacementUserMessage) {
    throw new TypeError("invalid turn replacement projection: replacement_user_missing");
  }
  logMaterializationCommitted({
    sessionId,
    resendTurnScopeId,
    turnReplacement,
    replacedTurnScopeIds,
    replacementUserMessage,
    activeSession,
  });
  replacementUserMessage.attachments = enrichPersistedAttachmentsWithDraftMetadata(
    replacementUserMessage.attachments || [],
    pendingDisplayAttachments,
  );
  delete replacementUserMessage.terminalOutcome;
  if (operation) messageOperationStore?.updateOperation(operation.opId, { status: "sending" });
  applyRunStateEvent?.({
    type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
    sessionId,
    turnScopeId: resendTurnScopeId,
    source: "resend_transaction",
  });
  if (!ownsMessageOperation(messageOperationStore, operation)) {
    return { outcome: RESEND_PROJECTION_OUTCOME.ABORTED };
  }
  input.value = text;
  logResendDebug("resend.send.before", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    finalAttachments: summarizeDebugAttachments(replacementUserMessage.attachments),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  const sent = await send?.({
    messageText: text,
    reuseExistingUserTurn: true,
    userMessageId: normalizeTrimmedString(replacementUserMessage?.messageId),
    dialogProcessId: turnReplacement.replacementDialogProcessId,
    turnScopeId: resendTurnScopeId,
    allowDuringResend: true,
    attachmentFiles: [],
    userAttachments: replacementUserMessage.attachments,
    transportAttachments: replacementUserMessage.attachments,
  });
  logResendDebug("resend.send.after", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    sent,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  if (!sent) return { outcome: RESEND_PROJECTION_OUTCOME.REJECTED };
  return { outcome: RESEND_PROJECTION_OUTCOME.SENT };
}
