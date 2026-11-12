/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  createSessionStorageMessageIndex,
  sessionStorageMessageHash,
} from "@noobot/session-protocol";
import { buildSessionArtifactFileMap } from "../session/session-artifact-files.js";
import { writeJsonWithStorage } from "../session/session-artifact-session/artifact-json-io.js";
import { writeSessionArtifactEvents } from "../session/session-artifact-session/artifact-event-journal.js";
import { buildStoredCheckpointReceipts } from "../session/session-artifact-session/checkpoint-receipts.js";
import {
  readJournalRecords,
  replaceJournalRecords,
  resolveTurnJournalPath,
} from "../session/session-artifact-session/turn-journal-store.js";

export async function migrateSessionStorageJournals({
  storageService,
  sessionDir,
  source,
  document,
}) {
  const positions = new Map(
    source.messages.map((message, index) => [
      message.messageUid,
      { message, ordinal: index + 1, hash: sessionStorageMessageHash(message) },
    ]),
  );
  const turnOrder = [];
  for (const turn of source.turnOrder) {
    const entries = turn.messageOrder.map((uid) => {
      const entry = positions.get(uid);
      if (!entry) throw new TypeError(`Migration turn message is missing: ${uid}`);
      return entry;
    });
    const records = await readJournalRecords(
      resolveTurnJournalPath(sessionDir, turn.file),
      turn.committedBytes,
    );
    records.push({
      op: "order",
      positions: entries.map(({ message, ordinal }) => ({
        messageUid: message.messageUid,
        ordinal,
      })),
    });
    const file = path.join("turns", `${turn.turnId}-${randomUUID()}.jsonl`).replaceAll("\\", "/");
    const migrated = {
      ...turn,
      file,
      committedBytes: await replaceJournalRecords(path.join(sessionDir, file), records),
      recordCount: records.length,
      ...createSessionStorageMessageIndex(entries),
    };
    delete migrated.messageOrder;
    delete migrated.messageHashes;
    turnOrder.push(migrated);
  }
  const manifest = {
    ...document,
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    turnOrder,
    artifactEventJournal: await writeSessionArtifactEvents(sessionDir, document, null),
  };
  delete manifest.messages;
  delete manifest.messageOrder;
  delete manifest.sessionArtifactEvents;
  const stored = await buildStoredCheckpointReceipts({
    storageService,
    sessionDir,
    session: manifest,
  });
  await writeJsonWithStorage({
    storageService,
    artifactPath: buildSessionArtifactFileMap(sessionDir).session,
    payload: stored,
    atomic: true,
  });
}
