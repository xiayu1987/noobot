/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnRecord,
  isCanonicalCommandReceipt,
  validateTurnLifecycleRequest,
  collectTurnReplacementTombstoneErrors,
  collectTurnContinuationRelationErrors,
} from "@noobot/session-protocol";
import { requireTurnLifecycleHeader } from "@noobot/session-protocol/turn-lifecycle";
import { isCanonicalText, isFunction } from "@noobot/shared/value";
import { transitionPreparedTurnLifecycle } from "./turn-lifecycle-entity.js";

function invalidRecord(message) {
  return Object.assign(new TypeError(message), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
}

async function readSelectedTurn(turns, readTurn, key, sequence) {
  if (Object.hasOwn(turns, key)) return;
  const source = await readTurn(key);
  if (source === null) return;
  assertTurnRecord(source);
  if (source.turnScopeId !== key || source.sequence > sequence)
    throw invalidRecord("Indexed lifecycle turn identity or sequence mismatch");
  Object.defineProperty(turns, key, {
    value: structuredClone(source),
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export async function readIndexedTurnLifecycle({
  header,
  input,
  readTurn,
  readReplacement,
  readCommand,
}) {
  for (const callback of [readTurn, readReplacement, readCommand])
    if (!isFunction(callback))
      throw new TypeError("Indexed lifecycle requires readers and a clock");
  requireTurnLifecycleHeader(header);
  const reason = validateTurnLifecycleRequest(input);
  if (reason) return { reason };
  const turns = Object.create(null);
  await readSelectedTurn(turns, readTurn, input.turnScopeId, header.sequence);
  const current = turns[input.turnScopeId];
  const sourceId = current
    ? current.continuationSource?.turnScopeId
    : input.continuationSource?.turnScopeId;
  if (sourceId && isCanonicalText(sourceId))
    await readSelectedTurn(turns, readTurn, sourceId, header.sequence);
  const replacement = await readReplacement(input.turnScopeId);
  if (
    replacement !== null &&
    (replacement.turnScopeId !== input.turnScopeId ||
      collectTurnReplacementTombstoneErrors(replacement, header.sequence).length)
  )
    throw invalidRecord("Invalid indexed lifecycle replacement");
  const receipt = await readCommand(input.commandId);
  if (
    receipt !== null &&
    (!isCanonicalCommandReceipt(receipt) || receipt.commandId !== input.commandId)
  )
    throw invalidRecord("Invalid indexed lifecycle command receipt");
  if (receipt?.turnScopeId)
    await readSelectedTurn(turns, readTurn, receipt.turnScopeId, header.sequence);
  return {
    lifecycle: {
      sequence: header.sequence,
      activeTurnScopeId: header.activeTurnScopeId,
      turns,
      replacedTurns: Object.assign(
        Object.create(null),
        Object.fromEntries(
          replacement === null ? [] : [[input.turnScopeId, structuredClone(replacement)]],
        ),
      ),
      commandReceipts: receipt === null ? [] : [structuredClone(receipt)],
    },
  };
}

export function projectIndexedLifecycleResult(lifecycle, transition) {
  const before = new Map(
    Object.entries(lifecycle.turns).map(([key, turn]) => [key, JSON.stringify(turn)]),
  );
  const { lifecycle: selected, ...result } = transition;
  if (!result.applied) return { ...result, changedTurns: [] };
  if (!Number.isSafeInteger(selected.sequence)) throw invalidRecord("Lifecycle sequence overflow");
  return {
    ...result,
    header: { sequence: selected.sequence, activeTurnScopeId: selected.activeTurnScopeId },
    changedTurns: Object.values(selected.turns).filter(
      (turn) => before.get(turn.turnScopeId) !== JSON.stringify(turn),
    ),
  };
}

export async function readIndexedTurnRemoval({ header, turnScopeIds, readTurn }) {
  requireTurnLifecycleHeader(header);
  if (!isFunction(readTurn)) throw new TypeError("Indexed removal requires a turn reader");
  if (!Array.isArray(turnScopeIds) || turnScopeIds.some((key) => !isCanonicalText(key)))
    throw new TypeError("Indexed removal requires canonical turn scope IDs");
  const selectedIds = [...new Set(turnScopeIds)];
  const turns = Object.create(null);
  const visited = new Set();
  const load = async (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    await readSelectedTurn(turns, readTurn, key, header.sequence);
  };
  for (const key of selectedIds) await load(key);
  for (const key of selectedIds) {
    const turn = turns[key];
    if (!turn) continue;
    const sourceId = turn.continuationSource?.turnScopeId;
    if (sourceId) await load(sourceId);
    if (turn.continuedByTurnScopeId) await load(turn.continuedByTurnScopeId);
    const errors = collectTurnContinuationRelationErrors({ turns }, turn);
    if (errors.length)
      throw Object.assign(invalidRecord("Invalid indexed removal continuation relationship"), {
        protocolErrors: errors,
      });
  }
  return {
    turnScopeIds: selectedIds,
    lifecycle: {
      sequence: header.sequence,
      activeTurnScopeId: header.activeTurnScopeId,
      turns,
      replacedTurns: Object.create(null),
      commandReceipts: [],
    },
  };
}

export async function transitionIndexedTurnLifecycle(options) {
  if (!isFunction(options.now)) throw new TypeError("Indexed lifecycle requires a clock");
  const { lifecycle, reason } = await readIndexedTurnLifecycle(options);
  if (reason) return { applied: false, reason, changedTurns: [] };
  return projectIndexedLifecycleResult(
    lifecycle,
    transitionPreparedTurnLifecycle(structuredClone(lifecycle), options.input, options.now),
  );
}
