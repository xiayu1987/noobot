/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyTurnLifecycle,
  appendCommandReceipt,
  createTurnReplacementCommit,
} from "@noobot/session-protocol";
import { transitionTurnLifecycle, transitionIndexedTurnLifecycle } from "../src/domain/index.js";
import {
  commitTurnDeletion,
  commitIndexedTurnDeletion,
  commitTurnReplacement,
  commitIndexedTurnReplacement,
} from "../src/application/index.js";

const timestamp = "2026-07-30T00:00:00.000Z";
const now = () => timestamp;
function request(turnScopeId, eventType, phase, extra = {}) {
  return {
    turnScopeId,
    eventType,
    phase,
    commandId: `${turnScopeId}:${eventType}`,
    causationId: `${turnScopeId}:${eventType}`,
    ...extra,
  };
}
function accept(turnScopeId, extra = {}) {
  return request(turnScopeId, "turn.action_accepted", "action", {
    action: "send",
    sessionId: "session-1",
    presentationMessageId: `presentation:${turnScopeId}`,
    dialogProcessId: `dialog:${turnScopeId}`,
    executionId: `agent:${turnScopeId}`,
    executionKind: "agent",
    rootExecutionId: `agent:${turnScopeId}`,
    ...extra,
  });
}
async function indexed(lifecycle, input, reads = []) {
  return transitionIndexedTurnLifecycle({
    header: { sequence: lifecycle.sequence, activeTurnScopeId: lifecycle.activeTurnScopeId },
    input,
    now,
    readTurn: async (key) => {
      reads.push(key);
      return lifecycle.turns[key] ?? null;
    },
    readReplacement: async (key) => lifecycle.replacedTurns[key] ?? null,
    readCommand: async (key) =>
      lifecycle.commandReceipts.find((receipt) => receipt.commandId === key) ?? null,
  });
}
async function compare(lifecycle, input) {
  const before = structuredClone(lifecycle);
  const full = transitionTurnLifecycle(lifecycle, input, now);
  const local = await indexed(lifecycle, input);
  assert.equal(local.applied, full.applied, full.reason);
  assert.equal(local.reason, full.reason);
  assert.deepEqual(local.turn, full.turn);
  assert.deepEqual(local.receiptDraft, full.receiptDraft);
  assert.deepEqual(lifecycle, before);
  if (!full.applied) {
    assert.deepEqual(local.changedTurns, []);
    assert.equal(local.currentRevision, full.currentRevision);
    assert.equal(local.deduplicated, full.deduplicated);
    return lifecycle;
  }
  assert.deepEqual(local.header, {
    sequence: full.lifecycle.sequence,
    activeTurnScopeId: full.lifecycle.activeTurnScopeId,
  });
  const rebuilt = { ...structuredClone(lifecycle), ...local.header };
  for (const turn of local.changedTurns) rebuilt.turns[turn.turnScopeId] = turn;
  assert.deepEqual(rebuilt, full.lifecycle);
  rebuilt.commandReceipts = appendCommandReceipt(rebuilt.commandReceipts, {
    ...full.receiptDraft,
    eventId: `event:${full.receiptDraft.sequence}`,
  });
  return rebuilt;
}

test("indexed decisions match aggregate transitions, stops, continuations and command replay", async () => {
  let state = await compare(createEmptyTurnLifecycle(), accept("a"));
  await compare(state, accept("a"));
  await compare(state, accept("b"));
  await compare(
    state,
    request("a", "turn.processing_started", "processing", { expectedRevision: 99 }),
  );
  const stop = async (turnScopeId) => {
    state = await compare(state, request(turnScopeId, "turn.processing_started", "processing"));
    state = await compare(state, request(turnScopeId, "turn.stop_accepted", "stop"));
    state = await compare(
      state,
      request(turnScopeId, "turn.stop_processing_completed", "stop", {
        completionCommitId: `${turnScopeId}:turn.stop_completed`,
      }),
    );
    state = await compare(state, request(turnScopeId, "turn.stop_completed", "stop"));
  };
  await stop("a");
  state = await compare(
    state,
    accept("b", {
      action: "continue",
      continuationSource: { turnScopeId: "a", dialogProcessId: "dialog:a" },
    }),
  );
  assert.equal(state.turns.a.continuedByTurnScopeId, "b");
  await stop("b");
  await compare(
    state,
    accept("c", {
      action: "continue",
      continuationSource: { turnScopeId: "a", dialogProcessId: "dialog:a" },
    }),
  );
  state = await compare(
    state,
    accept("c", {
      action: "continue",
      continuationSource: { turnScopeId: "b", dialogProcessId: "dialog:b" },
    }),
  );
  assert.equal(state.turns.b.continuedByTurnScopeId, "c");
  await compare(state, request("c", "turn.processing_started", "processing", { extra: true }));
});

test("indexed decision reads no unrelated lifecycle record and does not allocate facts on invalid input", async () => {
  const state = transitionTurnLifecycle(
    createEmptyTurnLifecycle(),
    accept("current"),
    now,
  ).lifecycle;
  Object.defineProperty(state.turns, "unrelated", {
    enumerable: true,
    get() {
      assert.fail("historical lifecycle was traversed");
    },
  });
  const reads = [];
  const result = await indexed(
    state,
    request("current", "turn.processing_started", "processing"),
    reads,
  );
  assert.equal(result.applied, true);
  assert.deepEqual(reads, ["current"]);
  assert.deepEqual(
    result.changedTurns.map((turn) => turn.turnScopeId),
    ["current"],
  );
  reads.length = 0;
  const invalid = await indexed(state, { ...accept("new"), unexpected: true }, reads);
  assert.equal(invalid.applied, false);
  assert.deepEqual(reads, []);
});

async function continuationChain() {
  let state = createEmptyTurnLifecycle();
  let source = null;
  for (const key of ["a", "b", "c"]) {
    state = await compare(
      state,
      accept(
        key,
        source
          ? {
              action: "continue",
              continuationSource: { turnScopeId: source, dialogProcessId: `dialog:${source}` },
            }
          : {},
      ),
    );
    state = await compare(state, request(key, "turn.processing_started", "processing"));
    state = await compare(state, request(key, "turn.stop_accepted", "stop"));
    state = await compare(
      state,
      request(key, "turn.stop_processing_completed", "stop", {
        completionCommitId: `${key}:turn.stop_completed`,
      }),
    );
    state = await compare(state, request(key, "turn.stop_completed", "stop"));
    source = key;
  }
  return compare(state, accept("unrelated"));
}

test("indexed deletion matches aggregate deletion for every continuation-chain subset", async () => {
  const lifecycle = await continuationChain();
  const before = structuredClone(lifecycle);
  for (let mask = 0; mask < 8; mask += 1) {
    const turnScopeIds = ["a", "b", "c"].filter((_, index) => mask & (1 << index));
    const full = commitTurnDeletion({ lifecycle, turnScopeIds });
    const reads = [];
    const local = await commitIndexedTurnDeletion({
      header: { sequence: lifecycle.sequence, activeTurnScopeId: lifecycle.activeTurnScopeId },
      turnScopeIds: [...turnScopeIds, ...turnScopeIds],
      readTurn: async (key) => {
        assert.notEqual(key, "unrelated");
        reads.push(key);
        return lifecycle.turns[key] ?? null;
      },
    });
    assert.equal(local.applied, full.applied);
    assert.equal(local.reason, full.reason);
    assert.deepEqual(local.removedTurnScopeIds, full.removedTurnScopeIds);
    assert.deepEqual(
      local.clearedContinuationSourceTurnScopeIds,
      full.clearedContinuationSourceTurnScopeIds,
    );
    assert.equal(reads.length, new Set(reads).size);
    if (!full.applied) {
      assert.deepEqual(local.changedTurns, []);
      assert.deepEqual(reads, []);
      continue;
    }
    const rebuilt = { ...structuredClone(lifecycle), ...local.header };
    for (const key of local.removedTurnScopeIds) delete rebuilt.turns[key];
    for (const turn of local.changedTurns) rebuilt.turns[turn.turnScopeId] = turn;
    rebuilt.commandReceipts = rebuilt.commandReceipts.filter(
      (receipt) => !turnScopeIds.includes(receipt.turnScopeId),
    );
    assert.deepEqual(rebuilt, full.lifecycle);
  }
  assert.deepEqual(lifecycle, before);
});

test("indexed deletion rejects broken continuation links and invalid selection", async () => {
  const lifecycle = await continuationChain();
  const run = (turnScopeIds, turns = lifecycle.turns, header = lifecycle) =>
    commitIndexedTurnDeletion({
      header,
      turnScopeIds,
      readTurn: async (key) => turns[key] ?? null,
    });
  for (const missing of ["a", "c"]) {
    const turns = structuredClone(lifecycle.turns);
    delete turns[missing];
    await assert.rejects(run(["b"], turns), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
  }
  const wrongOwner = structuredClone(lifecycle.turns);
  wrongOwner.a.continuedByTurnScopeId = "c";
  await assert.rejects(run(["b"], wrongOwner), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
  for (const selected of ["a", "b"]) {
    for (const mutation of ["sequence", "state"]) {
      const turns = structuredClone(lifecycle.turns);
      if (mutation === "sequence") turns.a.sequence = turns.b.sequence;
      else turns.a.state = "completed";
      await assert.rejects(run([selected], turns), {
        code: "TURN_LIFECYCLE_RECORD_INVALID",
        protocolErrors: [
          selected === "a"
            ? "turn_continuation_target_relation_mismatch"
            : "turn_continuation_source_relation_mismatch",
        ],
      });
    }
  }
  await assert.rejects(run([" b"]), TypeError);
  await assert.rejects(
    run(["b"], lifecycle.turns, {
      sequence: Number.MAX_SAFE_INTEGER,
      activeTurnScopeId: "unrelated",
    }),
    { code: "TURN_LIFECYCLE_RECORD_INVALID" },
  );
  const active = await run(["unrelated"]);
  assert.equal(active.header.activeTurnScopeId, "");
  assert.deepEqual(active.changedTurns, []);
});

function replacementCommit(scopes, extra = {}) {
  return createTurnReplacementCommit({
    commandId: "replace-command",
    sessionId: "session-1",
    committedAggregateVersion: 2,
    replacedTurnScopeIds: scopes,
    replacementDialogProcessId: "dialog:replacement",
    replacementTurnScopeId: "replacement",
    replacementUserMessageUid: "user:replacement",
    requestHash: "replacement-hash",
    committedAt: timestamp,
    ...extra,
  });
}

function indexedReplacement(lifecycle, replacement, previous = null, reads = []) {
  return commitIndexedTurnReplacement({
    header: { sequence: lifecycle.sequence, activeTurnScopeId: lifecycle.activeTurnScopeId },
    replacement,
    readTurn: async (key) => {
      assert.notEqual(key, "unrelated");
      reads.push(["turn", key]);
      return lifecycle.turns[key] ?? null;
    },
    readReplacement: async (key) => {
      reads.push(["replacement", key]);
      return lifecycle.replacedTurns[key] ?? null;
    },
    readCommandReplacement: async (key) => {
      reads.push(["command", key]);
      return previous;
    },
  });
}

test("indexed replacement matches aggregate decisions and updates for continuation-chain subsets", async () => {
  const lifecycle = await continuationChain();
  const before = structuredClone(lifecycle);
  for (let mask = 1; mask < 8; mask += 1) {
    const scopes = ["a", "b", "c"].filter((_, index) => mask & (1 << index));
    const replacement = replacementCommit(scopes);
    const full = commitTurnReplacement({ lifecycle, replacement });
    const local = await indexedReplacement(lifecycle, replacement);
    assert.equal(local.applied, full.applied);
    assert.equal(local.reason, full.reason);
    if (!full.applied) {
      assert.deepEqual(local.changedTurns, []);
      assert.deepEqual(local.changedReplacements, []);
      continue;
    }
    const rebuilt = { ...structuredClone(lifecycle), ...local.header };
    for (const key of local.removedTurnScopeIds) delete rebuilt.turns[key];
    for (const turn of local.changedTurns) rebuilt.turns[turn.turnScopeId] = turn;
    for (const tombstone of local.changedReplacements)
      rebuilt.replacedTurns[tombstone.turnScopeId] = tombstone;
    rebuilt.commandReceipts = rebuilt.commandReceipts.filter(
      (receipt) => !scopes.includes(receipt.turnScopeId),
    );
    assert.deepEqual(rebuilt, full.lifecycle);
    const retry = await indexedReplacement(full.lifecycle, replacement, replacement);
    assert.equal(retry.deduplicated, true);
    assert.deepEqual(retry.changedReplacements, []);
  }
  assert.deepEqual(lifecycle, before);
});

test("indexed replacement detects disjoint command reuse and invalid indexed records", async () => {
  const lifecycle = await continuationChain();
  const previous = replacementCommit(["c"]);
  const changed = replacementCommit(["b", "c"]);
  const conflict = await indexedReplacement(lifecycle, changed, previous);
  assert.equal(conflict.reason, "turn_replacement_conflict");
  const reads = [];
  const invalid = await indexedReplacement(lifecycle, {}, null, reads);
  assert.equal(invalid.reason, "invalid_turn_replacement");
  assert.deepEqual(reads, []);
  const invalidNull = await indexedReplacement(lifecycle, null, null, reads);
  assert.equal(invalidNull.reason, "invalid_turn_replacement");
  assert.deepEqual(reads, []);
  assert.equal(
    commitTurnReplacement({ lifecycle, replacement: null }).reason,
    "invalid_turn_replacement",
  );
  const broken = structuredClone(lifecycle);
  broken.replacedTurns.c = { turnScopeId: "wrong" };
  await assert.rejects(indexedReplacement(broken, previous), {
    code: "TURN_LIFECYCLE_RECORD_INVALID",
  });
  await assert.rejects(
    indexedReplacement(
      lifecycle,
      previous,
      replacementCommit(["c"], { commandId: "wrong-command" }),
    ),
    {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
    },
  );
});
