/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  readSessionArtifactEvents,
  writeSessionArtifactEvents,
} from "../../src/session/session-artifact-session/artifact-event-journal.js";
import { createParsedTextMemo } from "../../src/shared/storage/parsed-text-memo.js";

const SESSION_ID = "journal-cache-session";

function envelope(eventId, value) {
  return { identity: { eventId, sessionId: SESSION_ID }, payload: { value } };
}

function journalSettles() {
  return delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
}

async function withSessionDir(run) {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-artifact-journal-"));
  try {
    await run(sessionDir);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

async function commit(sessionDir, events, previousManifest) {
  const artifactEventJournal = await writeSessionArtifactEvents(
    sessionDir,
    { sessionId: SESSION_ID, sessionArtifactEvents: events },
    previousManifest,
  );
  return { sessionId: SESSION_ID, artifactEventJournal };
}

test("committed artifact events are served from the verified journal without rereading", async () => {
  await withSessionDir(async (sessionDir) => {
    const first = await commit(sessionDir, [envelope("event-1", 1)], null);
    const unsettled = await readSessionArtifactEvents(sessionDir, first);
    assert.notEqual(await readSessionArtifactEvents(sessionDir, first), unsettled);
    await journalSettles();
    const events = await readSessionArtifactEvents(sessionDir, first);
    assert.deepEqual(events, [envelope("event-1", 1)]);
    assert.equal(Object.isFrozen(events) && Object.isFrozen(events[0].payload), true);
    assert.equal(await readSessionArtifactEvents(sessionDir, first), events);

    const unchanged = await commit(sessionDir, events, first);
    assert.deepEqual(unchanged.artifactEventJournal, first.artifactEventJournal);

    const second = await commit(sessionDir, [...events, envelope("event-2", 2)], first);
    assert.equal(second.artifactEventJournal.eventCount, 2);
    assert.deepEqual(await readSessionArtifactEvents(sessionDir, second), [
      envelope("event-1", 1),
      envelope("event-2", 2),
    ]);
    assert.deepEqual(await readSessionArtifactEvents(sessionDir, first), [envelope("event-1", 1)]);
  });
});

test("a journal rewritten outside the store is verified again and rejected", async () => {
  await withSessionDir(async (sessionDir) => {
    const manifest = await commit(sessionDir, [envelope("event-1", 1)], null);
    await journalSettles();
    await readSessionArtifactEvents(sessionDir, manifest);
    const file = path.join(sessionDir, manifest.artifactEventJournal.file);
    const raw = await readFile(file, "utf8");
    await writeFile(file, raw.replace('"value":1', '"value":7'), "utf8");
    await journalSettles();
    await assert.rejects(
      readSessionArtifactEvents(sessionDir, manifest),
      (error) => error.code === SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID,
    );
  });
});

test("parsed text memo reparses only when the stored text changes", () => {
  let parses = 0;
  const parse = createParsedTextMemo((raw) => {
    parses += 1;
    return JSON.parse(raw);
  });
  const first = parse('{"nodes":{"a":1}}', "tree.json");
  assert.equal(parse('{"nodes":{"a":1}}', "tree.json"), first);
  assert.equal(parses, 1);
  assert.equal(Object.isFrozen(first.nodes), true);
  assert.deepEqual(parse('{"nodes":{"b":2}}', "tree.json"), { nodes: { b: 2 } });
  assert.deepEqual(parse('{"nodes":{"a":1}}', "other.json"), { nodes: { a: 1 } });
  assert.equal(parses, 3);
  assert.throws(() => createParsedTextMemo(null), TypeError);
});
