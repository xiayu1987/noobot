/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applySessionMetadataCommit, applySessionSettings } from "../src/index.js";

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

test("metadata commits preserve the version or advance once without mutating source facts", () => {
  const metadata = Object.freeze({
    aggregateVersion: 7,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    caller: "user",
  });
  for (const aggregateVersion of [7, 8]) {
    assert.deepEqual(
      applySessionMetadataCommit(metadata, { committedAt: updatedAt, aggregateVersion }),
      { ...metadata, aggregateVersion, updatedAt },
    );
  }
  assert.deepEqual(applySessionMetadataCommit(metadata, { committedAt: updatedAt }), {
    ...metadata,
    updatedAt,
  });
});

for (const aggregateVersion of [-1, 6, 9, "8", 2 ** 53, null]) {
  test(`metadata rejects invalid aggregate transition to ${JSON.stringify(aggregateVersion)}`, () => {
    assert.throws(
      () =>
        applySessionMetadataCommit(
          { aggregateVersion: 7 },
          { committedAt: updatedAt, aggregateVersion },
        ),
      { code: "SESSION_COMMIT_INPUT_INVALID" },
    );
  });
}

test("metadata transitions reject invalid source versions and timestamps", () => {
  for (const aggregateVersion of [-1, "7", 2 ** 53, undefined]) {
    assert.throws(
      () => applySessionMetadataCommit({ aggregateVersion }, { committedAt: updatedAt }),
      { code: "SESSION_COMMIT_INPUT_INVALID" },
    );
  }
  for (const committedAt of [undefined, null, "invalid", "2026-11-12", "2026-11-12T13:00:00Z"]) {
    assert.throws(() => applySessionMetadataCommit({ aggregateVersion: 7 }, { committedAt }), {
      code: "SESSION_COMMIT_INPUT_INVALID",
    });
  }
});
