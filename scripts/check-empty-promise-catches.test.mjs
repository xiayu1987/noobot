/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findEmptyPromiseCatchOffsets } from "./check-empty-promise-catches.mjs";

test("detects empty Promise rejection handlers", () => {
  assert.equal(findEmptyPromiseCatchOffsets("work().catch(() => {});").length, 1);
  assert.equal(findEmptyPromiseCatchOffsets("work().catch(async (error) => { });").length, 1);
});

test("allows explicit queue settlement and diagnostic handlers", () => {
  assert.equal(
    findEmptyPromiseCatchOffsets("work().then(() => undefined, () => undefined);").length,
    0,
  );
  assert.equal(findEmptyPromiseCatchOffsets("work().catch((error) => report(error));").length, 0);
});
