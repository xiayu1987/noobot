/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { createStorageDigest as nativeDigest } from "../src/storage-digest.node.js";
import { createStorageDigest as portableDigest } from "../src/storage-digest.js";
import {
  diffSessionArtifactEvents,
  sessionArtifactEventRevision,
  materializeSessionArtifactJournal,
  SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
} from "../src/aggregate/session-artifact-journal.js";

const sessionId = "incremental-session";
const revision = (events) =>
  `sha256:${createHash("sha256").update(JSON.stringify(events)).digest("hex")}`;
const envelope = (index) => ({
  identity: { sessionId, eventId: `event-${index}` },
  payload: { text: `中文😀\\\"${index}` },
});

test("native and portable digest copies preserve independent JSON prefixes", () => {
  for (const createDigest of [nativeDigest, portableDigest]) {
    const prefix = createDigest().update("[");
    for (const value of [[], [envelope(1)], [envelope(2), envelope(3)]]) {
      const result = prefix.copy().update(JSON.stringify(value).slice(1)).digest("hex");
      assert.equal(`sha256:${result}`, revision(value));
    }
  }
});

test("immutable append revisions equal the stored whole-array SHA-256 at every step", () => {
  let previous = deepFreeze([]);
  let records = [];
  for (let index = 0; index < 24; index += 1) {
    const events = deepFreeze([...previous, envelope(index)]);
    const delta = diffSessionArtifactEvents(previous, events, sessionId);
    assert.deepEqual(delta, [{ op: "append", eventId: `event-${index}`, envelope: events.at(-1) }]);
    records = [...records, ...delta];
    assert.equal(sessionArtifactEventRevision(events, sessionId), revision(events));
    assert.deepEqual(
      materializeSessionArtifactJournal(
        records,
        {
          file: SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
          committedBytes: 1,
          eventCount: events.length,
          eventRevision: revision(events),
        },
        sessionId,
      ),
      events,
    );
    previous = events;
  }
  assert.throws(() => sessionArtifactEventRevision(previous, "other-session"), /session_mismatch/);
  const removed = deepFreeze(previous.slice(1));
  assert.deepEqual(diffSessionArtifactEvents(previous, removed, sessionId), [
    { op: "remove", eventId: "event-0" },
  ]);
  assert.equal(sessionArtifactEventRevision(removed, sessionId), revision(removed));
  assert.throws(
    () => diffSessionArtifactEvents(previous, deepFreeze([...previous, previous[0]]), sessionId),
    /duplicate/,
  );
  assert.throws(
    () => diffSessionArtifactEvents(previous, deepFreeze([...previous].reverse()), sessionId),
    /order_changed/,
  );
  assert.throws(
    () =>
      diffSessionArtifactEvents(
        previous,
        deepFreeze([{ ...previous[0], payload: { text: "changed" } }, ...previous.slice(1)]),
        sessionId,
      ),
    /identity_reused/,
  );
});

test("mutable arrays are revalidated and never return a memoized revision", () => {
  const events = [envelope(0)];
  const before = sessionArtifactEventRevision(events, sessionId);
  events[0].payload.text = "changed";
  assert.notEqual(sessionArtifactEventRevision(events, sessionId), before);
  assert.equal(sessionArtifactEventRevision(events, sessionId), revision(events));
});
