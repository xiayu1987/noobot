/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnReplacementMaterialization } from "@noobot/session-protocol";
import { confirmTurnRuntimeDeletion } from "../run-state-machine/turnRuntimeRegistry.js";
import {
  logResendDebug,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";

export const RESEND_COMMIT_OUTCOME = {
  COMMITTED: "committed",
  REJECTED: "rejected",
  ABORTED: "aborted",
};

function assertReplacementIdentity({ turnReplacement, expectedCommandId, expectedTurnScopeId, replacedTurnScopeId }) {
  if (turnReplacement.commandId !== expectedCommandId) {
    throw new TypeError("invalid turn replacement commit: command_id_mismatch");
  }
  if (turnReplacement.replacementTurnScopeId !== expectedTurnScopeId) {
    throw new TypeError("invalid turn replacement commit: requested_scope_mismatch");
  }
  if (!turnReplacement.replacedTurnScopeIds.includes(replacedTurnScopeId)) {
    throw new TypeError("invalid turn replacement commit: replaced_scope_mismatch");
  }
}

function tombstoneReplacedTurns({
  sessionId,
  resendTurnScopeId,
  replacedTurnScopeIds,
  turnRuntimeRegistry,
  removeWorkflowOwnersForReplacedTurns,
}) {
  const replacementDeletion = confirmTurnRuntimeDeletion(
    turnRuntimeRegistry?.value || turnRuntimeRegistry,
    replacedTurnScopeIds,
    { sessionId },
  );
  const workflowOwnerDeletion = removeWorkflowOwnersForReplacedTurns?.({
    parentSessionId: sessionId,
    replacedTurnScopeIds,
  }) || { removedWorkflowRunIds: [], removedSessionIds: [] };
  logResendDebug("resend.replacedTurns.tombstoned", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    replacedTurnScopeIds,
    confirmedTurnScopeIds: replacementDeletion.confirmedTurnScopeIds,
    removedTurnScopeIds: replacementDeletion.removedTurnScopeIds,
    removedWorkflowRunIds: workflowOwnerDeletion.removedWorkflowRunIds,
    removedSubSessionIds: workflowOwnerDeletion.removedSessionIds,
  }));
}

function logCommitRejected(context, { result, payload, expectedAggregateVersion }) {
  const { sessionId, resendTurnScopeId, anchor, operation, userTargetMessage, activeSession } = context;
  logResendDebug("resend.replaceTurn.failed", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    httpOk: result?.ok,
    status: result?.status,
    statusText: result?.statusText,
    anchor,
    expectedAggregateVersion,
    commandId: operation?.opId || "",
    payload,
    target: summarizeDebugMessage(userTargetMessage),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
}

export async function commitResendTurnReplacement(context) {
  const {
    sessionId,
    resendTurnScopeId,
    oldTurnScopeId,
    operation,
    ownsMessageOperation,
    messageOperationStore,
    sessionAggregateVersionManager,
    requestReplaceTurn,
    turnRuntimeRegistry,
    removeWorkflowOwnersForReplacedTurns,
  } = context;
  const mutationResult = await sessionAggregateVersionManager.runAggregateVersionedMutation({
    shouldRetry: false,
    mutate: ({ expectedAggregateVersion, attempt }) =>
      requestReplaceTurn({ expectedAggregateVersion, attempt }),
  });
  const { result, payload, expectedAggregateVersion } = mutationResult || {};
  logResendDebug("resend.replaceTurn.result", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    ok: result?.ok !== false && payload?.ok !== false,
    generation: payload?.generation,
    generated: payload?.generated,
    replacement: payload?.turnReplacement || null,
  }));
  if (result?.ok === false || payload?.ok === false) {
    logCommitRejected(context, { result, payload, expectedAggregateVersion });
    return { outcome: RESEND_COMMIT_OUTCOME.REJECTED };
  }
  if (!ownsMessageOperation(messageOperationStore, operation)) {
    return { outcome: RESEND_COMMIT_OUTCOME.ABORTED };
  }
  const materialization = assertTurnReplacementMaterialization({
    commit: payload?.turnReplacement,
    session: payload?.session,
  });
  const turnReplacement = materialization.commit;
  assertReplacementIdentity({
    turnReplacement,
    expectedCommandId: operation.opId,
    expectedTurnScopeId: resendTurnScopeId,
    replacedTurnScopeId: oldTurnScopeId,
  });
  const replacedTurnScopeIds = [...turnReplacement.replacedTurnScopeIds];
  tombstoneReplacedTurns({
    sessionId,
    resendTurnScopeId,
    replacedTurnScopeIds,
    turnRuntimeRegistry,
    removeWorkflowOwnersForReplacedTurns,
  });
  if (operation) {
    messageOperationStore?.updateOperation(operation.opId, {
      status: "materializing",
      turnReplacement,
    });
  }
  return {
    outcome: RESEND_COMMIT_OUTCOME.COMMITTED,
    turnReplacement,
    replacedTurnScopeIds,
    session: materialization.session,
  };
}
