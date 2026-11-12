/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createCheckpointIdentitySource,
  hydrateCheckpointReceipts,
  projectCheckpointIdentity,
  storeCheckpointReceipts,
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

test("receipts are stored without UID lists and hydrated from the checkpoint", () => {
  const hydrated = session({ persistedMessageUids: ["m1", "m2"], summarizedMessageUids: ["m1"] });
  const stored = storeCheckpointReceipts(hydrated, resolverFor(hydrated));
  const [storedReceipt] = stored.turnSummaryCheckpoints[turn.turnScopeId].receipts;
  assert.deepEqual(storedReceipt, { ...index, requestHash: "hash" });
  const [receipt] = hydrateCheckpointReceipts(stored, resolverFor(stored)).turnSummaryCheckpoints[
    turn.turnScopeId
  ].receipts;
  assert.deepEqual(receipt.persistedMessageUids, ["m1", "m2"]);
  assert.deepEqual(receipt.summarizedMessageUids, ["m1"]);
  receipt.persistedMessageUids.push("m3");
  assert.deepEqual(
    hydrateCheckpointReceipts(stored, resolverFor(stored)).turnSummaryCheckpoints[turn.turnScopeId]
      .receipts[0].persistedMessageUids,
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
    assert.throws(() => storeCheckpointReceipts(target, resolverFor(target)), IDENTITY_INVALID);
    assert.throws(() => hydrateCheckpointReceipts(target, resolverFor(target)), IDENTITY_INVALID);
  }
  const unknown = session({ checkpointId: "checkpoint-2" });
  assert.throws(() => storeCheckpointReceipts(unknown, resolverFor(unknown)), IDENTITY_INVALID);
});
