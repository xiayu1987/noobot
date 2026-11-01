/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnLifecycleRecordIntegrity,
  decideTurnTransition,
  validateTurnLifecycleRequest,
} from "@noobot/session-protocol";
import {
  commitLifecycleTransition,
  decideLifecycleTransitionRequest,
  projectLifecycleTransition,
  resolveLifecycleTransitionRequest,
} from "./turn-lifecycle-transition.js";

export function normalizeTurnLifecycleEntity(source) {
  assertTurnLifecycleRecordIntegrity(source);
  const lifecycle = structuredClone(source);
  for (const turn of Object.values(lifecycle.turns)) {
    if (turn.terminalStatus !== null) Object.freeze(turn.terminalStatus);
  }
  return lifecycle;
}

function rejectionResult(request, decision) {
  const result = {
    applied: false,
    reason: decision.reason,
    lifecycle: request.lifecycle,
  };
  if (decision.reason === "turn_replaced") {
    result.replacement = request.lifecycle.replacedTurns[request.turnScopeId];
  }
  if (decision.reason === "turn_revision_conflict") {
    result.currentRevision = request.current ? request.current.revision : 0;
  }
  if (decision.deduplicated) {
    result.deduplicated = true;
    result.receipt = decision.idempotency.receipt;
    result.turn = request.lifecycle.turns[decision.idempotency.receipt.turnScopeId];
  }
  return result;
}

export function transitionTurnLifecycle(source, input = {}, now = () => new Date().toISOString()) {
  const lifecycle = normalizeTurnLifecycleEntity(source);
  const reason = validateTurnLifecycleRequest(input);
  if (reason) return { applied: false, reason, lifecycle };
  const turnScopeId = input.turnScopeId;
  const current = lifecycle.turns[turnScopeId] || null;
  const request = resolveLifecycleTransitionRequest(lifecycle, input, current);
  const decision = decideLifecycleTransitionRequest(request);
  if (!decision.allowed) return rejectionResult(request, decision);
  const transition = decideTurnTransition({
    current,
    eventType: request.eventType,
    phase: request.phase,
  });
  if (!transition.allowed) return rejectionResult(request, transition);
  const nowValue = now();
  const projection = projectLifecycleTransition(request, transition, nowValue);
  return commitLifecycleTransition(request, projection, decision.requestHash, nowValue);
}
