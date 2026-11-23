/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySessionDisplayRowDelta,
  applySessionDisplaySourceDelta,
  createSessionDisplayStats,
  emptySessionDisplayRowCounts,
  emptySessionDisplaySourceCounts,
  requireSessionDisplaySourceCounts,
  sessionDisplayRowContribution,
} from "@noobot/session-protocol/session-reader";

const counts = (injectedMessageCount, toolLogCount) => ({ injectedMessageCount, toolLogCount });

test("display source deltas preserve signed retirement accumulation without mutating operands", () => {
  const original = Object.freeze(counts(2, 4));
  const retired = Object.freeze(counts(-2, -3));
  const delta = applySessionDisplaySourceDelta(retired, counts(1, 0));
  assert.deepEqual(delta, counts(-1, -3));
  const published = applySessionDisplaySourceDelta(original, delta);
  assert.deepEqual(requireSessionDisplaySourceCounts(published, 1), counts(1, 1));
  assert.deepEqual(original, counts(2, 4));
  assert.deepEqual(retired, counts(-2, -3));
  assert.throws(() => requireSessionDisplaySourceCounts(delta, 1), /Invalid display source counts/);
});

test("display source arithmetic rejects missing, extra, coerced and non-integer facts", () => {
  for (const value of [
    null,
    {},
    { injectedMessageCount: 0 },
    { ...counts(0, 0), extra: 1 },
    counts("0", 0),
    counts(0, NaN),
    counts(0, Infinity),
    counts(0, 0.5),
    counts(0, Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.throws(() => applySessionDisplaySourceDelta(value, counts(0, 0)), TypeError);
    assert.throws(() => applySessionDisplaySourceDelta(counts(0, 0), value), TypeError);
  }
  const accessor = {
    toolLogCount: 0,
    get injectedMessageCount() {
      assert.fail("evaluated accessor");
    },
  };
  assert.throws(() => applySessionDisplaySourceDelta(accessor, counts(0, 0)), TypeError);
  assert.throws(() => applySessionDisplaySourceDelta(counts(0, 0), accessor), TypeError);
});

test("display source arithmetic refuses precision loss in either direction", () => {
  for (const sign of [-1, 1]) {
    for (const field of ["injectedMessageCount", "toolLogCount"]) {
      assert.throws(
        () =>
          applySessionDisplaySourceDelta(
            { ...counts(0, 0), [field]: sign * Number.MAX_SAFE_INTEGER },
            { ...counts(0, 0), [field]: sign },
          ),
        /safe integer precision/,
      );
    }
  }
});

test("published display source counts require an explicit safe message bound", () => {
  const zero = emptySessionDisplaySourceCounts();
  for (const bound of [undefined, null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => requireSessionDisplaySourceCounts(zero, bound), TypeError);
  assert.equal(requireSessionDisplaySourceCounts(zero, 0), zero);
  assert.throws(() => requireSessionDisplaySourceCounts(counts(1, 0), 0), TypeError);
  assert.throws(() => requireSessionDisplaySourceCounts(counts(0, -1), 0), TypeError);
});

test("replacing and retiring final rows gives the same counts as rebuilding", () => {
  const zero = emptySessionDisplayRowCounts();
  const removed = sessionDisplayRowContribution({ hasThinkingDetails: true }, 3);
  const retained = sessionDisplayRowContribution({}, 1);
  const replacement = sessionDisplayRowContribution({ hasThinkingDetails: false }, 2);
  const previous = applySessionDisplayRowDelta(removed, retained);
  const retirement = { displayMessageCount: -1, thinkingMessageCount: -1, attachmentCount: -3 };
  const delta = applySessionDisplayRowDelta(retirement, replacement);
  const current = applySessionDisplayRowDelta(previous, delta);
  assert.deepEqual(current, applySessionDisplayRowDelta(retained, replacement));
  assert.deepEqual(current, {
    displayMessageCount: 2,
    thinkingMessageCount: 0,
    attachmentCount: 3,
  });
  assert.deepEqual(applySessionDisplayRowDelta(removed, retirement), zero);
});

test("row deltas reject incomplete, unsafe and inconsistent facts at their boundaries", () => {
  const zero = emptySessionDisplayRowCounts();
  assert.throws(() => sessionDisplayRowContribution({}, undefined), TypeError);
  assert.throws(() => sessionDisplayRowContribution({}, -1), TypeError);
  assert.throws(() => applySessionDisplayRowDelta(zero, { displayMessageCount: 1 }), TypeError);
  assert.throws(
    () =>
      applySessionDisplayRowDelta(
        { ...zero, attachmentCount: Number.MAX_SAFE_INTEGER },
        { ...zero, attachmentCount: 1 },
      ),
    /safe integer precision/,
  );
  assert.throws(
    () =>
      createSessionDisplayStats({
        ...emptySessionDisplaySourceCounts(),
        ...applySessionDisplayRowDelta(zero, { ...zero, displayMessageCount: -1 }),
        messageCount: 0,
        displayToolLogCount: 0,
        unassignedToolArtifactCount: 0,
        conflictedToolArtifactCount: 0,
      }),
    /explicit global counts/,
  );
});
