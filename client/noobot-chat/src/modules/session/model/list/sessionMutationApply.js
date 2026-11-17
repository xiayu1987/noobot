/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionDetailDocument,
  createTurnLifecycleSnapshot,
  decideSessionMutationApplication,
  isSessionDetailEntryCurrent,
  isTerminalTurnState,
  projectTurnTiming,
  requireMessageDeleteResponse,
  requireSessionDetailDocument,
  requireTurnReplaceResponse,
  selectMainSessionDetailEntry,
} from "@noobot/session-protocol";
import { findSessionByAnyId } from "../../../chat/model/sessionIdentity.js";

function mergeEntities(values, changes) {
  const indexed = new Map(values.map((value) => [value.turnScopeId, value]));
  for (const { key, value } of changes) {
    if (value === null) indexed.delete(key);
    else indexed.set(key, value);
  }
  return [...indexed.values()];
}

function projectMutationDetail(main, response, sessions) {
  const { projection, displayMessages, sessionId } = response;
  const old = main.turnLifecycleSnapshot;
  const timings = mergeEntities(main.turnTimings, projection.timings);
  const turns = mergeEntities(
    [...(old.activeTurn === null ? [] : [old.activeTurn]), ...old.recentTerminalTurns],
    projection.turns,
  );
  const active = turns.find(
    (turn) => turn.turnScopeId === projection.lifecycleHead.activeTurnScopeId,
  );
  if (projection.lifecycleHead.activeTurnScopeId && !active)
    throw new TypeError("Mutation predecessor is missing the active turn");
  const replacements = mergeEntities(old.replacedTurns, projection.replacements);
  const replaced = new Set(replacements.map((turn) => turn.turnScopeId));
  const lifecycle = createTurnLifecycleSnapshot({
    commandId: projection.receipt.commandId,
    sessionId,
    ...projection.lifecycleHead,
    activeTurn: active ? { ...projectTurnTiming(active, timings), sessionId } : null,
    recentTerminalTurns: turns
      .filter((turn) => !replaced.has(turn.turnScopeId) && isTerminalTurnState(turn.state))
      .map((turn) => ({ ...projectTurnTiming(turn, timings), sessionId })),
    replacedTurns: replacements,
    unchanged: false,
    recovery: old.recovery,
    generatedAt: projection.receipt.committedAt,
  });
  const removed = new Set(projection.deletedMessageUids);
  const deletedScopes = new Set(
    projection.turns.filter((entry) => entry.value === null).map((entry) => entry.key),
  );
  for (const scope of replaced) deletedScopes.add(scope);
  const { metadata } = projection;
  const next = {
    ...main,
    aggregateVersion: projection.receipt.aggregateVersion,
    generation: projection.generation,
    updatedAt: metadata.updatedAt,
    title: metadata.customTitle || metadata.autoTitle || sessionId.slice(0, 8),
    turnTimings: timings,
    turnLifecycleSnapshot: lifecycle,
    messages: [
      ...main.messages.filter(
        (message) => !removed.has(message.messageUid) && !deletedScopes.has(message.turnScopeId),
      ),
      ...displayMessages,
    ],
  };
  return createSessionDetailDocument({
    sessionId,
    sessions: sessions.map((entry) => (entry === main ? next : entry)),
  });
}

export function createSessionMutationApplicator({
  sessions,
  applySessionDetail,
  fetchSessionDetail,
}) {
  return async function applySessionMutation(input) {
    const response = Object.hasOwn(input, "turnReplacement")
      ? requireTurnReplaceResponse(input)
      : requireMessageDeleteResponse(input);
    const target = findSessionByAnyId(sessions.value, response.sessionId);
    if (!target) return false;
    const docs = Array.isArray(target.sessionDocs) ? target.sessionDocs : [];
    const main = docs.find((entry) => entry.sessionId === response.sessionId);
    const decision = decideSessionMutationApplication({
      sessionId: response.sessionId,
      projection: response.projection,
      appliedGeneration: main?.generation ?? null,
      knownGeneration:
        target.generation === null
          ? response.generation
          : Math.max(target.generation, response.generation),
      currentGeneration: response.generation,
    });
    if (decision.action === "unchanged") return true;
    target.generation = decision.requiredGeneration;
    if (decision.action === "apply") {
      applySessionDetail(projectMutationDetail(main, response, docs));
      return true;
    }
    const detail = requireSessionDetailDocument(
      await fetchSessionDetail(response.sessionId, {
        source: "mutationGenerationGap",
        requireFresh: true,
      }),
    );
    if (findSessionByAnyId(sessions.value, response.sessionId) !== target) return false;
    if (detail.sessionId !== response.sessionId)
      throw new TypeError("Mutation synchronization returned a different session");
    if (detail.exists && isSessionDetailEntryCurrent(selectMainSessionDetailEntry(detail), target))
      applySessionDetail(detail);
    const applied = target.sessionDocs?.find((entry) => entry.sessionId === response.sessionId);
    return isSessionDetailEntryCurrent(applied, target);
  };
}
