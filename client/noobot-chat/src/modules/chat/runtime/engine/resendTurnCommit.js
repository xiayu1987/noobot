/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireTurnReplaceResponse } from "@noobot/session-protocol";
import { confirmTurnRuntimeDeletion } from "../run-state-machine/turnRuntimeRegistry.js";
import { logResendDebug } from "../../../debug/loggers/resendDebugLogger.js";

export const RESEND_COMMIT_OUTCOME = {
  COMMITTED: "committed",
  ABORTED: "aborted",
};

function assertReplacementIdentity({
  turnReplacement,
  expectedCommandId,
  expectedTurnScopeId,
  replacedTurnScopeId,
}) {
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
    turnRuntimeRegistry.value,
    replacedTurnScopeIds,
    { sessionId },
  );
  const workflowOwnerDeletion = removeWorkflowOwnersForReplacedTurns({
    parentSessionId: sessionId,
    replacedTurnScopeIds,
  });
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
    conflictOptions: { sessionId, logContext: { turnScopeId: resendTurnScopeId } },
    mutate: ({ expectedAggregateVersion, attempt }) =>
      requestReplaceTurn({ expectedAggregateVersion, attempt }),
  });
  const { payload } = mutationResult;
  logResendDebug("resend.replaceTurn.result", () => ({
    sessionId,
    turnScopeId: resendTurnScopeId,
    ok: true,
  }));
  if (!ownsMessageOperation(messageOperationStore, operation)) {
    return { outcome: RESEND_COMMIT_OUTCOME.ABORTED };
  }
  const response = requireTurnReplaceResponse(payload);
  const turnReplacement = response.turnReplacement;
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
  messageOperationStore.updateOperation(operation.opId, {
    status: "materializing",
    turnReplacement,
  });
  return {
    outcome: RESEND_COMMIT_OUTCOME.COMMITTED,
    turnReplacement,
    replacedTurnScopeIds,
    detail: response.detail,
  };
}
