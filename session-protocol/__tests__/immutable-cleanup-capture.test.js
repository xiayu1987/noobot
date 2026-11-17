/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupCapture,
  immutableCleanupPreparationInterrupted,
} from "../src/immutable-storage.js";

test("capture protocol requires an explicit initialization state and rejects the old format", () => {
  const id = randomUUID();
  const record = {
    format: PLAN.captureFormat,
    id,
    dryRun: false,
    ready: false,
    firstChunk: null,
    candidates: 0,
    pages: 0,
  };
  assert.equal(requireImmutableCleanupCapture(record, id), record);
  assert.equal(requireImmutableCleanupCapture({ ...record, ready: true }, id).ready, true);
  for (const ready of [undefined, null, 0, "true"])
    assert.throws(() => requireImmutableCleanupCapture({ ...record, ready }, id));
  assert.throws(() =>
    requireImmutableCleanupCapture({ ...record, format: "noobot.cleanup-capture/1" }, id),
  );
});

test("interrupted preparation identifies the retained plan and preserves the original failure", () => {
  const id = randomUUID();
  const cause = new AggregateError([new Error("write"), new Error("sync")], "publication");
  const error = immutableCleanupPreparationInterrupted(id, cause);
  assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
  assert.equal(error.planId, id);
  assert.equal(error.cause, cause);
  assert.throws(() => immutableCleanupPreparationInterrupted("invalid", cause));
});
