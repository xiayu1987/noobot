/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";

import { HOOK_OUTCOME_STATUS, HOOK_PHASE_STATUS, HOOK_PHASE_STATUS_VALUES } from "../src/index.js";

test("phase status vocabulary is frozen and exhaustive", () => {
  assert.ok(Object.isFrozen(HOOK_PHASE_STATUS));
  assert.deepEqual(HOOK_PHASE_STATUS_VALUES, ["running", "success", "error", "abort"]);
});

test("phase status axis stays disjoint from hook outcome status axis", () => {
  const phaseValues = new Set(HOOK_PHASE_STATUS_VALUES);
  const outcomeValues = Object.values(HOOK_OUTCOME_STATUS);
  const overlap = outcomeValues.filter((value) => phaseValues.has(value));
  assert.deepEqual(overlap, []);
});
