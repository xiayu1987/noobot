/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  copyCheckpointReceiptLists,
  hydrateCheckpointReceipts,
  projectCheckpointIdentity,
} from "../src/aggregate/summary-checkpoint-storage.js";

function fixture() {
  const receipt = {
    checkpointId: "checkpoint-1",
    checkpointRevision: 1,
    committedAt: "2026-11-13T00:00:00.000Z",
    requestHash: "sha256:request",
    retainedMessageUids: [],
    markedCount: 1,
  };
  const payload = {
    ...receipt,
    sessionId: "session-1",
    turnId: "turn-000001",
    turnScopeId: "scope-1",
    dialogProcessId: "dialog-1",
    previousCheckpointHash: "",
    persistedMessageUids: ["m1", "m2"],
    summarizedMessageUids: ["m1"],
  };
  const identity = projectCheckpointIdentity(payload);
  const session = {
    sessionId: payload.sessionId,
    turnSummaryCheckpoints: {
      "scope-1": {
        turnScopeId: payload.turnScopeId,
        dialogProcessId: payload.dialogProcessId,
        checkpointRevision: 1,
        receipts: [receipt],
      },
    },
  };
  return { session, payload, identity, resolve: () => identity };
}

function firstReceipt(session) {
  return session.turnSummaryCheckpoints["scope-1"].receipts[0];
}

test("public receipt hydration retains independent mutable UID copies", () => {
  const { session, identity, resolve } = fixture();
  const first = firstReceipt(hydrateCheckpointReceipts(session, resolve));
  const second = firstReceipt(hydrateCheckpointReceipts(session, resolve));
  first.persistedMessageUids.push("extra");
  first.summarizedMessageUids.length = 0;
  assert.deepEqual(second.persistedMessageUids, ["m1", "m2"]);
  assert.deepEqual(second.summarizedMessageUids, ["m1"]);
  assert.deepEqual(identity.persistedMessageUids, ["m1", "m2"]);
  assert.notEqual(first.persistedMessageUids, second.persistedMessageUids);
});

test("service results own mutable receipt lists without changing the source", () => {
  const { session, resolve } = fixture();
  const transaction = hydrateCheckpointReceipts(session, resolve);
  const first = copyCheckpointReceiptLists(transaction);
  const second = copyCheckpointReceiptLists(transaction);
  assert.deepEqual(first, transaction);
  for (const key of ["persistedMessageUids", "summarizedMessageUids"]) {
    firstReceipt(first)[key].push("result-only");
    assert.notDeepEqual(firstReceipt(first)[key], firstReceipt(second)[key]);
    assert.deepEqual(firstReceipt(second)[key], firstReceipt(transaction)[key]);
    assert.notEqual(firstReceipt(second)[key], firstReceipt(transaction)[key]);
  }
  assert.throws(() => copyCheckpointReceiptLists(session), TypeError);
});
