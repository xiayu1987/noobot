/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAuthoritativeTerminalState } from "./constants.js";
import { isFinalTurnState } from "./turnReducer.js";
import {
  projectAuthoritativeTurnState,
  projectAuthoritativeTurnTerminal,
} from "./authoritativeTurnProjection.js";
import { deriveTurnEventType } from "@noobot/session-protocol";
import {
  canonicalTurnScopeId as turnKey,
  ensureSessionBucket,
  isTurnRuntimeDeleted,
  runtimeText as text,
} from "./turnRuntimeRegistryIdentity.js";
import { confirmTurnRuntimeDeletion } from "./turnRuntimeRetention.js";

function snapshotTurnDecision(registry, bucket, source, sessionId, sequence) {
  const turnScopeId = turnKey(source.turnScopeId);
  const revision = Number(source.revision || 0);
  if (!turnScopeId || !Number.isInteger(revision) || revision < 1) {
    return { reason: "invalid_snapshot_turn" };
  }
  if (Number(source.sequence || 0) > sequence) return { reason: "invalid_snapshot_turn" };
  if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) return { skipped: true };
  const current = bucket.turns[turnScopeId];
  if (current && Number(current.revision || 0) > revision) return { skipped: true };
  if (
    current?.dialogProcessId &&
    source.dialogProcessId &&
    text(current.dialogProcessId) !== text(source.dialogProcessId)
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
    sourceIsTerminal: isAuthoritativeTerminalState(source.state),
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
          completionCommitId: text(source.completionCommitId),
          summaryVersion: Number(source.summaryVersion || 0),
          revision,
        }
      : current.authoritativeCompletionCommit || null,
    terminalResolved:
      preservesResolution || (!sourceIsTerminal && current.terminalResolved === true),
    terminalMaterialization: current.terminalMaterialization || null,
  };
}

function projectSnapshotTiming(source, current, sourceIsTerminal) {
  const startedAt = text(
    source.startedAt || source.thinkingStartedAt || source.updatedAt || current.startedAt,
  );
  const updatedAt = text(source.updatedAt || current.updatedAt);
  return {
    startedAt,
    finishedAt: text(source.finishedAt || current.finishedAt),
    finishedAtMs: sourceIsTerminal
      ? Number(Date.parse(source.finishedAt || source.updatedAt) || current.finishedAtMs || 0)
      : Number(current.finishedAtMs || 0),
    updatedAt,
    updatedAtMs: updatedAt ? Date.parse(updatedAt) || 0 : Number(current.updatedAtMs || 0),
  };
}

function projectSnapshotLifecycle(source, current, decision) {
  return {
    state: decision.state,
    phase: text(source.phase || source.failure?.phase),
    revision: decision.revision,
    seq: Number(source.sequence || 0),
    lifecycleSeq: Number(source.sequence || 0),
    backendState: text(source.executionState),
    canStop: source.capabilities?.canStop === true,
    terminal: projectAuthoritativeTurnTerminal(source.state),
    action: text(source.action || current.action || "send"),
    commandId: text(source.commandId || current.commandId),
    failure: source.failure || null,
    lifecycleEventType: decision.eventType || text(current.lifecycleEventType),
    finalizeIntent: source.finalizeIntent || current.finalizeIntent || null,
  };
}

function projectSnapshotIdentity(source, current, sessionId, turnScopeId) {
  return {
    sessionId,
    turnScopeId,
    dialogProcessId: text(source.dialogProcessId),
    messageId: text(source.messageId),
    presentationMessageId: text(source.presentationMessageId),
    parentSessionId: text(source.parentSessionId),
    continuationSource: source.continuationSource || current.continuationSource || null,
    continuedByTurnScopeId: text(source.continuedByTurnScopeId || current.continuedByTurnScopeId),
  };
}

function projectSnapshotControl() {
  return {
    error: null,
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

function hydrateSnapshotTurn(registry, bucket, source, sessionId, sequence) {
  const decision = snapshotTurnDecision(registry, bucket, source, sessionId, sequence);
  if (decision.reason || decision.skipped) return decision;
  const current = decision.current;
  const turn = {
    ...current,
    ...projectSnapshotIdentity(source, current, sessionId, decision.turnScopeId),
    ...projectSnapshotLifecycle(source, current, decision),
    ...projectSnapshotCompletion(source, current, decision.revision, decision.sourceIsTerminal),
    ...projectSnapshotTiming(source, current, decision.sourceIsTerminal),
    ...projectSnapshotControl(),
  };
  bucket.turns[decision.turnScopeId] = turn;
  if (turn.dialogProcessId) {
    registry.routeIndex[turn.dialogProcessId] = {
      sessionId,
      turnScopeId: decision.turnScopeId,
    };
  }
  return { turn };
}

function hydrateSnapshotTurns(registry, bucket, snapshot, sessionId, sequence) {
  const turns = [snapshot.activeTurn, ...snapshot.recentTerminalTurns].filter(Boolean);
  for (const source of turns) {
    const result = hydrateSnapshotTurn(registry, bucket, source, sessionId, sequence);
    if (result.reason) return result;
  }
  return { applied: true };
}

function commitSnapshotReplacements(registry, snapshot, sessionId) {
  const replacedTurnScopeIds = [
    ...new Set(snapshot.replacedTurns.map((item) => turnKey(item.turnScopeId)).filter(Boolean)),
  ];
  const replacementDeletion = confirmTurnRuntimeDeletion(registry, replacedTurnScopeIds, {
    sessionId,
  });
  return { replacedTurnScopeIds, replacementDeletion };
}

function commitSnapshotMetadata(registry, bucket, snapshot, sessionId, sequence, fingerprint) {
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  const candidateActiveScope = turnKey(snapshot.activeTurnScopeId);
  const activeScope = isTurnRuntimeDeleted(registry, {
    sessionId,
    turnScopeId: candidateActiveScope,
  })
    ? ""
    : candidateActiveScope;
  bucket.activeTurnScopeId = isAuthoritativeTerminalState(text(snapshot.activeTurn?.state))
    ? ""
    : activeScope;
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = Number(snapshot.protocolVersion || 1);
  bucket.authoritativeSnapshotFingerprint = fingerprint;
}

export function projectTurnLifecycleSnapshot(registry, snapshot) {
  const sessionId = text(snapshot.sessionId);
  const sequence = Number(snapshot.sequence || 0);
  if (!sessionId || !Number.isInteger(sequence) || sequence < 0) {
    return { applied: false, reason: "invalid_snapshot_identity" };
  }
  let bucket = ensureSessionBucket(registry, sessionId);
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
  const hydration = hydrateSnapshotTurns(registry, bucket, snapshot, sessionId, sequence);
  if (hydration.reason) return { applied: false, reason: hydration.reason };
  const replacement = commitSnapshotReplacements(registry, snapshot, sessionId);
  bucket = ensureSessionBucket(registry, sessionId);
  commitSnapshotMetadata(registry, bucket, snapshot, sessionId, sequence, fingerprint);
  return { applied: true, bucket, ...replacement };
}
