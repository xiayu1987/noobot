/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_PROMISE_CATCH } from "./check-empty-promise-catches.mjs";

function countEmptyCatches(source) {
  return [...source.matchAll(EMPTY_PROMISE_CATCH)].length;
}

test("detects empty Promise rejection handlers", () => {
  assert.equal(countEmptyCatches("work().catch(() => {});"), 1);
  assert.equal(countEmptyCatches("work().catch(async (error) => { });"), 1);
});

test("allows explicit queue settlement and diagnostic handlers", () => {
  assert.equal(countEmptyCatches("work().then(() => undefined, () => undefined);"), 0);
  assert.equal(countEmptyCatches("work().catch((error) => report(error));"), 0);
});
