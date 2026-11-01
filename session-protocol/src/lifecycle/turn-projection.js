/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deriveAuthoritativeTurnCapabilities } from "./turn-capability.js";
import { assertTurnRecord } from "./turn-record.js";
import { collectTurnReplacementTombstoneErrors } from "./turn-replacement.js";

export function snapshotTurn(turn) {
  assertTurnRecord(turn);
  const fields = [
    "sessionId",
    "parentSessionId",
    "turnScopeId",
    "presentationMessageId",
    "dialogProcessId",
    "executionId",
    "executionKind",
    "parentExecutionId",
    "rootExecutionId",
    "origin",
    "stage",
    "commandId",
    "action",
    "state",
    "phase",
    "executionState",
    "revision",
    "sequence",
    "summaryVersion",
    "completionCommitId",
    "terminalStatus",
    "failure",
    "finalizeIntent",
    "continuationSource",
    "continuedByTurnScopeId",
    "startedAt",
    "finishedAt",
    "thinkingFinishedAt",
    "createdAt",
    "updatedAt",
  ];
  return {
    ...structuredClone(
      Object.fromEntries(
        fields.filter((field) => Object.hasOwn(turn, field)).map((field) => [field, turn[field]]),
      ),
    ),
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
  };
}

export function snapshotReplacedTurn(replacement) {
  const errors = collectTurnReplacementTombstoneErrors(replacement, replacement?.sequence);
  if (errors.length) throw new TypeError(`invalid turn replacement: ${errors.join(",")}`);
  return { ...replacement, replacedTurnScopeIds: [...replacement.replacedTurnScopeIds] };
}
