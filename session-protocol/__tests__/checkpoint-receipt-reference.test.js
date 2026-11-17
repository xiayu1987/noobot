/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import {
  hydrateCheckpointReceiptReferences,
  copyCheckpointReceiptLists,
  hydrateCheckpointReceipts,
  projectCheckpointIdentity,
  storeCheckpointReceipts,
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

test("transaction receipts borrow only protocol-owned stable UID arrays", () => {
  const { session, payload, identity, resolve } = fixture();
  const view = hydrateCheckpointReceiptReferences(session, resolve);
  const receipt = firstReceipt(view);
  for (const field of ["persistedMessageUids", "summarizedMessageUids"]) {
    assert.equal(receipt[field], identity[field]);
    assert.ok(isDeepFrozen(receipt[field]));
    assert.throws(() => receipt[field].push("other"), TypeError);
    assert.notEqual(receipt[field], payload[field]);
  }
  assert.equal(
    firstReceipt(hydrateCheckpointReceiptReferences(session, resolve)).persistedMessageUids,
    receipt.persistedMessageUids,
  );
  payload.persistedMessageUids.push("source-mutation");
  assert.deepEqual(receipt.persistedMessageUids, ["m1", "m2"]);
  assert.deepEqual(storeCheckpointReceipts(view, resolve), session);
  assert.deepEqual(view, hydrateCheckpointReceipts(session, resolve));
});

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

test("service results own mutable receipt lists without changing the transaction source", () => {
  const { session, resolve } = fixture();
  const transaction = hydrateCheckpointReceiptReferences(session, resolve);
  const first = copyCheckpointReceiptLists(transaction);
  const second = copyCheckpointReceiptLists(transaction);
  assert.deepEqual(first, transaction);
  for (const key of ["persistedMessageUids", "summarizedMessageUids"]) {
    firstReceipt(first)[key].push("result-only");
    assert.notDeepEqual(firstReceipt(first)[key], firstReceipt(second)[key]);
    assert.deepEqual(firstReceipt(second)[key], firstReceipt(transaction)[key]);
    assert.notEqual(firstReceipt(second)[key], firstReceipt(transaction)[key]);
  }
  assert.deepEqual(storeCheckpointReceipts(transaction, resolve), session);
  assert.throws(() => copyCheckpointReceiptLists(session), TypeError);
});

test("borrowed receipt fields remain checked when replaced or assigned another identity", () => {
  const { session, resolve } = fixture();
  const view = hydrateCheckpointReceiptReferences(session, resolve);
  firstReceipt(view).persistedMessageUids = ["m2", "m1"];
  const invalid = { code: "SESSION_SUMMARY_CHECKPOINT_IDENTITY_INVALID" };
  assert.throws(() => storeCheckpointReceipts(view, resolve), invalid);
  assert.throws(() => hydrateCheckpointReceiptReferences(view, resolve), invalid);
  firstReceipt(session).committedAt = "2026-11-14T00:00:00.000Z";
  assert.throws(() => hydrateCheckpointReceiptReferences(session, resolve), invalid);
});

test("immutable storage reuses unchanged states and still verifies every receipt", () => {
  const { session, resolve } = fixture();
  const stored = storeCheckpointReceipts(session, resolve, { immutable: true });
  let visits = 0;
  const verified = storeCheckpointReceipts(
    stored,
    (...args) => {
      visits += 1;
      return resolve(...args);
    },
    { immutable: true },
  );
  assert.equal(verified, stored);
  assert.equal(visits, 1);
  const changed = {
    ...stored,
    turnSummaryCheckpoints: {
      ...stored.turnSummaryCheckpoints,
      "scope-2": { receipts: [{ ...firstReceipt(stored), markedCount: 2 }] },
    },
  };
  const projected = storeCheckpointReceipts(changed, resolve, { immutable: true });
  assert.notEqual(projected, changed);
  assert.equal(
    projected.turnSummaryCheckpoints["scope-1"],
    stored.turnSummaryCheckpoints["scope-1"],
  );
  assert.notEqual(
    projected.turnSummaryCheckpoints["scope-2"],
    changed.turnSummaryCheckpoints["scope-2"],
  );
  assert.equal(firstReceipt(stored).markedCount, 1);
  assert.equal(projected.turnSummaryCheckpoints["scope-2"].receipts[0].markedCount, 2);
  assert.throws(
    () =>
      storeCheckpointReceipts(
        stored,
        () => {
          throw new Error("invalid source");
        },
        { immutable: true },
      ),
    /invalid source/,
  );
});

test("transaction receipt references reject unverified identity sources", () => {
  const { session, payload } = fixture();
  assert.throws(() => hydrateCheckpointReceiptReferences(session, () => payload), {
    code: "SESSION_SUMMARY_CHECKPOINT_IDENTITY_INVALID",
  });
});
