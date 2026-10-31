/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { isCanonicalActivityTimelineFact } from "@noobot/event-protocol/activity-timeline";
import { upgradeSessionActivityTimeline } from "../src/workspace-lifecycle/session-activity-timeline-upgrade.js";
import {
  messageHash,
  summarySnapshotContentHash,
} from "../src/session/session-artifact-session/turn-journal-store.js";

const SESSION_ID = "s-activity";
const PRESENTATION_ID = "msg_p1";
const TURN = "client-turn:t1";
const SESSION_REL = path.join("runtime", "session", SESSION_ID);

function legacyFact(n, text = `analysis ${n}`) {
  const fact = {
    eventId: `model-content:msg_${n}`,
    event: "main_model_content",
    type: "main_model_content",
    text,
    output: text,
  };
  return { ...fact, log: { ...fact } };
}

function evidenceLine(n, overrides = {}) {
  return JSON.stringify({
    event: "main_model_content",
    data: {
      eventId: `model-content:msg_${n}`,
      eventType: "main_model_content",
      text: `analysis ${n}`,
      sequence: n,
      sequenceScopeId: `msg_event_${PRESENTATION_ID}`,
      sequenceDomain: "message-event",
      timestamp: `2026-08-04T00:00:0${n}.000Z`,
      sessionId: SESSION_ID,
      dialogProcessId: "d1",
      turnScopeId: TURN,
      presentationMessageId: PRESENTATION_ID,
      ...overrides,
    },
  });
}

const guidanceFact = {
  eventId: "guidance-analysis:g1",
  eventType: "thinking",
  text: "Analyzing",
  activityKind: "guidance_analysis",
  purpose: "guidance",
  pluginFlow: "analysis",
  chain: "auxiliary",
  sequence: 9,
  sequenceScopeId: `msg_event_${PRESENTATION_ID}`,
  sequenceDomain: "message-event",
  authority: "authoritative",
  timestamp: "2026-08-04T00:00:00.000Z",
  sessionId: SESSION_ID,
  dialogProcessId: "d1",
  turnScopeId: TURN,
  presentationMessageId: PRESENTATION_ID,
  activityId: "g1",
};

function message(uid, activityTimeline) {
  return {
    role: "assistant",
    content: uid,
    sessionId: SESSION_ID,
    messageUid: uid,
    dialogProcessId: "d1",
    turnScopeId: TURN,
    presentationMessageId: PRESENTATION_ID,
    ...(activityTimeline ? { activityTimeline } : {}),
  };
}

function upsert(msg) {
  return { op: "upsert", messageUid: msg.messageUid, message: msg, hash: messageHash(msg) };
}

async function writeSession(base, { messages, evidence }) {
  const sessionDir = path.join(base, SESSION_REL);
  const checkpoints = [messages.slice(0, 2), messages.slice(2)];
  const summarySnapshots = [];
  let previousCheckpointHash = "";
  for (const [index, group] of checkpoints.entries()) {
    const file = `turn-snapshots/turn-000001/checkpoint-00000${index + 1}.json`;
    const payload = {
      schemaVersion: SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
      checkpointId: `cp${index + 1}`,
      checkpointRevision: index + 1,
      previousCheckpointHash,
      records: group.map(upsert),
    };
    const contentHash = summarySnapshotContentHash(payload);
    await mkdir(path.dirname(path.join(sessionDir, file)), { recursive: true });
    await writeFile(path.join(sessionDir, file), `${JSON.stringify(payload, null, 2)}\n`);
    summarySnapshots.push({
      checkpointId: payload.checkpointId,
      checkpointRevision: payload.checkpointRevision,
      file,
      contentHash,
    });
    previousCheckpointHash = contentHash;
  }
  const manifest = {
    sessionId: SESSION_ID,
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    turnOrder: [
      {
        turnId: "turn-000001",
        committedBytes: 0,
        messageHashes: Object.fromEntries(messages.map((m) => [m.messageUid, messageHash(m)])),
        summarySnapshots,
      },
    ],
  };
  await writeFile(path.join(sessionDir, "session.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.join(sessionDir, "events"), { recursive: true });
  await writeFile(path.join(sessionDir, "events", "system.jsonl"), `${evidence.join("\n")}\n`);
  return sessionDir;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function withBase(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v21-activity-"));
  try {
    await run({
      base: path.join(root, "alice"),
      backupBase: path.join(root, "backup"),
      scopedSessionRoots: ["runtime/agents"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fixtureMessages() {
  return [
    message("u1", [{ ...guidanceFact, event: "guidance_analysis_response", userId: "x" }]),
    message("u2"),
    message("u3", [legacyFact(1), legacyFact(2)]),
  ];
}

test("v21 migrates legacy activity facts from frozen evidence and relinks every hash layer", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, {
      messages: fixtureMessages(),
      evidence: [evidenceLine(1), evidenceLine(2)],
    });
    const result = await upgradeSessionActivityTimeline(options);
    assert.equal(result.quarantined.length, 0);
    assert.equal(result.sessions[0].migratedMessages, 2);

    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const [turn] = manifest.turnOrder;
    let previous = "";
    for (const index of turn.summarySnapshots) {
      const payload = await readJson(path.join(sessionDir, index.file));
      assert.equal(payload.previousCheckpointHash, previous);
      assert.equal(summarySnapshotContentHash(payload), index.contentHash);
      for (const record of payload.records) {
        assert.equal(record.hash, messageHash(record.message));
        assert.equal(turn.messageHashes[record.messageUid], record.hash);
        for (const fact of record.message.activityTimeline || []) {
          assert.ok(isCanonicalActivityTimelineFact(fact));
        }
      }
      previous = index.contentHash;
    }
    const last = await readJson(path.join(sessionDir, turn.summarySnapshots[1].file));
    assert.deepEqual(last.records[0].message.activityTimeline[0], {
      eventId: "model-content:msg_1",
      eventType: "model_analysis_delta",
      text: "analysis 1",
      activityKind: "main_model_analysis",
      authority: "authoritative",
      activityId: "model-content:msg_1",
      sequence: 1,
      sequenceScopeId: `msg_event_${PRESENTATION_ID}`,
      sequenceDomain: "message-event",
      timestamp: "2026-08-04T00:00:01.000Z",
      sessionId: SESSION_ID,
      dialogProcessId: "d1",
      turnScopeId: TURN,
      presentationMessageId: PRESENTATION_ID,
    });
    const first = await readJson(path.join(sessionDir, turn.summarySnapshots[0].file));
    assert.deepEqual(first.records[0].message.activityTimeline, [guidanceFact]);
    assert.deepEqual(first.records[1].message, message("u2"));

    const again = await upgradeSessionActivityTimeline(options);
    assert.deepEqual(again, { sessions: [], quarantined: [] });
  });
});

for (const [name, evidence, reason] of [
  ["missing", [evidenceLine(1)], "legacy_activity_evidence_missing"],
  ["ambiguous", [evidenceLine(1), evidenceLine(1), evidenceLine(2)], "legacy_evidence_ambiguous"],
  [
    "mismatched",
    [evidenceLine(1), evidenceLine(2, { presentationMessageId: "msg_other" })],
    "legacy_activity_evidence_mismatch",
  ],
]) {
  test(`v21 quarantines a session whose legacy evidence is ${name} without writing it`, async () => {
    await withBase(async (options) => {
      const sessionDir = await writeSession(options.base, {
        messages: fixtureMessages(),
        evidence,
      });
      const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
      const result = await upgradeSessionActivityTimeline(options);
      assert.equal(result.sessions.length, 0);
      assert.equal(result.quarantined.length, 1);
      assert.match(JSON.stringify(result.quarantined[0].error), new RegExp(reason));
      assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
    });
  });
}

test("v21 leaves canonical sessions untouched", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, {
      messages: [message("u1", [guidanceFact]), message("u2"), message("u3")],
      evidence: [],
    });
    const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
    assert.deepEqual(await upgradeSessionActivityTimeline(options), {
      sessions: [],
      quarantined: [],
    });
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
  });
});

test("v21 maps identical messages sharing one record hash to the same migrated hash", async () => {
  await withBase(async (options) => {
    const legacy = message("u3", [legacyFact(1)]);
    const sessionDir = await writeSession(options.base, {
      messages: [message("u1"), legacy, legacy],
      evidence: [evidenceLine(1)],
    });
    const result = await upgradeSessionActivityTimeline(options);
    assert.equal(result.quarantined.length, 0);
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const [turn] = manifest.turnOrder;
    const hashes = [];
    for (const index of turn.summarySnapshots) {
      const payload = await readJson(path.join(sessionDir, index.file));
      for (const record of payload.records.filter((item) => item.messageUid === "u3")) {
        hashes.push(record.hash);
      }
    }
    assert.equal(hashes.length, 2);
    assert.equal(hashes[0], hashes[1]);
    assert.equal(turn.messageHashes.u3, hashes[0]);
  });
});
