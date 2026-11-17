/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { selectAuthorityOutboxProjection } from "../src/authority-event-outbox.js";

test("selection preserves journal order, unique results and immutable entry references", () => {
  const entries = new Map(["a", "b", "c"].map((eventId) => [eventId, Object.freeze({ eventId })]));
  const selected = selectAuthorityOutboxProjection({ entries }, ["c", "a", "a"]);
  assert.deepEqual(
    selected.map((entry) => entry.eventId),
    ["a", "c"],
  );
  assert.equal(selected[0], entries.get("a"));
  assert.deepEqual(selectAuthorityOutboxProjection({ entries }, []), []);
  assert.deepEqual(selectAuthorityOutboxProjection({ entries }, ["missing"]), []);
  assert.throws(() => selectAuthorityOutboxProjection({ entries }, [""]));
});
