/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  assertSessionMessagePositions,
  assertSessionStorageMessageIndex,
  createSessionStorageMessageIndex,
  sessionStorageMessageHash,
} from "../src/index.js";

function entry(uid, ordinal, hash = `hash:${uid}`) {
  return { message: { messageUid: uid }, ordinal, hash };
}

test("index reuse preserves exact ordered digest and does not expose cached results", () => {
  const entries = deepFreeze([entry("b", 9), entry("a", 2)]);
  const revision = `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        ["a", 2, "hash:a"],
        ["b", 9, "hash:b"],
      ]),
    )
    .digest("hex")}`;
  const expected = {
    messageCount: 2,
    firstMessageOrdinal: 2,
    lastMessageOrdinal: 9,
    messageRevision: revision,
  };
  const first = createSessionStorageMessageIndex(entries);
  assert.deepEqual(first, expected);
  first.messageRevision = "consumer mutation";
  assert.deepEqual(createSessionStorageMessageIndex(entries), expected);
  assertSessionStorageMessageIndex(entries, expected);
  assert.throws(() => assertSessionStorageMessageIndex(entries, first));
});

test("mutable and shallow-frozen inputs are revalidated after nested changes", () => {
  const entries = Object.freeze([entry("a", 1), entry("b", 2)]);
  const initial = createSessionStorageMessageIndex(entries);
  entries[0].hash = "updated";
  assert.notEqual(
    createSessionStorageMessageIndex(entries).messageRevision,
    initial.messageRevision,
  );
  entries[1].ordinal = 1;
  assert.throws(() => createSessionStorageMessageIndex(entries), /duplicate/);
  const positions = Object.freeze([{ messageUid: "a", ordinal: 1 }]);
  assertSessionMessagePositions(positions);
  positions[0].ordinal = 0;
  assert.throws(() => assertSessionMessagePositions(positions), /positive integer/);
});

test("immutable validation never caches invalid identities, ordinals or positions", () => {
  for (const entries of [
    [entry(" a", 1)],
    [entry("a", 0)],
    [entry("a", 1), entry("a", 2)],
    [entry("a", 1), entry("b", 1)],
  ]) {
    deepFreeze(entries);
    assert.throws(() => createSessionStorageMessageIndex(entries));
    assert.throws(() => createSessionStorageMessageIndex(entries));
  }
  const positions = deepFreeze([{ messageUid: "a", ordinal: 1, unexpected: true }]);
  assert.throws(() => assertSessionMessagePositions(positions), /unknown record field/);
  assert.throws(() => assertSessionMessagePositions(positions), /unknown record field/);
});

test("frozen dynamic values cannot reuse stale hashes or message indexes", () => {
  const date = new Date(0);
  const message = deepFreeze({ messageUid: "a", date });
  const firstHash = sessionStorageMessageHash(message);
  date.setTime(1000);
  assert.notEqual(sessionStorageMessageHash(message), firstHash);

  let ordinal = 1;
  const entries = deepFreeze([
    {
      message: { messageUid: "a" },
      get ordinal() {
        return ordinal;
      },
      hash: "a",
    },
  ]);
  assert.equal(createSessionStorageMessageIndex(entries).firstMessageOrdinal, 1);
  ordinal = 2;
  assert.equal(createSessionStorageMessageIndex(entries).firstMessageOrdinal, 2);
  ordinal = 0;
  assert.throws(() => createSessionStorageMessageIndex(entries), /positive integer/);
});

test("incremental indexes match the canonical digest across append, edits, deletion and reorder", () => {
  let previous = deepFreeze([]);
  createSessionStorageMessageIndex(previous);
  const verify = (next) => {
    deepFreeze(next);
    const actual = createSessionStorageMessageIndex(next, previous);
    const ordered = [...next].sort((left, right) => left.ordinal - right.ordinal);
    const revision = `sha256:${createHash("sha256")
      .update(
        JSON.stringify(
          ordered.map(({ message, ordinal, hash }) => [message.messageUid, ordinal, hash]),
        ),
      )
      .digest("hex")}`;
    assert.equal(actual.messageRevision, revision);
    assert.deepEqual(actual, createSessionStorageMessageIndex(structuredClone(next)));
    previous = next;
  };
  for (let index = 0; index < 150; index += 1)
    verify([...previous, entry(`uid:${index}:汉字`, index + 1)]);
  verify([...previous.slice(0, -1), entry(previous.at(-1).message.messageUid, 150, "edited")]);
  verify(previous.filter((_, index) => index !== 63));
  verify([...previous].reverse());
  verify(previous.map((value, index) => entry(value.message.messageUid, index + 1, value.hash)));
  verify([]);
  verify([entry("restart", 1)]);
});

test("incremental index hints never bypass validation or reuse mutable entries", () => {
  const mutable = [entry("a", 1)];
  createSessionStorageMessageIndex(mutable);
  mutable[0].hash = "changed";
  const next = deepFreeze([...mutable, entry("b", 2)]);
  assert.deepEqual(
    createSessionStorageMessageIndex(next, mutable),
    createSessionStorageMessageIndex(structuredClone(next)),
  );
  assert.throws(() => createSessionStorageMessageIndex(deepFreeze([...next, entry("a", 3)]), next));
  assert.throws(() => createSessionStorageMessageIndex(deepFreeze([...next, entry("c", 2)]), next));
});

test("index validation survives failed updates, mutable descendants and branches from old versions", () => {
  const base = deepFreeze([entry("a", 1), entry("b", 2), entry("c", 3)]);
  const expected = createSessionStorageMessageIndex(base);
  const verify = (next, previous) => {
    const actual = createSessionStorageMessageIndex(next, previous);
    assert.deepEqual(actual, createSessionStorageMessageIndex(structuredClone(next)));
  };
  for (const invalid of [
    [...base, entry("a", 4)],
    [...base, entry("d", 2)],
    [base[0], entry("c", 2), base[2]],
    [base[0], entry("d", 3), base[2]],
  ]) {
    assert.throws(() => createSessionStorageMessageIndex(deepFreeze(invalid), base), /duplicate/);
    assert.deepEqual(createSessionStorageMessageIndex(base), expected);
  }
  const mutable = [...base, entry("d", 4)];
  verify(mutable, base);
  mutable.at(-1).ordinal = 2;
  assert.throws(() => createSessionStorageMessageIndex(mutable, base), /duplicate/);
  const left = deepFreeze([...base, entry("left", 4)]);
  verify(left, base);
  const right = deepFreeze([base[0], entry("right", 2), base[2]]);
  verify(right, base);
  verify(deepFreeze([...left, entry("right", 5)]), left);
  verify(deepFreeze([...right, entry("left", 4)]), right);
  verify(deepFreeze([base[0], base[2]]), base);
  assert.deepEqual(createSessionStorageMessageIndex(base), expected);
});

test("incremental validation matches cold validation over deterministic mixed edits", () => {
  let seed = 137;
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  let previous = deepFreeze(
    Array.from({ length: 80 }, (_, index) => entry(`uid:${index}`, index + 1)),
  );
  createSessionStorageMessageIndex(previous);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const next = [...previous];
    const index = random(Math.max(1, next.length));
    const operation = random(5);
    if (operation === 0) next.splice(index, 1);
    else if (operation === 1) next.reverse();
    else if (operation === 2 && next.length)
      next[index] = entry(next[index].message.messageUid, next[index].ordinal, `edit:${iteration}`);
    else next.splice(index, 0, entry(`new:${iteration}`, 1000 + iteration));
    deepFreeze(next);
    assert.deepEqual(
      createSessionStorageMessageIndex(next, previous),
      createSessionStorageMessageIndex(structuredClone(next)),
    );
    previous = next;
  }
});
