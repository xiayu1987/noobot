/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applySessionSettings } from "../src/index.js";

const updatedAt = "2026-11-12T13:00:00.000Z";

test("settings change only declared fields and preserve aggregate and message revisions", () => {
  const manifest = {
    aggregateVersion: 7,
    turnOrder: [{ messageRevision: "rev" }],
    modelAlias: "old",
  };
  const settings = { modelAlias: "new", customTitle: "Title", selectedConnectorIds: ["one"] };
  const result = applySessionSettings(manifest, settings, updatedAt);
  assert.deepEqual(result, { ...manifest, ...settings, updatedAt });
  assert.equal(manifest.modelAlias, "old");
  settings.selectedConnectorIds.push("two");
  assert.deepEqual(result.selectedConnectorIds, ["one"]);
});

test("settings reject message, lifecycle and unknown mutations and invalid values", () => {
  for (const settings of [
    null,
    {},
    { messages: [] },
    { aggregateVersion: 8 },
    { turnLifecycle: {} },
    { customTitle: " " },
    { modelAlias: 1 },
    { selectedConnectorIds: ["a", "a"] },
    { selectedConnectorIds: [""] },
  ]) {
    assert.throws(() => applySessionSettings({}, settings, updatedAt), TypeError);
  }
  assert.throws(() => applySessionSettings({}, { modelAlias: "new" }, "invalid"), TypeError);
});
