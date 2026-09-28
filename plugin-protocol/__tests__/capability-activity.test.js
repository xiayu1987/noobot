/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { defineCapabilityActivity, requireCapabilityActivity } from "../src/index.js";

test("capability presentation is explicit and independent of plugin names", () => {
  const activity = defineCapabilityActivity("custom_review");
  assert.deepEqual(activity, { activityKind: "custom_review" });
  assert.ok(Object.isFrozen(activity));
  assert.equal(requireCapabilityActivity(null), null);
  assert.notEqual(requireCapabilityActivity(activity), activity);
});

test("capability presentation rejects malformed or competing declarations", () => {
  for (const value of [
    undefined,
    "review",
    [],
    {},
    { activityKind: " " },
    { activityKind: "review", eventType: "thinking" },
    { activityKind: "review", legacyKind: "old" },
  ]) {
    assert.throws(() => requireCapabilityActivity(value), TypeError);
  }
});
