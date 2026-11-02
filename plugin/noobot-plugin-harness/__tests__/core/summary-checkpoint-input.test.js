/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessBucket } from "../../src/core/bucket-contract.js";
import { captureGuidanceSummaryCheckpoint } from "../../src/capabilities/handlers/guidance/signal-tracker.js";

test("summary capture rejects damaged pending state before reading context or mutating state", () => {
  for (const pending of [undefined, null, {}, [], { summaryCheckpointMessageKeys: "invalid" }]) {
    const state = { ...createHarnessBucket().state, pending };
    const before = structuredClone(state);
    assert.throws(() => captureGuidanceSummaryCheckpoint(null, state), TypeError);
    assert.deepEqual(state, before);
  }
});
