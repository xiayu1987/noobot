/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAuthoritativeTerminalState, SESSION_RUN_EVENT } from "./constants.js";
import { isFinalTurnState } from "./turnReducer.js";
import {
  projectAuthoritativeTurnState,
  projectAuthoritativeTurnTerminal,
} from "./authoritativeTurnProjection.js";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnTerminalResolution,
} from "@noobot/session-protocol";
import {
  canonicalTurnScopeId as turnKey,
  ensureSessionBucket,
  isTurnRuntimeDeleted,
  runtimeText as text,
} from "./turnRuntimeRegistryIdentity.js";
import {
  applyExecutionProjection,
  runtimeFingerprint as executionFingerprint,
} from "./executionRuntimeProjection.js";
import { resolveTurnRuntimeByScope } from "./turnRuntimeSelectors.js";
import { confirmTurnRuntimeDeletion } from "./turnRuntimeRetention.js";
import { applyTurnRuntimeEvent } from "./turnRuntimeEventReducer.js";

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
  const incomingRevision = Number(envelope.revision || 0);
  const incomingSequence = Number(envelope.sequence || 0);
  const currentRevision = Number(existing?.revision || 0);
  const currentSequence = Number(existing?.lifecycleSeq || 0);
  const fingerprint = executionFingerprint(envelope);
  if (existing && incomingRevision === currentRevision && incomingSequence === currentSequence) {
    if (
      text(existing.authoritativeEventId) === text(envelope.eventId) &&
      existing.authoritativeEventFingerprint === fingerprint
    ) {
      return {
        registry,
        turn: existing,
        applied: false,
        deduplicated: true,
        reason: "duplicate_authoritative_event",
      };
    }
    return {
      registry,
      turn: existing,
      applied: false,
      reason: "authoritative_event_coordinate_conflict",
    };
  }
  if (existing && (incomingRevision <= currentRevision || incomingSequence <= currentSequence)) {
    return { registry, turn: existing, applied: false, reason: "stale_authoritative_event" };
  }
  if (
    existing &&
    isFinalTurnState(existing.state, existing) &&
    !projectAuthoritativeTurnTerminal(envelope.state)
  ) {
    return { registry, turn: existing, applied: false, reason: "terminal_locked" };
  }
  const result = applyTurnRuntimeEvent(registry, {
    ...envelope,
    type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    seq: Number(envelope?.sequence || 0),
    source: "turn_lifecycle",
  });
  if (result.applied) {
    // Keep envelope identity and lifecycle metadata in the same canonical
    // Turn projection used by snapshot hydration. These are business
    // identity fields, not a snapshot-specific observation flag.
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

const SNAPSHOT_STATE_EVENT = Object.freeze({
  action_requesting: "turn.action_accepted",
  processing: "turn.processing_started",
  completion_requesting: "turn.processing_completed",
  completed: "turn.completed",
  stopping: "turn.stop_processing_completed",
  stop_completed: "turn.stop_completed",
  action_failed: "turn.failed",
  processing_failed: "turn.failed",
  completion_failed: "turn.failed",
  stop_failed: "turn.failed",
});

export function applyTurnLifecycleSnapshot(registry, snapshot = {}) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid)
    return { applied: false, reason: "invalid_authoritative_snapshot", errors: validation.errors };
  const sessionId = text(snapshot.sessionId);
  const sequence = Number(snapshot.sequence || 0);
  if (!sessionId || !Number.isInteger(sequence) || sequence < 0)
    return { applied: false, reason: "invalid_snapshot_identity" };
  let bucket = ensureSessionBucket(registry, sessionId);
  if (Number(bucket.authoritativeSequence || 0) > sequence)
    return { applied: false, reason: "stale_snapshot" };
  const fingerprint = JSON.stringify(snapshot);
  if (
    Number(bucket.authoritativeSequence || 0) === sequence &&
    bucket.authoritativeSnapshotFingerprint
  ) {
    if (bucket.authoritativeSnapshotFingerprint === fingerprint)
      return { applied: false, deduplicated: true, reason: "duplicate_snapshot" };
    return { applied: false, reason: "snapshot_sequence_conflict" };
  }
  const turns = [
    snapshot.activeTurn,
    ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : []),
  ].filter(Boolean);
  for (const source of turns) {
    const turnScopeId = turnKey(source.turnScopeId);
    const revision = Number(source.revision || 0);
    if (
      !turnScopeId ||
      !Number.isInteger(revision) ||
      revision < 1 ||
      Number(source.sequence || 0) > sequence
    ) {
      return { applied: false, reason: "invalid_snapshot_turn" };
    }
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) continue;
    const current = bucket.turns[turnScopeId];
    if (current && Number(current.revision || 0) > revision) continue;
    if (
      current?.dialogProcessId &&
      source.dialogProcessId &&
      text(current.dialogProcessId) !== text(source.dialogProcessId)
    ) {
      return { applied: false, reason: "dialog_process_identity_conflict" };
    }
    const eventType = SNAPSHOT_STATE_EVENT[text(source.state)];
    if (!eventType) return { applied: false, reason: "invalid_snapshot_state" };
    const sourceIsTerminal = isAuthoritativeTerminalState(source.state);
    const phase = text(source.phase || source.failure?.phase);
    const state = projectAuthoritativeTurnState(source.state);
    if (current && isFinalTurnState(current.state, current) && !isFinalTurnState(state, source))
      continue;
    const terminal = projectAuthoritativeTurnTerminal(source.state);
    const preservesTerminalResolution =
      sourceIsTerminal &&
      current?.terminalResolved === true &&
      Number(current?.revision || 0) >= revision;
    const action = text(source.action || current?.action || "send");
    const commandId = text(source.commandId || current?.commandId);
    const startedAt = text(
      source.startedAt || source.thinkingStartedAt || source.updatedAt || current?.startedAt,
    );
    const updatedAt = text(source.updatedAt || current?.updatedAt);
    const turn = {
      ...(current || {}),
      sessionId,
      turnScopeId,
      dialogProcessId: text(source.dialogProcessId),
      state,
      phase,
      revision,
      seq: Number(source.sequence || 0),
      lifecycleSeq: Number(source.sequence || 0),
      backendState: text(source.executionState),
      canStop: source.capabilities?.canStop === true,
      terminal,
      action,
      commandId,
      messageId: text(source.messageId),
      presentationMessageId: text(source.presentationMessageId),
      failure: source.failure || null,
      lifecycleEventType:
        SNAPSHOT_STATE_EVENT[text(source.state)] || text(current?.lifecycleEventType),
      authoritativeCompletionCommit: sourceIsTerminal
        ? {
            completionCommitId: text(source.completionCommitId),
            summaryVersion: Number(source.summaryVersion || 0),
            revision,
          }
        : current?.authoritativeCompletionCommit || null,
      terminalResolved:
        preservesTerminalResolution || (!sourceIsTerminal && current?.terminalResolved === true),
      startedAt,
      finishedAt: text(source.finishedAt || current?.finishedAt),
      finishedAtMs: sourceIsTerminal
        ? Number(Date.parse(source.finishedAt || source.updatedAt) || current?.finishedAtMs || 0)
        : Number(current?.finishedAtMs || 0),
      updatedAt,
      updatedAtMs: updatedAt ? Date.parse(updatedAt) || 0 : Number(current?.updatedAtMs || 0),
      error: null,
      finalizeIntent: source.finalizeIntent || current?.finalizeIntent || null,
      continuationSource: source.continuationSource || current?.continuationSource || null,
      continuedByTurnScopeId: text(
        source.continuedByTurnScopeId || current?.continuedByTurnScopeId,
      ),
      commandPending: false,
      pendingCommandId: "",
      pendingCommandType: "",
      transportSeq: 0,
      terminalMaterialization: current?.terminalMaterialization || null,
      parentSessionId: text(source.parentSessionId),
      source: "turn_lifecycle",
      sourceEvent: "backend_turn_lifecycle",
      authority: "none",
      lifecycleObserved: true,
    };
    bucket.turns[turnScopeId] = turn;
    if (turn.dialogProcessId)
      registry.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  }
  const replacedTurnScopeIds = [
    ...new Set(
      snapshot.replacedTurns
        .map((replacement) => turnKey(replacement?.turnScopeId))
        .filter(Boolean),
    ),
  ];
  const replacementDeletion = confirmTurnRuntimeDeletion(registry, replacedTurnScopeIds, {
    sessionId,
  });
  bucket = ensureSessionBucket(registry, sessionId);
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  const candidateSnapshotActiveScope = turnKey(snapshot.activeTurnScopeId);
  const snapshotActiveScope = isTurnRuntimeDeleted(registry, {
    sessionId,
    turnScopeId: candidateSnapshotActiveScope,
  })
    ? ""
    : candidateSnapshotActiveScope;
  const snapshotActiveState = text(snapshot.activeTurn?.state);
  const snapshotActiveIsTerminal = isAuthoritativeTerminalState(snapshotActiveState);
  bucket.activeTurnScopeId = snapshotActiveIsTerminal ? "" : snapshotActiveScope;
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = Number(snapshot.protocolVersion || 1);
  bucket.authoritativeSnapshotFingerprint = fingerprint;
  return { applied: true, bucket, replacedTurnScopeIds, replacementDeletion };
}
