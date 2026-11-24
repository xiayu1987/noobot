/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";

export function processingTurnChanges({
  sessionId,
  dialogProcessId,
  turnScopeId,
  presentationMessageId,
}) {
  const scope = { sessionId, dialogProcessId, turnScopeId, presentationMessageId };
  return [
    {
      turnTransition: {
        ...scope,
        eventType: TURN_EVENT.ACTION_ACCEPTED,
        phase: TURN_PHASE.ACTION,
        action: "send",
        commandId: `${turnScopeId}:accept`,
        causationId: `${turnScopeId}:accept`,
        expectedRevision: 0,
        executionId: `agent:${turnScopeId}`,
        executionKind: "agent",
        rootExecutionId: `agent:${turnScopeId}`,
      },
    },
    {
      turnTransition: {
        ...scope,
        eventType: TURN_EVENT.PROCESSING_STARTED,
        phase: TURN_PHASE.PROCESSING,
        commandId: `${turnScopeId}:start`,
        causationId: `${turnScopeId}:start`,
        expectedRevision: 1,
      },
    },
  ];
}

export function completedTurnChanges(scope) {
  const completionCommitId = `${scope.turnScopeId}:completion`;
  return [
    ...processingTurnChanges(scope),
    {
      turnTransition: {
        ...scope,
        eventType: TURN_EVENT.PROCESSING_COMPLETED,
        phase: TURN_PHASE.COMPLETION,
        commandId: `${scope.turnScopeId}:prepare-completion`,
        causationId: `${scope.turnScopeId}:prepare-completion`,
        expectedRevision: 2,
        completionCommitId,
      },
    },
    {
      turnTransition: {
        ...scope,
        eventType: TURN_EVENT.COMPLETED,
        phase: TURN_PHASE.COMPLETION,
        commandId: completionCommitId,
        causationId: completionCommitId,
        expectedRevision: 3,
        summaryVersion: 1,
        terminalStatus: { command: "completed" },
      },
    },
  ];
}
