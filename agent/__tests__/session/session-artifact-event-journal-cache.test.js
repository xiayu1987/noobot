/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  readSessionArtifactEvents,
  writeSessionArtifactEvents,
} from "../../src/session/session-artifact-session/artifact-event-journal.js";
import { createParsedTextMemo } from "../../src/shared/storage/parsed-text-memo.js";
import { withSessionReadCache } from "../../src/session/session-read-cache.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";

const SESSION_ID = "journal-cache-session";

function envelope(eventId, value) {
  return { identity: { eventId, sessionId: SESSION_ID }, payload: { value } };
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

test("committed artifact bytes reuse the immutable projection immediately after append", async () => {
  await withSessionDir(async (sessionDir) => {
    const first = await commit(sessionDir, [envelope("event-1", 1)], null);
    const unsettled = await readSessionArtifactEvents(sessionDir, first);
    assert.equal(await readSessionArtifactEvents(sessionDir, first), unsettled);
    const events = await readSessionArtifactEvents(sessionDir, first);
    assert.deepEqual(events, [envelope("event-1", 1)]);
    assert.equal(Object.isFrozen(events) && Object.isFrozen(events[0].payload), true);
    assert.equal(await readSessionArtifactEvents(sessionDir, first), events);

    const unchanged = await commit(sessionDir, events, first);
    assert.deepEqual(unchanged.artifactEventJournal, first.artifactEventJournal);

    const appended = [...events, envelope("event-2", 2)];
    const second = await commit(sessionDir, appended, first);
    assert.equal(second.artifactEventJournal.eventCount, 2);
    assert.equal(await readSessionArtifactEvents(sessionDir, second), appended);
    assert.equal((await readSessionArtifactEvents(sessionDir, second))[0], events[0]);
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
    await readSessionArtifactEvents(sessionDir, manifest);
    const file = path.join(sessionDir, manifest.artifactEventJournal.file);
    const raw = await readFile(file, "utf8");
    await writeFile(file, raw.replace('"value":1', '"value":7'), "utf8");
    await assert.rejects(
      readSessionArtifactEvents(sessionDir, manifest),
      (error) => error.code === SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID,
    );
  });
});

test("stable journal identity avoids payload reads but detects replacement and truncation", async (t) => {
  await withSessionDir(async (sessionDir) => {
    const manifest = await commit(sessionDir, [envelope("event-1", 1)], null);
    const file = path.join(sessionDir, manifest.artifactEventJournal.file);
    const raw = await readFile(file, "utf8");
    const future = Date.now() + TIME_THRESHOLDS.agent.snapshotIdentityGuardMs * 2;
    t.mock.method(Date, "now", () => future);
    const handle = await open(file, "r");
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const read = prototype.read;
    let reads = 0;
    t.mock.method(prototype, "read", function (...args) {
      reads += 1;
      return read.apply(this, args);
    });
    const events = await readSessionArtifactEvents(sessionDir, manifest);
    assert.ok(reads > 0);
    reads = 0;
    assert.equal(await readSessionArtifactEvents(sessionDir, manifest), events);
    assert.equal(reads, 0);
    await writeFile(`${file}.replacement`, raw.replace('"value":1', '"value":9'));
    await rename(`${file}.replacement`, file);
    await assert.rejects(
      readSessionArtifactEvents(sessionDir, manifest),
      (error) => error.code === SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID,
    );
    assert.ok(reads > 0);
    await writeFile(file, "");
    await assert.rejects(readSessionArtifactEvents(sessionDir, manifest));
  });
});

test("unchanged copied events retain verified identity without hiding external replacement", async (t) => {
  await withSessionDir(async (sessionDir) => {
    const manifest = await commit(sessionDir, [envelope("event-1", 1)], null);
    const future = Date.now() + TIME_THRESHOLDS.agent.snapshotIdentityGuardMs * 2;
    t.mock.method(Date, "now", () => future);
    const events = await readSessionArtifactEvents(sessionDir, manifest);
    const { work } = await observeSessionStorageWork(async () => {
      const unchanged = await commit(sessionDir, structuredClone(events), manifest);
      assert.deepEqual(unchanged, manifest);
      assert.equal(await readSessionArtifactEvents(sessionDir, unchanged), events);
    });
    assert.equal(work.eventJournalReadBytes ?? 0, 0);
    const file = path.join(sessionDir, manifest.artifactEventJournal.file);
    const raw = await readFile(file, "utf8");
    await writeFile(`${file}.replacement`, raw.replace('"value":1', '"value":9'));
    await rename(`${file}.replacement`, file);
    await assert.rejects(readSessionArtifactEvents(sessionDir, manifest), {
      code: SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID,
    });
  });
});

test("read reasons distinguish unverified writes and the identity guard before stable reuse", async (t) => {
  await withSessionDir(async (sessionDir) => {
    const manifest = await commit(sessionDir, [envelope("event-1", 1)], null);
    const read = () =>
      observeSessionStorageWork(() => readSessionArtifactEvents(sessionDir, manifest));
    const recent = Date.now();
    t.mock.method(Date, "now", () => recent);
    const first = await read();
    assert.equal(first.work.eventJournalUnverifiedReads, 1);
    const second = await read();
    assert.equal(second.work.eventJournalGuardReads, 1);
    assert.equal(second.work.eventJournalReadBytes, manifest.artifactEventJournal.committedBytes);
    t.mock.method(Date, "now", () => recent + TIME_THRESHOLDS.agent.snapshotIdentityGuardMs * 2);
    assert.equal((await read()).work.eventJournalGuardReads, 1);
    const stable = await read();
    assert.equal(stable.result, first.result);
    assert.equal(stable.work.eventJournalReadBytes ?? 0, 0);
  });
});

test("artifact event reads share one verification per transaction and invalidate on append", async () => {
  await withSessionDir(async (sessionDir) => {
    const first = await commit(sessionDir, [envelope("event-1", 1)], null);
    const { work } = await observeSessionStorageWork(() =>
      withSessionReadCache(sessionDir, async () => {
        const [left, right] = await Promise.all([
          readSessionArtifactEvents(sessionDir, first),
          readSessionArtifactEvents(sessionDir, structuredClone(first)),
        ]);
        assert.equal(left, right);
        await commit(sessionDir, left, first);
        const second = await commit(sessionDir, [...left, envelope("event-2", 2)], first);
        assert.equal((await readSessionArtifactEvents(sessionDir, second)).length, 2);
        assert.equal((await readSessionArtifactEvents(sessionDir, first)).length, 1);
      }),
    );
    assert.equal(work.eventJournalIdentityReads, 3);
    const { work: next } = await observeSessionStorageWork(() =>
      withSessionReadCache(sessionDir, () => readSessionArtifactEvents(sessionDir, first)),
    );
    assert.equal(next.eventJournalIdentityReads, 1);
  });
});

test("transaction event reuse does not hide replacement or missing files in the next transaction", async () => {
  await withSessionDir(async (sessionDir) => {
    const manifest = await commit(sessionDir, [envelope("event-1", 1)], null);
    const read = () =>
      withSessionReadCache(sessionDir, () => readSessionArtifactEvents(sessionDir, manifest));
    await read();
    const file = path.join(sessionDir, manifest.artifactEventJournal.file);
    const raw = await readFile(file, "utf8");
    await writeFile(`${file}.replacement`, raw.replace('"value":1', '"value":9'));
    await rename(`${file}.replacement`, file);
    await assert.rejects(read(), { code: SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID });
    await rm(file);
    await assert.rejects(read(), { code: "ENOENT" });
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
