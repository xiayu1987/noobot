/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function text(value) {
  return String(value || "").trim();
}

function count(value) {
  return Number(value || 0);
}

function turnIdentity(source) {
  return {
    sessionId: text(source?.sessionId),
    parentSessionId: text(source?.parentSessionId),
    dialogProcessId: text(source?.dialogProcessId),
    turnScopeId: text(source?.turnScopeId),
  };
}

export function buildTurnEvaluatedDiagnostics({ reducer, input, result, applied }) {
  const turn = result?.turn;
  return {
    ...turnIdentity(turn || input),
    reducer,
    eventType: text(input?.eventType || input?.type),
    applied,
    reason: text(result?.reason),
    state: text(turn?.state),
    terminal: text(turn?.terminal),
  };
}

export function buildCommitProjectionDiagnostics({
  turn,
  result,
  existingSubSession,
  projectionEligible,
}) {
  return {
    ...turnIdentity(turn),
    state: text(turn?.state),
    terminal: text(turn?.terminal),
    applied: result?.applied === true,
    existingSubSession,
    projectionEligible,
  };
}

export function buildMessageProjectionDiagnostics({
  turn,
  mainSessionProjection,
  subSessionProjection,
}) {
  return {
    ...turnIdentity(turn),
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
