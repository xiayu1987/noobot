/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAuthorityOutboxTurnRange,
  isAuthorityOutboxTurnEventVisible,
  removeAuthorityOutboxTurnRange,
  requireAuthorityOutboxTurnRange,
} from "../src/authority-event-outbox.js";

test("interleaved turn ranges count only their events and retain removal across later appends", () => {
  const first = appendAuthorityOutboxTurnRange(null, "t1", 2);
  const second = appendAuthorityOutboxTurnRange(first, "t1", 5);
  const removed = removeAuthorityOutboxTurnRange(second, "t1", 7);
  const next = appendAuthorityOutboxTurnRange(removed, "t1", 9);
  assert.deepEqual(second, { turnScopeId: "t1", lastOrdinal: 5, removedThrough: 0, eventCount: 2 });
  assert.deepEqual(removed, {
    turnScopeId: "t1",
    lastOrdinal: 5,
    removedThrough: 5,
    eventCount: 0,
  });
  assert.deepEqual(next, { turnScopeId: "t1", lastOrdinal: 9, removedThrough: 5, eventCount: 1 });
  assert.equal(isAuthorityOutboxTurnEventVisible(next, "t1", 2, 9), false);
  assert.equal(isAuthorityOutboxTurnEventVisible(next, "t1", 5, 9), false);
  assert.equal(isAuthorityOutboxTurnEventVisible(next, "t1", 9, 9), true);
  assert.deepEqual(removeAuthorityOutboxTurnRange(removed, "t1", 7), removed);
  assert.equal(first.eventCount, 1);
});

test("turn range rejects malformed persisted facts and foreign ownership", () => {
  const valid = { turnScopeId: "t1", lastOrdinal: 5, removedThrough: 2, eventCount: 2 };
  for (const range of [
    null,
    [],
    {},
    { ...valid, extra: true },
    { ...valid, turnScopeId: "t2" },
    { ...valid, lastOrdinal: 6 },
    { ...valid, lastOrdinal: -1 },
    { ...valid, removedThrough: -1 },
    { ...valid, removedThrough: 6 },
    { ...valid, eventCount: -1 },
    { ...valid, eventCount: 4 },
    { ...valid, eventCount: 0 },
    { ...valid, removedThrough: 5 },
    { ...valid, lastOrdinal: 4.5 },
    { ...valid, eventCount: NaN },
  ]) {
    assert.throws(() => requireAuthorityOutboxTurnRange(range, "t1", 5), TypeError);
    assert.throws(() => removeAuthorityOutboxTurnRange(range, "t1", 5), TypeError);
  }
  for (const sequence of [-1, 4, 5.5, NaN, Infinity])
    assert.throws(() => requireAuthorityOutboxTurnRange(valid, "t1", sequence), TypeError);
});

test("turn range append requires a canonical scope and a strictly advancing safe ordinal", () => {
  const range = appendAuthorityOutboxTurnRange(null, "t1", 3);
  for (const ordinal of [0, -1, 1.5, 2, 3, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => appendAuthorityOutboxTurnRange(range, "t1", ordinal), TypeError);
  for (const scope of ["", " t1", "t1 ", null])
    assert.throws(() => appendAuthorityOutboxTurnRange(null, scope, 1), TypeError);
  assert.throws(() => appendAuthorityOutboxTurnRange(range, "t2", 4), TypeError);
});

test("turn range visibility rejects positions outside the published range", () => {
  const range = appendAuthorityOutboxTurnRange(null, "t1", 3);
  for (const ordinal of [0, -1, 1.5, 4, NaN, Infinity])
    assert.throws(() => isAuthorityOutboxTurnEventVisible(range, "t1", ordinal, 4), TypeError);
  assert.throws(() => isAuthorityOutboxTurnEventVisible(range, "t2", 3, 4), TypeError);
});
