/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { isFinalTurnState } from "./turnReducer.js";
import {
  projectAuthoritativeTurnState,
  projectAuthoritativeTurnTerminal,
} from "./authoritativeTurnProjection.js";
import { deriveTurnEventType, isTerminalTurnState, isSettledTurn } from "@noobot/session-protocol";
import { ensureSessionBucket, isTurnRuntimeDeleted } from "./turnRuntimeRegistryIdentity.js";
import { confirmTurnRuntimeDeletion } from "./turnRuntimeRetention.js";
import { mergeAuthoritativeTurnTiming } from "./turnRuntimeTiming.js";

function snapshotTurnDecision(registry, bucket, source, sessionId, sequence) {
  const { turnScopeId } = source;
  const revision = source.revision;
  if (source.sequence > sequence) return { reason: "invalid_snapshot_turn" };
  if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) return { skipped: true };
  const current = bucket.turns[turnScopeId];
  if (current && Number(current.revision || 0) > revision) return { skipped: true };
  if (
    current?.dialogProcessId &&
    source.dialogProcessId &&
    current.dialogProcessId !== source.dialogProcessId
  ) {
    return { reason: "dialog_process_identity_conflict" };
  }
  const eventType = deriveTurnEventType(source.state, { action: source.action });
  if (!eventType) return { reason: "invalid_snapshot_state" };
  const state = projectAuthoritativeTurnState(source.state);
  if (current && isFinalTurnState(current.state, current) && !isFinalTurnState(state, source)) {
    return { skipped: true };
  }
  return {
    current: current || {},
    eventType,
    revision,
    state,
    sourceIsTerminal: isTerminalTurnState(source.state),
    turnScopeId,
  };
}

function projectSnapshotCompletion(source, current, revision, sourceIsTerminal) {
  const preservesResolution =
    sourceIsTerminal &&
    current.terminalResolved === true &&
    Number(current.revision || 0) >= revision;
  return {
    authoritativeCompletionCommit: sourceIsTerminal
      ? {
          completionCommitId: source.completionCommitId,
          summaryVersion: source.summaryVersion,
          revision,
        }
      : current.authoritativeCompletionCommit || null,
    terminalResolved:
      preservesResolution || (!sourceIsTerminal && current.terminalResolved === true),
  };
}

function projectSnapshotTiming(source, current, sourceIsTerminal) {
  const startedAt = source.startedAt;
  const updatedAt = source.updatedAt;
  return {
    startedAt,
    finishedAt: source.finishedAt,
    finishedAtMs: sourceIsTerminal ? Date.parse(source.finishedAt) : 0,
    updatedAt,
    updatedAtMs: Date.parse(updatedAt),
    timing: mergeAuthoritativeTurnTiming(current.timing, source),
  };
}

function projectSnapshotLifecycle(source, decision) {
  return {
    state: decision.state,
    phase: source.phase,
    revision: decision.revision,
    lifecycleSeq: source.sequence,
    backendState: source.executionState,
    canStop: source.capabilities?.canStop === true,
    terminal: projectAuthoritativeTurnTerminal(source.state),
    action: source.action,
    commandId: source.commandId,
    failure: source.failure,
    lifecycleEventType: decision.eventType,
    finalizeIntent: source.finalizeIntent,
  };
}

function projectSnapshotIdentity(source, sessionId, turnScopeId) {
  return {
    sessionId,
    turnScopeId,
    dialogProcessId: source.dialogProcessId,
    presentationMessageId: source.presentationMessageId,
    continuationSource: source.continuationSource,
    continuedByTurnScopeId: source.continuedByTurnScopeId,
  };
}

function projectSnapshotControl() {
  return {
    commandPending: false,
    pendingCommandId: "",
    pendingCommandType: "",
    transportSeq: 0,
    source: "turn_lifecycle",
    sourceEvent: "backend_turn_lifecycle",
    authority: "none",
    lifecycleObserved: true,
  };
}

function prepareSnapshotTurn(registry, bucket, source, sessionId, sequence) {
  const decision = snapshotTurnDecision(registry, bucket, source, sessionId, sequence);
  if (decision.reason || decision.skipped) return decision;
  const current = decision.current;
  const turn = {
    ...current,
    ...projectSnapshotIdentity(source, sessionId, decision.turnScopeId),
    ...projectSnapshotLifecycle(source, decision),
    ...projectSnapshotCompletion(source, current, decision.revision, decision.sourceIsTerminal),
    ...projectSnapshotTiming(source, current, decision.sourceIsTerminal),
    ...projectSnapshotControl(),
  };
  return { turn };
}

function prepareSnapshotTurns(registry, bucket, snapshot, sessionId, sequence) {
  const turns = [snapshot.activeTurn, ...snapshot.recentTerminalTurns].filter(Boolean);
  const prepared = [];
  for (const source of turns) {
    const result = prepareSnapshotTurn(registry, bucket, source, sessionId, sequence);
    if (result.reason) return result;
    if (result.turn) prepared.push(result.turn);
  }
  return { prepared };
}

function commitSnapshotReplacements(registry, snapshot, sessionId) {
  const replacedTurnScopeIds = snapshot.replacedTurns.map((item) => item.turnScopeId);
  const replacementDeletion = confirmTurnRuntimeDeletion(registry, replacedTurnScopeIds, {
    sessionId,
  });
  return { replacedTurnScopeIds, replacementDeletion };
}

function commitSnapshotMetadata(registry, bucket, snapshot, sessionId, sequence, fingerprint) {
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  const candidateActiveScope = snapshot.activeTurnScopeId;
  const activeScope = isTurnRuntimeDeleted(registry, {
    sessionId,
    turnScopeId: candidateActiveScope,
  })
    ? ""
    : candidateActiveScope;
  bucket.activeTurnScopeId = isSettledTurn(snapshot.activeTurn) ? "" : activeScope;
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = snapshot.protocolVersion;
  bucket.authoritativeSnapshotFingerprint = fingerprint;
}

export function projectTurnLifecycleSnapshot(registry, snapshot) {
  const sessionId = snapshot.sessionId;
  const sequence = snapshot.sequence;
  let bucket = registry.sessions[sessionId] || { turns: {} };
  if (Number(bucket.authoritativeSequence || 0) > sequence) {
    return { applied: false, reason: "stale_snapshot" };
  }
  const fingerprint = JSON.stringify(snapshot);
  if (
    Number(bucket.authoritativeSequence || 0) === sequence &&
    bucket.authoritativeSnapshotFingerprint
  ) {
    if (bucket.authoritativeSnapshotFingerprint === fingerprint) {
      return { applied: false, deduplicated: true, reason: "duplicate_snapshot" };
    }
    return { applied: false, reason: "snapshot_sequence_conflict" };
  }
  const hydration = prepareSnapshotTurns(registry, bucket, snapshot, sessionId, sequence);
  if (hydration.reason) return { applied: false, reason: hydration.reason };
  bucket = ensureSessionBucket(registry, sessionId);
  for (const turn of hydration.prepared) {
    bucket.turns[turn.turnScopeId] = turn;
    registry.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId: turn.turnScopeId };
  }
  const replacement = commitSnapshotReplacements(registry, snapshot, sessionId);
  bucket = ensureSessionBucket(registry, sessionId);
  commitSnapshotMetadata(registry, bucket, snapshot, sessionId, sequence, fingerprint);
  return { applied: true, bucket, ...replacement };
}
