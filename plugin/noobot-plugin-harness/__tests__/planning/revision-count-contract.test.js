/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessBucket } from "../../src/core/bucket-contract.js";
import { buildPlanningRevisionPrompt } from "../../src/capabilities/handlers/planning/revision-engine.js";

test("revision prompt preserves valid counts and rejects corrupted state without repair", () => {
  for (const value of [0, 7]) {
    const bucket = createHarnessBucket();
    bucket.globalRevisionCount = value;
    assert.match(buildPlanningRevisionPrompt("en-US", bucket), new RegExp(String(value)));
    assert.equal(bucket.globalRevisionCount, value);
  }
  for (const value of [undefined, null, "7", -1, 1.5, NaN, Infinity]) {
    const bucket = createHarnessBucket();
    bucket.globalRevisionCount = value;
    const before = structuredClone(bucket);
    assert.throws(
      () => buildPlanningRevisionPrompt("en-US", bucket),
      /invalid_harness_state:globalRevisionCount/,
    );
    assert.deepEqual(bucket, before);
  }
});
