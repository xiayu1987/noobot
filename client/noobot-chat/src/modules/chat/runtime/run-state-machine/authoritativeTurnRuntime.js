/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_EVENT } from "./constants.js";
import { isFinalTurnState } from "./turnReducer.js";
import { projectAuthoritativeTurnTerminal } from "./authoritativeTurnProjection.js";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnTerminalResolution,
} from "@noobot/session-protocol";
import { ensureSessionBucket, runtimeText as text } from "./turnRuntimeRegistryIdentity.js";
import {
  applyExecutionProjection,
  runtimeFingerprint as executionFingerprint,
} from "./executionRuntimeProjection.js";
import { resolveTurnRuntimeByScope } from "./turnRuntimeSelectors.js";
import { applyTurnRuntimeEvent } from "./turnRuntimeEventReducer.js";
import { projectTurnLifecycleSnapshot } from "./turnLifecycleSnapshotProjection.js";

function envelopeCoordinateDecision(existing, envelope, fingerprint) {
  if (!existing) return { allowed: true };
  const incomingRevision = Number(envelope.revision || 0);
  const incomingSequence = Number(envelope.sequence || 0);
  const currentRevision = Number(existing.revision || 0);
  const currentSequence = Number(existing.lifecycleSeq || 0);
  if (incomingRevision === currentRevision && incomingSequence === currentSequence) {
    const sameIdentity = text(existing.authoritativeEventId) === text(envelope.eventId);
    const sameContent = existing.authoritativeEventFingerprint === fingerprint;
    return sameIdentity && sameContent
      ? { allowed: false, deduplicated: true, reason: "duplicate_authoritative_event" }
      : { allowed: false, reason: "authoritative_event_coordinate_conflict" };
  }
  if (incomingRevision <= currentRevision || incomingSequence <= currentSequence) {
    return { allowed: false, reason: "stale_authoritative_event" };
  }
  if (
    isFinalTurnState(existing.state, existing) &&
    !projectAuthoritativeTurnTerminal(envelope.state)
  ) {
    return { allowed: false, reason: "terminal_locked" };
  }
  return { allowed: true };
}

function commitEnvelopeProjection(registry, envelope, result, fingerprint) {
  if (result.turn) {
    Object.assign(result.turn, {
      parentSessionId: text(envelope.parentSessionId),
      messageId: text(envelope.messageId),
      presentationMessageId: text(envelope.presentationMessageId),
      phase: text(envelope.phase || envelope.failure?.phase),
      authoritativeEventId: text(envelope.eventId),
      authoritativeEventFingerprint: fingerprint,
    });
  }
  const bucket = ensureSessionBucket(registry, envelope.sessionId);
  bucket.authoritativeSequence = Math.max(
    Number(bucket.authoritativeSequence || 0),
    Number(envelope.sequence || 0),
  );
  bucket.protocolVersion = Number(envelope.protocolVersion || 1);
  applyExecutionProjection(registry, envelope);
}

export function applyTurnLifecycleEnvelope(registry, envelope = {}) {
  const validation = validateTurnLifecycleEnvelope(envelope);
  if (!validation.valid) {
    return {
      registry,
      turn: null,
      applied: false,
      reason: "invalid_authoritative_envelope",
      errors: validation.errors,
    };
  }
  const existing = resolveTurnRuntimeByScope(registry, envelope.turnScopeId, {
    sessionId: envelope.sessionId,
  });
  const fingerprint = executionFingerprint(envelope);
  const decision = envelopeCoordinateDecision(existing, envelope, fingerprint);
  if (!decision.allowed) return { registry, turn: existing, applied: false, ...decision };
  const result = applyTurnRuntimeEvent(registry, {
    ...envelope,
    type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    seq: Number(envelope.sequence || 0),
    source: "turn_lifecycle",
  });
  if (result.applied) commitEnvelopeProjection(registry, envelope, result, fingerprint);
  return result;
}

export function applyTurnTerminalResolution(registry, response = {}) {
  const validation = validateTurnTerminalResolution(response);
  if (!validation.valid || response.resolved !== true) {
    return {
      registry,
      applied: false,
      reason: response.resolved === false ? "terminal_unresolved" : "invalid_terminal_resolution",
      errors: validation.errors,
    };
  }
  const turn = response.turn || {};
  return applyTurnRuntimeEvent(registry, {
    ...turn,
    type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
    authoritativeTurnState: turn.state,
    sessionId: response.sessionId,
    turnScopeId: response.turnScopeId,
    state: turn.state,
    seq: Number(turn.sequence || 0),
    revision: Number(turn.revision || 0),
    completionCommitId: turn.completionCommitId,
    summaryVersion: turn.summaryVersion,
    finalizeIntent: turn.finalizeIntent,
    failure: turn.failure,
    materialization: response.materialization,
    raw: { turn },
    source: "authoritative_terminal_service",
  });
}

export function applyTurnLifecycleSnapshot(registry, snapshot = {}) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid) {
    return {
      applied: false,
      reason: "invalid_authoritative_snapshot",
      errors: validation.errors,
    };
  }
  return projectTurnLifecycleSnapshot(registry, snapshot);
}
