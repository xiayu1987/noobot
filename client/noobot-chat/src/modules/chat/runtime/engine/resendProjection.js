/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { normalizeTrimmedString } from "./utils.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
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

function findReplacementUserMessageByUid({ session, messageUid }) {
  const messages = session.messages;
  const expectedMessageUid = normalizeTrimmedString(messageUid);
  if (!expectedMessageUid) return null;
  return (
    messages.find(
      (message) => normalizeTrimmedString(message?.messageUid) === expectedMessageUid,
    ) || null
  );
}

function applyReplacementProjection({
  sessionId,
  resendTurnScopeId,
  detail,
  applySessionDetail,
  activeSession,
}) {
  logResendDebug("resend.detail.apply.before", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    messages: summarizeDebugMessages(activeSession.value.messages),
  }));
  applySessionDetail(detail);
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
    messages: activeSession.value.messages.map(summarizeStateMachineMessage),
  }));
  logResendDebug("resend.detail.apply.after", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    messages: summarizeDebugMessages(activeSession.value.messages),
  }));
}

export async function projectResendReplacement(context) {
  const {
    sessionId,
    resendTurnScopeId,
    text,
    turnReplacement,
    replacedTurnScopeIds,
    detail,
    pendingDisplayAttachments,
    activeSession,
    applySessionDetail,
    applyRunStateEvent,
    operation,
    messageOperationStore,
    ownsMessageOperation,
    send,
  } = context;
  applyReplacementProjection({
    sessionId,
    resendTurnScopeId,
    detail,
    applySessionDetail,
    activeSession,
  });
  const replacementUserMessage = findReplacementUserMessageByUid({
    session: activeSession.value,
    messageUid: turnReplacement.replacementUserMessageUid,
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
  messageOperationStore.updateOperation(operation.opId, { status: "sending" });
  applyRunStateEvent({
    type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
    sessionId,
    turnScopeId: resendTurnScopeId,
    source: "resend_transaction",
  });
  if (!ownsMessageOperation(messageOperationStore, operation)) {
    return { outcome: RESEND_PROJECTION_OUTCOME.ABORTED };
  }
  logResendDebug("resend.send.before", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    finalAttachments: summarizeDebugAttachments(replacementUserMessage.attachments),
    messages: summarizeDebugMessages(activeSession.value.messages),
  }));
  const sent = await send({
    commandType: AGENT_COMMAND.RESEND,
    messageText: text,
    userMessageId: replacementUserMessage.userMessageId,
    dialogProcessId: turnReplacement.replacementDialogProcessId,
    turnScopeId: resendTurnScopeId,
    attachments: replacementUserMessage.attachments,
  });
  logResendDebug("resend.send.after", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    sent,
    messages: summarizeDebugMessages(activeSession.value.messages),
  }));
  if (!sent) return { outcome: RESEND_PROJECTION_OUTCOME.REJECTED };
  return { outcome: RESEND_PROJECTION_OUTCOME.SENT };
}
