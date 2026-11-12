/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  createEmptyTurnLifecycle,
  createSessionStorageMessageIndex,
  SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
  sessionArtifactEventRevision,
} from "@noobot/session-protocol";
import {
  readSessionForProtocolRepair,
  resegmentMigratedCheckpointBaselines,
  runAtomicSessionRepair,
} from "../src/index.js";

test("atomic repair leaves the authoritative directory unchanged when validation fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-"));
  const sessionDir = path.join(root, "session-1");
  await mkdir(sessionDir);
  await writeFile(path.join(sessionDir, "session.json"), "original", "utf8");
  try {
    await assert.rejects(
      runAtomicSessionRepair({
        sessionDir,
        repair: async (stagingDir) =>
          writeFile(path.join(stagingDir, "session.json"), "changed", "utf8"),
        validate: async () => {
          throw new Error("invalid");
        },
      }),
    );
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protocol repair materializes a cumulative checkpoint only inside the repair project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-journal-"));
  const turnsDir = path.join(root, "turns");
  const snapshotsDir = path.join(root, "turn-snapshots", "turn-000001");
  await Promise.all([
    mkdir(turnsDir, { recursive: true }),
    mkdir(snapshotsDir, { recursive: true }),
  ]);
  const messages = [
    { messageUid: "m1", role: "user", content: "one" },
    { messageUid: "m2", role: "assistant", content: "two" },
  ];
  const snapshot = {
    schemaVersion: 1,
    checkpointId: "checkpoint-1",
    checkpointRevision: 1,
    messages,
  };
  const snapshotFile = "turn-snapshots/turn-000001/checkpoint-000001.json";
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
  const journal = `${JSON.stringify({
    op: "summary_snapshot",
    checkpointId: snapshot.checkpointId,
    checkpointRevision: snapshot.checkpointRevision,
    file: snapshotFile,
    contentHash,
  })}\n`;
  await Promise.all([
    writeFile(path.join(root, snapshotFile), JSON.stringify(snapshot), "utf8"),
    writeFile(path.join(turnsDir, "turn-000001.jsonl"), journal, "utf8"),
  ]);
  try {
    const repaired = await readSessionForProtocolRepair({
      sessionDir: root,
      session: {
        schemaVersion: 5,
        turnOrder: [
          {
            turnId: "turn-000001",
            file: "turns/turn-000001.jsonl",
            committedBytes: Buffer.byteLength(journal),
            messageOrder: ["m1", "m2"],
          },
        ],
        messageOrder: [{ messageUid: "m1" }, { messageUid: "m2" }],
      },
    });
    assert.deepEqual(repaired.messages, messages);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protocol repair resegments a migrated checkpoint baseline and preserves the active tail", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-resegment-"));
  const turnsDir = path.join(root, "turns");
  const snapshotsDir = path.join(root, "turn-snapshots", "turn-000001");
  await Promise.all([
    mkdir(turnsDir, { recursive: true }),
    mkdir(snapshotsDir, { recursive: true }),
  ]);
  const record = (messageUid, ts) => {
    const message = { messageUid, role: "assistant", content: messageUid, ts };
    return {
      op: "upsert",
      messageUid,
      message,
      hash: `sha256:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`,
    };
  };
  const records = [
    record("m1", "2026-01-01T00:00:30.000Z"),
    record("m2", "2026-01-01T00:01:30.000Z"),
    record("m3", "2026-01-01T00:02:30.000Z"),
  ];
  const checkpointPayloads = [
    {
      schemaVersion: 2,
      checkpointId: "checkpoint-1",
      checkpointRevision: 1,
      committedAt: "2026-01-01T00:01:00.000Z",
      previousCheckpointHash: "",
      records,
    },
    {
      schemaVersion: 2,
      checkpointId: "checkpoint-2",
      checkpointRevision: 2,
      committedAt: "2026-01-01T00:02:00.000Z",
      previousCheckpointHash: "",
      records: [],
    },
  ];
  const indexes = [];
  let previousHash = "";
  for (let index = 0; index < checkpointPayloads.length; index += 1) {
    const payload = { ...checkpointPayloads[index], previousCheckpointHash: previousHash };
    const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
    const file = `turn-snapshots/turn-000001/checkpoint-${String(index + 1).padStart(6, "0")}.json`;
    await writeFile(path.join(root, file), JSON.stringify(payload), "utf8");
    indexes.push({
      op: "summary_snapshot",
      checkpointId: payload.checkpointId,
      checkpointRevision: payload.checkpointRevision,
      file,
      contentHash,
    });
    previousHash = contentHash;
  }
  const journalFile = path.join(turnsDir, "turn-000001.jsonl");
  const journal = indexes.map((index) => `${JSON.stringify(index)}\n`).join("");
  await Promise.all([
    writeFile(journalFile, journal, "utf8"),
    writeFile(
      path.join(root, "session.json"),
      JSON.stringify({
        schemaVersion: SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION,
        turnOrder: [
          {
            turnId: "turn-000001",
            file: "turns/turn-000001.jsonl",
            committedBytes: Buffer.byteLength(journal),
            recordCount: indexes.length,
            messageOrder: ["m1", "m2", "m3"],
          },
        ],
        messageOrder: [{ messageUid: "m1" }, { messageUid: "m2" }, { messageUid: "m3" }],
      }),
      "utf8",
    ),
  ]);
  try {
    const source = await readSessionForProtocolRepair({
      sessionDir: root,
      session: JSON.parse(await readFile(path.join(root, "session.json"), "utf8")),
    });
    assert.deepEqual(
      source.messages.map((message) => message.messageUid),
      ["m1", "m2", "m3"],
    );
    const positions = records.map(({ messageUid }, index) => ({ messageUid, ordinal: index + 1 }));
    checkpointPayloads[0].records = [...records, { op: "order", positions }];
    let migratedPreviousHash = "";
    for (const [index, checkpoint] of checkpointPayloads.entries()) {
      const payload = {
        ...checkpoint,
        sessionId: "session-1",
        turnId: "turn-000001",
        turnScopeId: "scope-1",
        dialogProcessId: "dialog-1",
        persistedMessageUids: positions.map(({ messageUid }) => messageUid),
        summarizedMessageUids: [],
        previousCheckpointHash: migratedPreviousHash,
      };
      const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
      await writeFile(path.join(root, indexes[index].file), JSON.stringify(payload), "utf8");
      indexes[index].contentHash = contentHash;
      migratedPreviousHash = contentHash;
    }
    await Promise.all([
      writeFile(journalFile, "", "utf8"),
      writeFile(
        path.join(root, "session.json"),
        JSON.stringify({
          schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
          sessionId: "session-1",
          artifactEventJournal: {
            file: SESSION_ARTIFACT_EVENT_JOURNAL_FILE,
            committedBytes: 0,
            eventCount: 0,
            eventRevision: sessionArtifactEventRevision([], "session-1"),
          },
          turnArtifactSequence: 1,
          turnOrder: [
            {
              turnId: "turn-000001",
              turnScopeId: "scope-1",
              dialogProcessId: "dialog-1",
              file: "turns/turn-000001.jsonl",
              committedBytes: 0,
              recordCount: 0,
              ...createSessionStorageMessageIndex(
                records.map(({ message, hash }, index) => ({ message, hash, ordinal: index + 1 })),
              ),
              summarySnapshots: indexes.map(({ op, ...index }, position) => ({
                ...index,
                committedAt: checkpointPayloads[position].committedAt,
              })),
              compacted: false,
            },
          ],
          turnLifecycle: createEmptyTurnLifecycle(),
        }),
        "utf8",
      ),
    ]);
    const repaired = await resegmentMigratedCheckpointBaselines({ sessionDir: root });
    assert.deepEqual(repaired, [
      { turnId: "turn-000001", checkpointRecordCounts: [2, 2], tailRecordCount: 2 },
    ]);
    const nextJournal = (await readFile(journalFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      nextJournal
        .filter((entry) => entry.op === "upsert")
        .map((entry) => [entry.op, entry.messageUid]),
      [["upsert", "m3"]],
    );
    const manifestTurn = JSON.parse(await readFile(path.join(root, "session.json"), "utf8"))
      .turnOrder[0];
    const nextIndexes = manifestTurn.summarySnapshots;
    assert.equal(
      manifestTurn.committedBytes,
      Buffer.byteLength(nextJournal.map((record) => `${JSON.stringify(record)}\n`).join("")),
    );
    const first = JSON.parse(await readFile(path.join(root, nextIndexes[0].file), "utf8"));
    const second = JSON.parse(await readFile(path.join(root, nextIndexes[1].file), "utf8"));
    assert.deepEqual(
      first.records.filter((entry) => entry.op === "upsert").map((entry) => entry.messageUid),
      ["m1"],
    );
    assert.deepEqual(
      second.records.filter((entry) => entry.op === "upsert").map((entry) => entry.messageUid),
      ["m2"],
    );
    assert.deepEqual(
      first.records.find((entry) => entry.op === "order").positions,
      positions.slice(0, 1),
    );
    assert.deepEqual(
      second.records.find((entry) => entry.op === "order").positions,
      positions.slice(0, 2),
    );
    assert.deepEqual(nextJournal.find((entry) => entry.op === "order").positions, positions);
    const restored = await readSessionForProtocolRepair({
      sessionDir: root,
      session: JSON.parse(await readFile(path.join(root, "session.json"), "utf8")),
    });
    assert.deepEqual(
      restored.messages.map((message) => message.messageUid),
      ["m1", "m2", "m3"],
    );
    assert.equal(second.previousCheckpointHash, nextIndexes[0].contentHash);
    assert.equal(
      `sha256:${createHash("sha256").update(JSON.stringify(second)).digest("hex")}`,
      nextIndexes[1].contentHash,
    );
    assert.deepEqual(await resegmentMigratedCheckpointBaselines({ sessionDir: root }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
