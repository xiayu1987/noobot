/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
  materializeSessionArtifactJournal,
  diffSessionArtifactEvents,
  sessionArtifactEventRevision,
  assertSessionArtifactJournalIndex,
} from "@noobot/session-protocol";
import { assertTurnJournalBoundary } from "@noobot/session-repair";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { open } from "node:fs/promises";
import { appendJournal } from "./turn-journal-store.js";
import { createByteLru, fileIdentityOf } from "./verified-snapshot-cache.js";
import { memoizeSessionRead } from "../session-read-cache.js";
import { recordStorageWork } from "../session-storage-observation.js";

let verifiedJournals = null;
const eventSizes = new WeakMap();

function freezeEvents(events) {
  for (const event of events) deepFreeze(event);
  return deepFreeze(events);
}

function serializedEventBytes(event) {
  if (!eventSizes.has(event)) eventSizes.set(event, Buffer.byteLength(JSON.stringify(event)));
  return eventSizes.get(event);
}

function journalCache() {
  verifiedJournals ??= createByteLru(LENGTH_THRESHOLDS.artifact.artifactEventJournalCacheBytes);
  return verifiedJournals;
}

function matchesIndex(entry, index, sessionId) {
  return (
    entry.sessionId === sessionId &&
    entry.raw.length === index.committedBytes &&
    entry.eventRevision === index.eventRevision &&
    entry.events.length === index.eventCount
  );
}

async function readCommittedBytes(handle, file, committedBytes) {
  const bytes = Buffer.alloc(committedBytes);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  assertTurnJournalBoundary(file, offset, committedBytes);
  recordStorageWork("eventJournalReadBytes", offset);
  return bytes;
}

function parseRecords(bytes) {
  return bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export async function readSessionArtifactEvents(sessionDir, manifest) {
  const index = assertSessionArtifactJournalIndex(manifest.artifactEventJournal);
  if (index.committedBytes === 0)
    return materializeSessionArtifactJournal([], index, manifest.sessionId);
  const file = path.join(sessionDir, index.file);
  return memoizeSessionRead(
    JSON.stringify(["artifactEvents", manifest.sessionId, index]),
    file,
    () => readVerifiedEvents(file, index, manifest.sessionId),
  );
}

function journalReadReason(cached, sameIndex, identity) {
  if (!cached) return "eventJournalColdReads";
  if (!sameIndex) return "eventJournalIndexChangedReads";
  if (!cached.identity) return "eventJournalUnverifiedReads";
  if (cached.identity.key !== identity.key) return "eventJournalIdentityChangedReads";
  return "eventJournalGuardReads";
}

async function readVerifiedEvents(file, index, sessionId) {
  const handle = await open(file, "r");
  try {
    const identity = fileIdentityOf(await handle.stat({ bigint: true }));
    recordStorageWork("eventJournalIdentityReads");
    assertTurnJournalBoundary(file, identity.bytes, index.committedBytes);
    const cached = journalCache().get(file);
    const sameIndex = cached && matchesIndex(cached, index, sessionId);
    if (
      sameIndex &&
      identity.reusable &&
      cached.identity?.reusable &&
      cached.identity.key === identity.key
    )
      return cached.events;
    recordStorageWork(journalReadReason(cached, sameIndex, identity));
    const raw = await readCommittedBytes(handle, file, index.committedBytes);
    if (sameIndex && raw.equals(cached.raw)) {
      cached.identity = identity;
      return cached.events;
    }
    const events = freezeEvents(
      materializeSessionArtifactJournal(parseRecords(raw), index, sessionId),
    );
    retainJournal({ file, raw, events, index, sessionId, identity });
    return events;
  } finally {
    await handle.close();
  }
}

function retainJournal({ file, raw, events, index, sessionId, identity = null }) {
  journalCache().set(file, {
    sessionId,
    identity,
    bytes:
      raw.length +
      2 +
      Math.max(0, events.length - 1) +
      events.reduce((sum, event) => sum + serializedEventBytes(event), 0),
    raw,
    eventRevision: index.eventRevision,
    events: deepFreeze(events),
  });
}

export async function writeSessionArtifactEvents(sessionDir, session, previousManifest) {
  const previous = previousManifest
    ? await readSessionArtifactEvents(sessionDir, previousManifest)
    : [];
  const events = freezeEvents(session.sessionArtifactEvents);
  if (previousManifest && events === previous) return { ...previousManifest.artifactEventJournal };
  const records = diffSessionArtifactEvents(previous, events, session.sessionId);
  if (previousManifest && !records.length) return { ...previousManifest.artifactEventJournal };
  const file = path.join(sessionDir, SESSION_ARTIFACT_EVENT_JOURNAL_FILE);
  const cached = journalCache().get(file);
  const priorRaw = previousManifest ? cached?.raw : Buffer.alloc(0);
  const eventRevision = sessionArtifactEventRevision(events, session.sessionId);
  const committedBytes = await appendJournal(
    file,
    records,
    previousManifest ? previousManifest.artifactEventJournal.committedBytes : 0,
  );
  const index = {
    file: SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
    committedBytes,
    eventCount: events.length,
    eventRevision,
  };
  if (
    priorRaw &&
    (!previousManifest ||
      matchesIndex(cached, previousManifest.artifactEventJournal, session.sessionId))
  ) {
    const appended = Buffer.from(records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    retainJournal({
      file,
      raw: Buffer.concat([priorRaw, appended]),
      events,
      index,
      sessionId: session.sessionId,
    });
  }
  return index;
}
