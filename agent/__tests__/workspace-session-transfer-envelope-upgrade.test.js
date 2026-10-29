/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION } from "@noobot/session-protocol";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { TRANSFER_ENVELOPE_V2, TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { legacyV2TransferEnvelope } from "./helpers/legacy-transfer-envelope.js";
import { upgradeSessionTransferEnvelopes } from "../src/workspace-lifecycle/session-transfer-envelope-upgrade.js";
import {
  SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  messageHash,
  summarySnapshotContentHash,
} from "../src/session/session-artifact-session/turn-journal-store.js";
const V2_FIELD = TRANSFER_ENVELOPE_V2.presentationField;

const SUMMARY_REVISION = `sha256:${"a".repeat(64)}`;

const SESSION = `${WORKSPACE_LAYOUT.SESSION_DIR}/s-1`;
const TURN = "client-turn:t-1";
const DIALOG = "dp-1";

function sha(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function v2Envelope(id) {
  return legacyV2TransferEnvelope(id, { sessionId: "s-1", turnScopeId: TURN });
}

function toolMessage(uid, envelopeId) {
  return {
    messageUid: uid,
    role: "tool",
    turnScopeId: TURN,
    dialogProcessId: DIALOG,
    content: "",
    transferEnvelopes: envelopeId ? [v2Envelope(envelopeId)] : [],
  };
}

function upsert(message) {
  return { op: "upsert", messageUid: message.messageUid, message, hash: messageHash(message) };
}

function jsonl(records) {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-transfer-upgrade-"));
  const base = path.join(root, "user-1");
  const backupBase = path.join(root, "backup");
  const at = (relativePath) => path.join(base, SESSION, relativePath);
  const write = async (relativePath, content) => {
    await mkdir(path.dirname(at(relativePath)), { recursive: true });
    await writeFile(
      at(relativePath),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  };
  return {
    base,
    backupBase,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    write,
    readText: (relativePath) => readFile(at(relativePath), "utf8"),
    readJson: async (relativePath) => JSON.parse(await readFile(at(relativePath), "utf8")),
    readBackupText: (relativePath) =>
      readFile(path.join(backupBase, SESSION, relativePath), "utf8"),
    backupExists: (relativePath) =>
      access(path.join(backupBase, SESSION, relativePath)).then(
        () => true,
        () => false,
      ),
    restore: () => rm(root, { recursive: true, force: true }),
  };
}

const SNAPSHOT_FILE = "turn-snapshots/turn-1-cp-1.json";
const DETAIL_FILE = "session-summary-details/msg_detail.json";
const SEGMENT_DIR = `execution-events/turns/${DIALOG}`;
const SEGMENT_FILE = "segment-000001.jsonl";

function v2TurnIndex(segment) {
  return {
    schemaVersion: 2,
    dialogProcessId: DIALOG,
    activeSequence: 1,
    maxSegmentBytes: 1048576,
    segments: [
      {
        sequence: 1,
        file: SEGMENT_FILE,
        bytes: Buffer.byteLength(segment, "utf8"),
        records: 2,
        sealed: false,
      },
    ],
  };
}
const TAIL = '{"op":"upsert","partial":';

async function seedSession(fixture) {
  const withEnvelope = toolMessage("sm_a", "a");
  const plain = toolMessage("sm_b", null);
  const snapshotRecord = upsert(toolMessage("sm_c", "c"));
  const committed = jsonl([upsert(withEnvelope), upsert(plain)]);
  await fixture.write("turns/turn-1.jsonl", `${committed}${TAIL}`);

  const snapshot = {
    schemaVersion: SUMMARY_SNAPSHOT_SCHEMA_VERSION,
    checkpointId: "cp-1",
    checkpointRevision: 1,
    previousCheckpointHash: "",
    records: [snapshotRecord],
  };
  await fixture.write(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);

  const manifest = {
    sessionId: "s-1",
    schemaVersion: SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION,
    parentSessionId: "",
    caller: "user",
    aggregateVersion: 3,
    turnTimings: [],
    turnLifecycle: {},
    sessionArtifactEvents: [],
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:01.000Z",
    turnOrder: [
      {
        turnId: "turn-1",
        turnScopeId: TURN,
        dialogProcessId: DIALOG,
        file: "turns/turn-1.jsonl",
        committedBytes: Buffer.byteLength(committed, "utf8"),
        recordCount: 2,
        messageCount: 3,
        messageOrder: ["sm_c", "sm_a", "sm_b"],
        messageHashes: {
          sm_a: messageHash(withEnvelope),
          sm_b: messageHash(plain),
          sm_c: snapshotRecord.hash,
        },
        summarySnapshots: [
          {
            checkpointId: "cp-1",
            checkpointRevision: 1,
            file: SNAPSHOT_FILE,
            contentHash: sha(snapshot),
            messageUids: ["sm_c"],
            committedAt: "2026-05-14T00:00:01.000Z",
          },
        ],
        compacted: false,
      },
    ],
    messageOrder: [{ messageUid: "sm_c" }, { messageUid: "sm_a" }, { messageUid: "sm_b" }],
  };
  await fixture.write("session.json", manifest);

  const detail = {
    schemaVersion: 1,
    presentationMessageId: "msg_detail",
    toolTimeline: [{ type: "tool_result", transfer: v2Envelope("d") }],
    activityTimeline: [],
  };
  await fixture.write(DETAIL_FILE, detail);
  const summary = {
    source: { revision: SUMMARY_REVISION },
    messages: [
      {
        presentationMessageId: "msg_detail",
        thinkingDetailRef: { file: DETAIL_FILE, contentHash: sha(detail) },
        transferEnvelopes: [v2Envelope("s")],
      },
    ],
  };
  await fixture.write("session-summary.json", summary);

  await fixture.write(
    "events/events.jsonl",
    jsonl([{ type: "e", transfer: v2Envelope("e") }, { type: "plain" }]),
  );
  await fixture.write(
    "events/events.20260514.jsonl",
    jsonl([{ type: "e", transfer: v2Envelope("r") }]),
  );
  await fixture.write(
    "authority-outbox/outbox.jsonl",
    jsonl([{ op: "o", transfer: v2Envelope("o") }]),
  );

  const segment = jsonl([{ type: "x", transfer: v2Envelope("x") }, { type: "plain" }]);
  await fixture.write(`${SEGMENT_DIR}/${SEGMENT_FILE}`, segment);
  await fixture.write(`${SEGMENT_DIR}/index.json`, v2TurnIndex(segment));
  return { manifest, committed, snapshot, detail, summary, withEnvelope, plain };
}

function assertV3(envelope, id) {
  assert.equal(envelope.version, TRANSFER_VERSION);
  assert.equal(envelope.presentationMessageId, `msg_${id}`);
  assert.equal(Object.hasOwn(envelope, V2_FIELD), false);
}

test("v6 rewrites session envelopes and resyncs every derived checksum", async () => {
  const fixture = await createFixture();
  try {
    const seeded = await seedSession(fixture);
    const originalJournal = await fixture.readText("turns/turn-1.jsonl");
    const result = await upgradeSessionTransferEnvelopes(fixture);

    assert.equal(result.sessions.length, 1);
    const [report] = result.sessions;
    assert.equal(report.droppedTailBytes, Buffer.byteLength(TAIL, "utf8"));
    assert.equal(report.journalEnvelopes, 2);
    assert.equal(report.plainEnvelopes, 3);
    assert.equal(report.executionEventEnvelopes, 1);

    const journalText = await fixture.readText("turns/turn-1.jsonl");
    const records = journalText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assertV3(records[0].message.transferEnvelopes[0], "a");
    assert.equal(records[0].hash, messageHash(records[0].message));
    assert.deepEqual(records[1], upsert(seeded.plain));
    assert.equal(journalText.includes(TAIL), false);

    const manifest = await fixture.readJson("session.json");
    const [turn] = manifest.turnOrder;
    assert.equal(turn.committedBytes, Buffer.byteLength(journalText, "utf8"));
    assert.equal(turn.recordCount, 2);
    assert.equal(turn.messageHashes.sm_a, records[0].hash);
    assert.equal(turn.messageHashes.sm_b, seeded.manifest.turnOrder[0].messageHashes.sm_b);
    const [snapshotIndex] = turn.summarySnapshots;
    const snapshot = await fixture.readJson(snapshotIndex.file);
    assert.equal(summarySnapshotContentHash(snapshot), snapshotIndex.contentHash);
    assertV3(snapshot.records[0].message.transferEnvelopes[0], "c");
    assert.equal(turn.messageHashes.sm_c, snapshot.records[0].hash);

    const detail = await fixture.readJson(DETAIL_FILE);
    assertV3(detail.toolTimeline[0].transfer, "d");
    const summary = await fixture.readJson("session-summary.json");
    assert.equal(summary.messages[0].thinkingDetailRef.contentHash, sha(detail));
    assertV3(summary.messages[0].transferEnvelopes[0], "s");
    assert.equal(summary.source.revision, SUMMARY_REVISION);

    assertV3(
      JSON.parse((await fixture.readText("events/events.jsonl")).split("\n")[0]).transfer,
      "e",
    );
    assertV3(JSON.parse(await fixture.readText("events/events.20260514.jsonl")).transfer, "r");
    assertV3(JSON.parse(await fixture.readText("authority-outbox/outbox.jsonl")).transfer, "o");
    const segment = await fixture.readText(`${SEGMENT_DIR}/${SEGMENT_FILE}`);
    assertV3(JSON.parse(segment.split("\n")[0]).transfer, "x");
    const index = await fixture.readJson(`${SEGMENT_DIR}/index.json`);
    assert.deepEqual(index, v2TurnIndex(segment));

    assert.equal(await fixture.readBackupText("turns/turn-1.jsonl"), originalJournal);
    assert.deepEqual(
      report.files.map((item) => item.path.slice(SESSION.length + 1)).sort(),
      [
        "authority-outbox/outbox.jsonl",
        "events/events.20260514.jsonl",
        "events/events.jsonl",
        `${SEGMENT_DIR}/index.json`,
        `${SEGMENT_DIR}/${SEGMENT_FILE}`,
        DETAIL_FILE,
        "session-summary.json",
        "session.json",
        SNAPSHOT_FILE,
        "turns/turn-1.jsonl",
      ].sort(),
    );

    const rerun = await upgradeSessionTransferEnvelopes(fixture);
    assert.deepEqual(rerun, { sessions: [], quarantined: [] });
  } finally {
    await fixture.restore();
  }
});

test("v6 quarantines a journal hash mismatch without writing any file", async () => {
  const fixture = await createFixture();
  try {
    const seeded = await seedSession(fixture);
    const tampered = { ...upsert(seeded.withEnvelope), hash: `sha256:${"0".repeat(64)}` };
    const committed = jsonl([tampered, upsert(seeded.plain)]);
    await fixture.write("turns/turn-1.jsonl", committed);
    const before = await fixture.readText("events/events.jsonl");
    const result = await upgradeSessionTransferEnvelopes(fixture);
    assert.deepEqual(result.sessions, []);
    const [quarantined] = result.quarantined;
    assert.equal(quarantined.path, SESSION);
    assert.equal(quarantined.error.code, "WORKSPACE_SESSION_TRANSFER_ENVELOPE_UPGRADE_INVALID");
    assert.equal(quarantined.error.details.reason, "journal_hash_mismatch");
    assert.equal(quarantined.error.details.messageUid, "sm_a");
    assert.equal(await fixture.readText("turns/turn-1.jsonl"), committed);
    assert.equal(await fixture.readText("events/events.jsonl"), before);
    assert.equal(await fixture.backupExists("turns/turn-1.jsonl"), false);
  } finally {
    await fixture.restore();
  }
});

test("v6 quarantines a manifest hash that does not match the committed record", async () => {
  const fixture = await createFixture();
  try {
    const seeded = await seedSession(fixture);
    const manifest = structuredClone(seeded.manifest);
    manifest.turnOrder[0].messageHashes.sm_a = "sha256:other";
    await fixture.write("session.json", manifest);
    const result = await upgradeSessionTransferEnvelopes(fixture);
    assert.deepEqual(result.quarantined[0].error.details, {
      reason: "manifest_message_hash_mismatch",
      turnId: "turn-1",
      messageUid: "sm_a",
    });
    assert.deepEqual(await fixture.readJson("session.json"), manifest);
    assert.equal(await fixture.backupExists("session.json"), false);
  } finally {
    await fixture.restore();
  }
});

test("v6 rewrites meta.json of sessions under declared scoped session roots", async () => {
  const fixture = await createFixture();
  const scopedRoot = TEST_SCOPED_SESSION_ROOTS.find((root) => root.includes("plugin-data/"));
  assert.ok(scopedRoot, "workflow manifest must declare a scoped session root");
  const sessionDir = path.join(fixture.base, scopedRoot, "s-parent", "node-1");
  const metaPath = path.join(sessionDir, "meta.json");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "session.json"),
      JSON.stringify({ sessionId: "node-1", turnOrder: [] }, null, 2),
    );

    const meta = { upstreamWorkflowNodeResults: [{ transferEnvelopes: [v2Envelope("m")] }] };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    const result = await upgradeSessionTransferEnvelopes(fixture);
    const report = result.sessions.find((item) => item.sessionDir.startsWith(scopedRoot));
    assert.equal(report.metaEnvelopes, 1);
    const text = await readFile(metaPath, "utf8");
    assert.equal(text.endsWith("\n"), false);
    const upgraded = JSON.parse(text);
    assertV3(upgraded.upstreamWorkflowNodeResults[0].transferEnvelopes[0], "m");
    const backup = await readFile(
      path.join(fixture.backupBase, scopedRoot, "s-parent", "node-1", "meta.json"),
      "utf8",
    );
    assert.equal(backup, JSON.stringify(meta, null, 2));
  } finally {
    await fixture.restore();
  }
});

test("v6 requires the scoped session root set", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      upgradeSessionTransferEnvelopes({ base: fixture.base, backupBase: fixture.backupBase }),
      /requires scopedSessionRoots/,
    );
  } finally {
    await fixture.restore();
  }
});

async function downgradeToJournalSnapshotIndexes(fixture, seeded, schemaVersion) {
  const [turn] = seeded.manifest.turnOrder;
  const { summarySnapshots, ...journalIndexedTurn } = turn;
  const indexRecords = summarySnapshots.map((index) => ({ op: "summary_snapshot", ...index }));
  const committed = jsonl([...indexRecords, upsert(seeded.withEnvelope), upsert(seeded.plain)]);
  await fixture.write("turns/turn-1.jsonl", committed);
  const manifest = {
    ...seeded.manifest,
    schemaVersion,
    turnOrder: [
      {
        ...journalIndexedTurn,
        committedBytes: Buffer.byteLength(committed, "utf8"),
        recordCount: indexRecords.length + 2,
      },
    ],
  };
  await fixture.write("session.json", manifest);
  return { manifest };
}

test("v6 upgrades snapshots indexed inside the turn journal before schema 11", async () => {
  const fixture = await createFixture();
  try {
    const seeded = await seedSession(fixture);
    await downgradeToJournalSnapshotIndexes(fixture, seeded, 7);
    const result = await upgradeSessionTransferEnvelopes(fixture);

    assert.deepEqual(result.quarantined, []);
    assert.equal(result.sessions[0].journalEnvelopes, 2);
    const snapshot = await fixture.readJson(SNAPSHOT_FILE);
    assertV3(snapshot.records[0].message.transferEnvelopes[0], "c");
    const journalText = await fixture.readText("turns/turn-1.jsonl");
    const [indexRecord, ...upserts] = journalText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(indexRecord.op, "summary_snapshot");
    assert.equal(indexRecord.contentHash, sha(snapshot));
    assertV3(upserts[0].message.transferEnvelopes[0], "a");

    const manifest = await fixture.readJson("session.json");
    const [turn] = manifest.turnOrder;
    assert.equal(manifest.schemaVersion, 7);
    assert.equal(Object.hasOwn(turn, "summarySnapshots"), false);
    assert.equal(turn.committedBytes, Buffer.byteLength(journalText, "utf8"));
    assert.equal(turn.messageHashes.sm_c, snapshot.records[0].hash);
  } finally {
    await fixture.restore();
  }
});

test("v6 upgrades cumulative message snapshots before schema 6", async () => {
  const fixture = await createFixture();
  try {
    const seeded = await seedSession(fixture);
    const legacySnapshot = { checkpointId: "cp-1", messages: [toolMessage("sm_c", "c")] };
    await fixture.write(SNAPSHOT_FILE, `${JSON.stringify(legacySnapshot, null, 2)}\n`);
    seeded.manifest.turnOrder[0].summarySnapshots[0].contentHash = sha(legacySnapshot);
    await downgradeToJournalSnapshotIndexes(fixture, seeded, 5);

    const result = await upgradeSessionTransferEnvelopes(fixture);

    assert.deepEqual(result.quarantined, []);
    const snapshot = await fixture.readJson(SNAPSHOT_FILE);
    assertV3(snapshot.messages[0].transferEnvelopes[0], "c");
    const [indexRecord] = (await fixture.readText("turns/turn-1.jsonl"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(indexRecord.op, "summary_snapshot");
    assert.equal(indexRecord.contentHash, sha(snapshot));
  } finally {
    await fixture.restore();
  }
});
