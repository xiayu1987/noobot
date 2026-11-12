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

let verifiedJournals = null;

function journalCache() {
  verifiedJournals ??= createByteLru(LENGTH_THRESHOLDS.artifact.artifactEventJournalCacheBytes);
  return verifiedJournals;
}

function matchesIndex(entry, identity, index, sessionId) {
  return (
    identity.reusable &&
    entry.identityKey === identity.key &&
    entry.sessionId === sessionId &&
    entry.bytes === index.committedBytes &&
    entry.eventRevision === index.eventRevision &&
    entry.events.length === index.eventCount
  );
}

async function readCommittedRecords(handle, file, committedBytes) {
  const bytes = Buffer.alloc(committedBytes);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  assertTurnJournalBoundary(file, offset, committedBytes);
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
  const handle = await open(file, "r");
  try {
    const identity = fileIdentityOf(await handle.stat({ bigint: true }));
    assertTurnJournalBoundary(file, identity.bytes, index.committedBytes);
    const cached = journalCache().get(file);
    if (cached && matchesIndex(cached, identity, index, manifest.sessionId)) return cached.events;
    const events = deepFreeze(
      materializeSessionArtifactJournal(
        await readCommittedRecords(handle, file, index.committedBytes),
        index,
        manifest.sessionId,
      ),
    );
    if (identity.reusable) {
      journalCache().set(file, {
        identityKey: identity.key,
        sessionId: manifest.sessionId,
        bytes: index.committedBytes,
        eventRevision: index.eventRevision,
        events,
      });
    }
    return events;
  } finally {
    await handle.close();
  }
}

export async function writeSessionArtifactEvents(sessionDir, session, previousManifest) {
  const previous = previousManifest
    ? await readSessionArtifactEvents(sessionDir, previousManifest)
    : [];
  const events = session.sessionArtifactEvents;
  if (previousManifest && events === previous) return { ...previousManifest.artifactEventJournal };
  const records = diffSessionArtifactEvents(previous, events, session.sessionId);
  const file = path.join(sessionDir, SESSION_ARTIFACT_EVENT_JOURNAL_FILE);
  const committedBytes = await appendJournal(
    file,
    records,
    previousManifest ? previousManifest.artifactEventJournal.committedBytes : 0,
  );
  return {
    file: SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
    committedBytes,
    eventCount: events.length,
    eventRevision:
      previousManifest && !records.length
        ? previousManifest.artifactEventJournal.eventRevision
        : sessionArtifactEventRevision(events, session.sessionId),
  };
}
