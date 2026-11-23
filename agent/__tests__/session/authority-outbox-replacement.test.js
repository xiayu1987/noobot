/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEventEnvelope } from "@noobot/event-protocol/envelope";
import { projectAuthorityOutboxJournal } from "@noobot/event-protocol/outbox";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";
import {
  appendAuthorityOutboxRecords,
  authorityOutboxJournalPath,
  readAuthorityOutbox,
  readAuthorityOutboxCheckpoint,
  readAuthorityOutboxProjection,
  readAuthorityOutboxRecords,
  replaceAuthorityOutboxRecords,
  writeAuthorityOutboxCheckpoint,
} from "../../src/session/authority-outbox-store/outbox-journal.js";

function recordsFor(eventId = "event-1") {
  const occurredAt = "2026-11-12T00:00:00.000Z";
  const envelope = createEventEnvelope({
    family: "turn.lifecycle",
    schemaVersion: 1,
    identity: { eventId, eventType: "turn.completed", sessionId: "s1", turnScopeId: "t1" },
    causality: {},
    ordering: { domain: "session", scopeId: "s1", sequence: 1 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt,
    payload: { text: "中文" },
  });
  return [
    { op: "prepare", eventId, envelope, committedAt: occurredAt },
    { op: "commit", eventId },
  ];
}

async function sessionDirFor(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "noobot-outbox-replace-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("replacement detaches persisted records and advances the projection with immutable entries", async (t) => {
  const dir = await sessionDirFor(t);
  const records = recordsFor();
  const bytes = await replaceAuthorityOutboxRecords(dir, records);
  assert.equal(bytes, (await readFile(authorityOutboxJournalPath(dir))).length);
  const projection = await readAuthorityOutboxProjection(dir);
  assert.equal(await readAuthorityOutboxProjection(dir), projection);
  records[0].envelope.payload.text = "changed by caller";
  assert.deepEqual(
    await readAuthorityOutbox(dir),
    projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(dir)),
  );
  assert.equal(projection.entries.get("event-1").envelope.payload.text, "中文");
  const original = projection.entries.get("event-1");
  await appendAuthorityOutboxRecords(dir, [
    {
      op: "attempt",
      eventId: "event-1",
      consumerId: "browser",
      attemptedAt: "2026-11-12T00:00:01.000Z",
    },
  ]);
  assert.equal((await readAuthorityOutbox(dir))[0].deliveries.browser.attempts, 1);
  assert.equal(await readAuthorityOutboxProjection(dir), projection);
  assert.equal(projection.entries.get("event-1").deliveries.browser.attempts, 1);
  assert.equal(original.deliveries.browser, undefined);
});

test("manifest reconciliation synchronizes an unchanged outbox only once under the session lock", async (t) => {
  const dir = await sessionDirFor(t);
  await writeSessionArtifact({
    sessionDir: dir,
    sessionPayload: { sessionId: "s1", aggregateVersion: 0, messages: [] },
  });
  await replaceAuthorityOutboxRecords(dir, recordsFor());
  const observed = await observeSessionStorageWork(() => readAuthorityOutboxProjection(dir));
  assert.equal(observed.work.outboxJournalSynchronizations, 1);
  assert.equal(observed.work.outboxCheckpointReads, 1);
  assert.deepEqual(
    await readAuthorityOutbox(dir),
    projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(dir)),
  );
});

test("replacement cache detects an external inode replacement and corrupt tail", async (t) => {
  const dir = await sessionDirFor(t);
  await replaceAuthorityOutboxRecords(dir, recordsFor());
  await readAuthorityOutbox(dir);
  const file = authorityOutboxJournalPath(dir);
  await writeFile(`${file}.external`, recordsFor("event-2").map(JSON.stringify).join("\n") + "\n");
  await rename(`${file}.external`, file);
  assert.deepEqual(
    (await readAuthorityOutbox(dir)).map((item) => item.eventId),
    ["event-2"],
  );
  await writeFile(file, "{corrupt}\n");
  await assert.rejects(readAuthorityOutbox(dir), { code: "ARTIFACT_JSON_CORRUPTED" });
});

test("invalid replacement leaves the published journal and projection intact", async (t) => {
  const dir = await sessionDirFor(t);
  await replaceAuthorityOutboxRecords(dir, recordsFor());
  const file = authorityOutboxJournalPath(dir);
  const before = await readFile(file);
  const projection = await readAuthorityOutboxProjection(dir);
  await assert.rejects(replaceAuthorityOutboxRecords(dir, [{ op: "commit", eventId: "missing" }]));
  assert.deepEqual(await readFile(file), before);
  assert.equal(await readAuthorityOutboxProjection(dir), projection);
  await replaceAuthorityOutboxRecords(dir, []);
  assert.deepEqual(await readAuthorityOutbox(dir), []);
});

test("checkpoint reuse reads current bytes and rejects replacement, deletion and corruption", async (t) => {
  const dir = await sessionDirFor(t);
  await replaceAuthorityOutboxRecords(dir, recordsFor());
  await writeAuthorityOutboxCheckpoint(dir, { sequenceFloors: { scope: 1 } });
  const first = await readAuthorityOutboxCheckpoint(dir);
  assert.equal(await readAuthorityOutboxCheckpoint(dir), first);
  assert.throws(() => {
    first.sequenceFloors.scope = 2;
  }, TypeError);
  await readAuthorityOutboxProjection(dir);
  assert.equal(await readAuthorityOutboxCheckpoint(dir), first);
  const file = path.join(path.dirname(authorityOutboxJournalPath(dir)), "outbox-checkpoint.json");
  await writeFile(
    `${file}.external`,
    JSON.stringify({ schemaVersion: 1, sequenceFloors: { scope: 2 } }),
  );
  await rename(`${file}.external`, file);
  assert.deepEqual((await readAuthorityOutboxCheckpoint(dir)).sequenceFloors, { scope: 2 });
  await writeFile(file, JSON.stringify({ schemaVersion: 1, sequenceFloors: { scope: 0 } }));
  await assert.rejects(readAuthorityOutboxCheckpoint(dir), TypeError);
  await writeFile(file, "{broken}");
  await assert.rejects(readAuthorityOutboxCheckpoint(dir), SyntaxError);
  await rm(file);
  assert.deepEqual((await readAuthorityOutboxCheckpoint(dir)).sequenceFloors, {});
  await writeAuthorityOutboxCheckpoint(dir, { sequenceFloors: { scope: 3 } });
  assert.deepEqual((await readAuthorityOutboxCheckpoint(dir)).sequenceFloors, { scope: 3 });
});
