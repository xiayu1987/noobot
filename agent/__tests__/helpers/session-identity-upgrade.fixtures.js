/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestPartitionStorageBudget } from "./partition-journal-cases.js";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { MESSAGE_ORIGIN } from "@noobot/session-protocol";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import {
  messageHash,
  summarySnapshotContentHash,
} from "../../src/session/session-artifact-session/turn-journal-store.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./scoped-session-roots.js";
import { TEST_STORAGE_SERVICE } from "./storage-service.js";
import { writeLegacySessionFixture } from "./legacy-session-fixture.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./session-message-facts.js";

export const SESSION_ID = "s-v9";
export const jsonl = (records) => records.map((record) => `${JSON.stringify(record)}\n`).join("");

export async function downgradeSessionStorage(sessionDir, schemaVersion) {
  assertLegacySchema(schemaVersion);
  const session = await readSessionArtifact({ sessionDir, storageService: TEST_STORAGE_SERVICE });
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.schemaVersion = schemaVersion;
  manifest.messageOrder = session.messages.map(({ messageUid }) => ({ messageUid }));
  manifest.turnSummaryCheckpoints = session.turnSummaryCheckpoints;
  manifest.sessionArtifactEvents = session.sessionArtifactEvents;
  delete manifest.artifactEventJournal;
  for (const turn of manifest.turnOrder) {
    const messages = session.messages.filter((message) => message.turnScopeId === turn.turnScopeId);
    turn.messageOrder = messages.map(({ messageUid }) => messageUid);
    turn.messageHashes = Object.fromEntries(
      messages.map((message) => [message.messageUid, messageHash(message)]),
    );
    for (const field of ["firstMessageOrdinal", "lastMessageOrdinal", "messageRevision"])
      delete turn[field];
    let previousHash = "";
    for (const index of turn.summarySnapshots) {
      const file = path.join(sessionDir, index.file);
      const snapshot = JSON.parse(await readFile(file, "utf8"));
      snapshot.records = snapshot.records.filter((record) => record.op !== "order");
      snapshot.previousCheckpointHash = previousHash;
      index.contentHash = summarySnapshotContentHash(snapshot);
      previousHash = index.contentHash;
      await writeFile(file, JSON.stringify(snapshot), "utf8");
    }
    const file = path.join(sessionDir, turn.file);
    const records = (await readFile(file))
      .subarray(0, turn.committedBytes)
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter((record) => record.op !== "order");
    const journal = jsonl(records);
    turn.committedBytes = Buffer.byteLength(journal);
    turn.recordCount = records.length;
    await writeFile(file, journal, "utf8");
  }
  await writeFile(manifestFile, JSON.stringify(manifest), "utf8");
  return manifest;
}

function assertLegacySchema(schemaVersion) {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 6 || schemaVersion > 22)
    throw new TypeError("Expected a checkpoint journal schema from 6 through 22");
}

export async function saveCanonicalSession(sessionRepo) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", SESSION_ID);
  const message = (messageUid, role, extra) => ({
    sessionId: SESSION_ID,
    messageUid,
    role,
    content: messageUid,
    attachments: [],
    dialogProcessId: "d1",
    turnScopeId: "t1",
    ts: `2026-01-01T00:00:0${messageUid.at(-1)}.000Z`,
    ...extra,
  });
  await writeLegacySessionFixture(
    sessionRepo,
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      parentSessionId: "",
      sessionId: SESSION_ID,
      aggregateVersion: 0,
      messages: [
        message("m1", "user", { messageOrigin: MESSAGE_ORIGIN.NATURAL }),
        message("m2", "assistant", { modelMessageId: "mm_m2", presentationMessageId: "pm_1" }),
      ],
    }),
    { persistenceContext },
  );
  const scope = await sessionRepo.requireSessionScope("alice", SESSION_ID, persistenceContext);
  return scope.sessionDir;
}

export function v9Options(root) {
  return {
    base: path.join(root, "alice"),
    backupBase: path.join(root, "layout-backup"),
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService: TEST_STORAGE_SERVICE,
  };
}
