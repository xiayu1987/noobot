/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectRatchet, compareRatchet, ratchetViolations } from "./baseline-ratchet.mjs";

test("compareRatchet reports increase, decrease and equality", () => {
  assert.deepEqual(compareRatchet("clones", 61, 60), {
    increase: "clones: 61 exceeds baseline 60",
  });
  assert.deepEqual(compareRatchet("clones", 59, 60), {
    decrease: "clones: 59 below baseline 60",
  });
  assert.deepEqual(compareRatchet("clones", 60, 60), {});
});

test("ratchetViolations fails on both increases and stale baselines", () => {
  const result = collectRatchet([
    ["a", 2, 1],
    ["b", 0, 1],
    ["c", 1, 1],
  ]);
  assert.deepEqual(result, {
    increases: ["a: 2 exceeds baseline 1"],
    decreases: ["b: 0 below baseline 1"],
  });
  assert.deepEqual(ratchetViolations(result, "lower it"), [
    "a: 2 exceeds baseline 1",
    "stale baseline, lower it: b: 0 below baseline 1",
  ]);
  assert.deepEqual(ratchetViolations(collectRatchet([["c", 1, 1]]), "lower it"), []);
});
