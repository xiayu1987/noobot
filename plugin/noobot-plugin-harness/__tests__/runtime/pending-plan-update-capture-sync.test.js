/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { setCaptureFlagStateWithMeta } from "../src/capabilities/pending-cleanup.js";

test("setCaptureFlagStateWithMeta manages planUpdateCapturePending lifecycle", () => {
  const state = {
    counters: { hookTurns: 7 },
    flags: {},
    pendingMeta: { pending: {}, flags: {} },
  };
  assert.equal(setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", true), true);
  assert.equal(state.flags.planUpdateCapturePending, true);

  state.flags.planUpdateCaptureStage = "revision";
  assert.equal(setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", false), true);
  assert.equal(state.flags.planUpdateCapturePending, false);
  assert.equal("planUpdateCaptureStage" in state.flags, false);
});
