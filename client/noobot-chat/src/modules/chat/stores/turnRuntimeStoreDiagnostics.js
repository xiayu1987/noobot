/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function text(value) {
  return String(value || "").trim();
}

function preferText(...values) {
  for (const value of values) {
    const resolved = text(value);
    if (resolved) return resolved;
  }
  return "";
}

function count(value) {
  return Number(value || 0);
}

export function buildTurnEvaluatedDiagnostics({ reducer, input, result, applied }) {
  const turn = result?.turn;
  return {
    sessionId: preferText(
      turn?.parentSessionId,
      input?.parentSessionId,
      turn?.sessionId,
      input?.sessionId,
    ),
    nodeSessionId: preferText(turn?.sessionId, input?.sessionId),
    parentSessionId: preferText(turn?.parentSessionId, input?.parentSessionId),
    dialogProcessId: preferText(turn?.dialogProcessId, input?.dialogProcessId),
    turnScopeId: preferText(turn?.turnScopeId, input?.turnScopeId),
    reducer,
    eventType: preferText(input?.eventType, input?.type),
    applied,
    reason: text(result?.reason),
    state: text(turn?.state),
    terminal: text(turn?.terminal),
  };
}

export function buildCommitProjectionDiagnostics({
  turn,
  result,
  sessionId,
  parentSessionId,
  existingSubSession,
  projectionEligible,
}) {
  return {
    sessionId: parentSessionId || sessionId,
    nodeSessionId: sessionId,
    parentSessionId,
    dialogProcessId: text(turn?.dialogProcessId),
    turnScopeId: text(turn?.turnScopeId),
    state: text(turn?.state),
    terminal: text(turn?.terminal),
    applied: result?.applied === true,
    existingSubSession,
    projectionEligible,
  };
}

export function buildMessageProjectionDiagnostics({
  turn,
  sessionId,
  parentSessionId,
  mainSessionProjection,
  subSessionProjection,
}) {
  return {
    sessionId: parentSessionId || sessionId,
    nodeSessionId: sessionId,
    parentSessionId,
    dialogProcessId: text(turn?.dialogProcessId),
    turnScopeId: text(turn?.turnScopeId),
    messageId: text(turn?.messageId),
    presentationMessageId: text(turn?.presentationMessageId),
    state: text(turn?.state),
    terminal: text(turn?.terminal),
    mainSessionProjectionReason: text(mainSessionProjection?.reason),
    mainSessionPatchedMessageCount: count(mainSessionProjection?.patchedMessageCount),
    subSessionProjectionReason: text(subSessionProjection?.reason),
    subSessionPatchedMessageCount: count(subSessionProjection?.patchedMessageCount),
  };
}
