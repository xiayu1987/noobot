/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION,
  advanceAuthorityOutboxCheckpoint,
  allocateAuthorityEventSequence,
  authorityOutboxSequenceKey,
  createEmptyAuthorityOutboxCheckpoint,
  parseAuthorityOutboxCheckpoint,
  readAuthorityOutboxSequenceFloor,
  requireCommittedAuthorityEvent,
  serializeAuthorityOutboxCheckpoint,
} from "../src/authority-event-outbox.js";

const key = authorityOutboxSequenceKey("session", "s1");

function ordered(domain, scopeId, sequence) {
  return { ordering: { domain, scopeId, sequence } };
}

test("checkpoint parses and serializes with the protocol schema version", () => {
  const checkpoint = parseAuthorityOutboxCheckpoint({
    schemaVersion: AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION,
    sequenceFloors: { [key]: 3 },
  });
  assert.equal(readAuthorityOutboxSequenceFloor(checkpoint, key), 3);
  assert.deepEqual(serializeAuthorityOutboxCheckpoint(checkpoint), {
    schemaVersion: AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION,
    sequenceFloors: { [key]: 3 },
  });
});

test("checkpoint rejects non-object, wrong schemaVersion and invalid floors", () => {
  assert.throws(() => parseAuthorityOutboxCheckpoint(null), TypeError);
  assert.throws(() => parseAuthorityOutboxCheckpoint([]), TypeError);
  assert.throws(
    () => parseAuthorityOutboxCheckpoint({ schemaVersion: 2, sequenceFloors: {} }),
    /unsupported authority outbox checkpoint schemaVersion/,
  );
  assert.throws(() => parseAuthorityOutboxCheckpoint({ schemaVersion: 1 }), /sequenceFloors/);
  for (const floor of [0, -1, 1.5, "2", null]) {
    assert.throws(
      () => parseAuthorityOutboxCheckpoint({ schemaVersion: 1, sequenceFloors: { [key]: floor } }),
      /integer >= 1/,
    );
  }
});

test("missing floor reads as zero and sequence key requires both segments", () => {
  assert.equal(readAuthorityOutboxSequenceFloor(createEmptyAuthorityOutboxCheckpoint(), key), 0);
  assert.throws(() => authorityOutboxSequenceKey("", "s1"), TypeError);
  assert.throws(() => authorityOutboxSequenceKey("session", ""), TypeError);
});

test("allocation takes the max of floor and same-scope envelopes", () => {
  const checkpoint = parseAuthorityOutboxCheckpoint({
    schemaVersion: 1,
    sequenceFloors: { [key]: 4 },
  });
  const envelopes = [ordered("session", "s1", 2), ordered("session", "s2", 9)];
  assert.equal(
    allocateAuthorityEventSequence({
      checkpoint,
      envelopes,
      orderingDomain: "session",
      orderingScopeId: "s1",
    }),
    5,
  );
  assert.equal(
    allocateAuthorityEventSequence({
      checkpoint,
      envelopes: [...envelopes, ordered("session", "s1", 7)],
      orderingDomain: "session",
      orderingScopeId: "s1",
    }),
    8,
  );
  assert.throws(
    () =>
      allocateAuthorityEventSequence({
        checkpoint,
        envelopes: null,
        orderingDomain: "session",
        orderingScopeId: "s1",
      }),
    /envelope list/,
  );
});

test("advance never lowers an existing floor", () => {
  const checkpoint = parseAuthorityOutboxCheckpoint({
    schemaVersion: 1,
    sequenceFloors: { [key]: 6 },
  });
  const advanced = advanceAuthorityOutboxCheckpoint(checkpoint, [
    ordered("session", "s1", 3),
    ordered("session", "s2", 2),
  ]);
  assert.equal(readAuthorityOutboxSequenceFloor(advanced, key), 6);
  assert.equal(
    readAuthorityOutboxSequenceFloor(advanced, authorityOutboxSequenceKey("session", "s2")),
    2,
  );
  assert.throws(() => advanceAuthorityOutboxCheckpoint(checkpoint, {}), /envelope list/);
});

test("requireCommittedAuthorityEvent rejects missing, refused and invalid results", () => {
  assert.throws(() => requireCommittedAuthorityEvent(null), /no result/);
  assert.throws(
    () => requireCommittedAuthorityEvent({ committed: false, code: "REVISION_CONFLICT" }),
    (error) => error.code === "REVISION_CONFLICT",
  );
  assert.throws(
    () => requireCommittedAuthorityEvent({ committed: true, envelope: {} }),
    /invalid envelope/,
  );
});
