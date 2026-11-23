/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { assertSessionAggregateInvariants } from "./aggregate/session-invariants.js";
import { assertSessionScopeIdentity } from "./errors.js";
import { isCanonicalMessageTimestamp } from "./message-entity-contract.js";
import { decideTurnAcceptanceVersionAdvance } from "./turn-acceptance.js";
import { TURN_ACTION } from "./lifecycle/turn-action.js";

function invalid(message) {
  throw Object.assign(new TypeError(message), { code: "SESSION_COMMIT_INPUT_INVALID" });
}

export function requireSessionInitialTurn(input, sessionId) {
  if (input === null) return;
  const { changes } = input ?? {};
  const { turnTransition, messages } = changes ?? {};
  if (
    !isPlainObject(input) ||
    Object.keys(input).length !== 2 ||
    !isCanonicalMessageTimestamp(input.committedAt) ||
    !isPlainObject(changes) ||
    Object.keys(changes).length !== 2 ||
    !Array.isArray(messages) ||
    messages.length !== 1 ||
    !isPlainObject(messages[0]) ||
    !isPlainObject(turnTransition) ||
    turnTransition.action !== TURN_ACTION.SEND ||
    turnTransition.sessionId !== sessionId ||
    messages[0].sessionId !== sessionId ||
    messages[0].turnScopeId !== turnTransition.turnScopeId ||
    messages[0].dialogProcessId !== turnTransition.dialogProcessId ||
    !decideTurnAcceptanceVersionAdvance(turnTransition, messages)
  )
    invalid("Session initialization requires one accepted send and its user message");
}

export function requireSessionInitialization({ session, initialTurn }, scope) {
  assertSessionAggregateInvariants(session);
  assertSessionScopeIdentity({ session, ...scope });
  if (!isCanonicalMessageTimestamp(session.createdAt) || session.updatedAt !== session.createdAt)
    invalid("Session initialization requires canonical creation timestamps");
  const {
    messages,
    dialogOrder,
    turnTimings,
    sessionArtifactEvents,
    turnLifecycle,
    turnSummaryCheckpoints,
    ...metadata
  } = session;
  if (
    session.aggregateVersion !== 0 ||
    messages.length ||
    dialogOrder.length ||
    turnTimings.length ||
    !Array.isArray(sessionArtifactEvents) ||
    sessionArtifactEvents.length ||
    turnLifecycle.sequence !== 0 ||
    turnLifecycle.activeTurnScopeId !== "" ||
    Object.keys(turnLifecycle.turns).length ||
    Object.keys(turnLifecycle.replacedTurns).length ||
    turnLifecycle.commandReceipts.length ||
    (turnSummaryCheckpoints !== undefined &&
      (!isPlainObject(turnSummaryCheckpoints) || Object.keys(turnSummaryCheckpoints).length))
  )
    invalid("Session initialization requires an empty new session");
  requireSessionInitialTurn(initialTurn, session.sessionId);
  return { metadata, turnLifecycle };
}
