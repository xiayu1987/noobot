/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStoredCheckpointReceipts,
  createCheckpointIdentitySource,
  hydrateCheckpointReceipts,
  projectCheckpointIdentity,
} from "../src/aggregate/summary-checkpoint-storage.js";

const IDENTITY_INVALID = { code: "SESSION_SUMMARY_CHECKPOINT_IDENTITY_INVALID" };
const turn = { turnId: "turn-000001", turnScopeId: "client-turn:a", dialogProcessId: "dialog-a" };
const index = {
  checkpointId: "checkpoint-1",
  checkpointRevision: 1,
  committedAt: "2026-11-11T00:00:00.000Z",
};

function snapshot(overrides = {}) {
  return {
    sessionId: "session-1",
    ...turn,
    ...index,
    previousCheckpointHash: "",
    persistedMessageUids: ["m1", "m2"],
    summarizedMessageUids: ["m1"],
    records: [],
    ...overrides,
  };
}

function session(receipt) {
  return {
    sessionId: "session-1",
    turnSummaryCheckpoints: {
      [turn.turnScopeId]: {
        turnScopeId: turn.turnScopeId,
        dialogProcessId: turn.dialogProcessId,
        receipts: [{ ...index, requestHash: "hash", ...receipt }],
      },
    },
  };
}

function resolverFor(target, payload = snapshot()) {
  const source = createCheckpointIdentitySource(target);
  source.collect(turn, index, projectCheckpointIdentity(payload));
  return source.resolve;
}

test("checkpoint identity projection validates UID lists once and is immutable", () => {
  const identity = projectCheckpointIdentity(snapshot());
  assert.equal(Object.hasOwn(identity, "records"), false);
  assert.deepEqual(identity.persistedMessageUids, ["m1", "m2"]);
  assert.throws(() => identity.persistedMessageUids.push("m3"), TypeError);
  assert.throws(
    () => projectCheckpointIdentity(snapshot({ persistedMessageUids: ["m1", "m1"] })),
    IDENTITY_INVALID,
  );
  assert.throws(
    () => projectCheckpointIdentity(snapshot({ summarizedMessageUids: "m1" })),
    IDENTITY_INVALID,
  );
});

test("identity source accepts only projected identities owned by the turn", () => {
  const target = session();
  assert.throws(
    () => createCheckpointIdentitySource(target).collect(turn, index, snapshot()),
    IDENTITY_INVALID,
  );
  assert.throws(
    () =>
      createCheckpointIdentitySource(target).collect(
        turn,
        index,
        projectCheckpointIdentity(snapshot({ sessionId: "session-2" })),
      ),
    IDENTITY_INVALID,
  );
  assert.throws(
    () =>
      createCheckpointIdentitySource(target).collect(
        turn,
        { ...index, checkpointRevision: 2 },
        projectCheckpointIdentity(snapshot()),
      ),
    IDENTITY_INVALID,
  );
});

test("stored receipt validation rejects duplicated UID lists before hydration", () => {
  const stored = session();
  assert.doesNotThrow(() => assertStoredCheckpointReceipts(stored));
  for (const key of ["persistedMessageUids", "summarizedMessageUids"]) {
    assert.throws(() => assertStoredCheckpointReceipts(session({ [key]: [] })), IDENTITY_INVALID);
  }
  const resolve = resolverFor(stored);
  const [receipt] = hydrateCheckpointReceipts(stored, resolve).turnSummaryCheckpoints[
    turn.turnScopeId
  ].receipts;
  assert.deepEqual(receipt.persistedMessageUids, ["m1", "m2"]);
  assert.deepEqual(receipt.summarizedMessageUids, ["m1"]);
  receipt.persistedMessageUids.push("m3");
  assert.deepEqual(
    hydrateCheckpointReceipts(stored, resolve).turnSummaryCheckpoints[turn.turnScopeId].receipts[0]
      .persistedMessageUids,
    ["m1", "m2"],
  );
});

test("receipts that disagree with their checkpoint are rejected", () => {
  for (const receipt of [
    { persistedMessageUids: ["m2", "m1"] },
    { summarizedMessageUids: ["m1", "m2"] },
    { committedAt: "2026-11-12T00:00:00.000Z" },
  ]) {
    const target = session(receipt);
    assert.throws(() => hydrateCheckpointReceipts(target, resolverFor(target)), IDENTITY_INVALID);
  }
  const unknown = session({ checkpointId: "checkpoint-2" });
  assert.throws(() => hydrateCheckpointReceipts(unknown, resolverFor(unknown)), IDENTITY_INVALID);
});
