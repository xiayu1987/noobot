/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  projectTurnLifecycleRuntimeEvent,
  projectTurnTerminalRuntimeEvent,
} from "@noobot/session-protocol/runtime-event";
import { isFinalTurnState } from "./turnReducer.js";
import { projectAuthoritativeTurnTerminal } from "./authoritativeTurnProjection.js";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnTerminalResolution,
} from "@noobot/session-protocol";
import { ensureSessionBucket } from "./turnRuntimeRegistryIdentity.js";
import {
  applyExecutionProjection,
  runtimeFingerprint as executionFingerprint,
} from "./executionRuntimeProjection.js";
import { resolveTurnRuntimeByScope } from "./turnRuntimeSelectors.js";
import { applyProjectedTurnRuntimeEvent } from "./turnRuntimeEventReducer.js";
import { projectTurnLifecycleSnapshot } from "./turnLifecycleSnapshotProjection.js";

function envelopeCoordinateDecision(existing, envelope, fingerprint) {
  if (!existing) return { allowed: true };
  const incomingRevision = envelope.revision;
  const incomingSequence = envelope.sequence;
  const currentRevision = Number(existing.revision || 0);
  const currentSequence = Number(existing.lifecycleSeq || 0);
  if (incomingRevision === currentRevision && incomingSequence === currentSequence) {
    const sameIdentity = existing.authoritativeEventId === envelope.eventId;
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

function commitEnvelopeProjection(registry, envelope, result, { fingerprint, executionRegistry }) {
  if (result.turn) {
    Object.assign(result.turn, {
      presentationMessageId: envelope.presentationMessageId,
      authoritativeEventId: envelope.eventId,
      authoritativeEventFingerprint: fingerprint,
    });
  }
  const bucket = ensureSessionBucket(registry, envelope.sessionId);
  bucket.authoritativeSequence = Math.max(
    Number(bucket.authoritativeSequence || 0),
    envelope.sequence,
  );
  bucket.protocolVersion = envelope.protocolVersion;
  registry.executions = executionRegistry.executions;
  registry.executionIdByTurnScopeId = executionRegistry.executionIdByTurnScopeId;
}

export function applyTurnLifecycleEnvelope(registry, envelope) {
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
  const executionRegistry = {
    ...registry,
    executions: { ...registry.executions },
    executionIdByTurnScopeId: { ...registry.executionIdByTurnScopeId },
  };
  applyExecutionProjection(executionRegistry, envelope);
  const result = applyProjectedTurnRuntimeEvent(
    registry,
    projectTurnLifecycleRuntimeEvent(envelope),
  );
  if (result.applied) {
    commitEnvelopeProjection(registry, envelope, result, { fingerprint, executionRegistry });
  }
  return result;
}

export function applyTurnTerminalResolution(registry, response) {
  const validation = validateTurnTerminalResolution(response);
  if (!validation.valid) {
    return {
      registry,
      applied: false,
      reason: "invalid_terminal_resolution",
      errors: validation.errors,
    };
  }
  if (response.resolved !== true) throw new TypeError("terminal_resolution_unresolved_apply");
  return applyProjectedTurnRuntimeEvent(registry, projectTurnTerminalRuntimeEvent(response));
}

export function applyTurnLifecycleSnapshot(registry, snapshot) {
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
