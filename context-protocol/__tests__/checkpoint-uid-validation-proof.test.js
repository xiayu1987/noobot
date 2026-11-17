/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertTurnSummaryCheckpointState } from "../src/policy/summary.js";

function validate(values) {
  return assertTurnSummaryCheckpointState(
    {
      dialogProcessId: "dialog",
      turnScopeId: "scope",
      checkpointRevision: 1,
      receipts: [
        {
          checkpointId: "cp",
          checkpointRevision: 1,
          requestHash: "hash",
          committedAt: "now",
          markedCount: 0,
          persistedMessageUids: values,
          summarizedMessageUids: [],
          retainedMessageUids: [],
        },
      ],
    },
    "scope",
  );
}

function original(values) {
  values.forEach((uid) => {
    if (typeof uid !== "string" || !uid || uid !== uid.trim()) throw new TypeError("invalid UID");
  });
  if (new Set(values).size !== values.length) throw new TypeError("duplicates");
}

function outcome(action) {
  try {
    action();
    return "valid";
  } catch (error) {
    return error.name;
  }
}

test("mutable UID lists retain validation after edits, holes and repair", () => {
  const values = ["a", "b", "c"];
  const check = () =>
    assert.equal(
      outcome(() => validate(values)),
      outcome(() => original(values)),
    );
  check();
  check();
  values.reverse();
  check();
  values[0] = " b ";
  check();
  values[0] = "b";
  check();
  values[1] = "b";
  check();
  values[1] = "d";
  check();
  values.push("e");
  check();
  delete values[0];
  check();
  delete values[1];
  check();
  values.splice(0, 2);
  check();
  values.length = 0;
  check();
  values.push(undefined);
  check();
  values[0] = "a";
  check();
  check();
});

test("getter observations and iterator observations remain separate", () => {
  for (const validator of [original, validate]) {
    const values = ["a", "b"];
    validator(values);
    let reads = 0;
    Object.defineProperty(values, 1, {
      configurable: true,
      get() {
        reads++;
        return reads % 2 ? "b" : "a";
      },
    });
    assert.throws(() => validator(values), TypeError);
    assert.equal(reads, 2);
    Object.defineProperty(values, 1, { configurable: true, value: "b" });
    validator(values);
  }
});

test("custom iterator duplicates, reordering, truncation and errors retain original results", () => {
  const values = ["a", "b"];
  validate(values);
  for (const sequence of [["a", "a", "b"], ["b", "a"], ["a"], ["a", "a"], ["a", "c"]]) {
    values[Symbol.iterator] = function* () {
      yield* sequence;
    };
    for (let pass = 0; pass < 2; pass++)
      assert.equal(
        outcome(() => validate(values)),
        outcome(() => original(values)),
      );
  }
  const error = new Error("iterator failed");
  values[Symbol.iterator] = function* () {
    yield "a";
    throw error;
  };
  assert.throws(
    () => validate(values),
    (cause) => cause === error,
  );
});

test("failed validation does not publish proof and duplicate custom iterations remain valid", () => {
  const values = ["a", "a"];
  assert.throws(() => validate(values), TypeError);
  values[1] = "b";
  values[Symbol.iterator] = function* () {
    yield "a";
    yield "a";
    yield "b";
  };
  validate(values);
  validate(values);
  delete values[Symbol.iterator];
  validate(values);
});
