/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  MESSAGE_ORIGIN,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { projectTurnCompletionMessages } from "@noobot/context-protocol";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import {
  messageHash,
  summarySnapshotContentHash,
} from "../src/session/session-artifact-session/turn-journal-store.js";
import { createSessionDisplaySourceRevision } from "../src/session/session-display-source-revision.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
import { readSessionArtifactSnapshot } from "../src/session/session-artifact-snapshot.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./helpers/session-message-facts.js";
import {
  buildHarness,
  readJson,
  readJournalLines,
} from "./session/scoped-session-repositories.fixtures.js";
import { TEST_MESSAGE_TS } from "./helpers/session-run-payload.js";
import {
  SESSION_ID,
  jsonl,
  saveCanonicalSession,
  v9Options,
} from "./helpers/session-identity-upgrade.fixtures.js";

async function saveCheckpointedSession(sessionRepo, sessionId) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", sessionId);
  const message = (messageUid, ts) => ({
    sessionId,
    messageUid,
    role: messageUid === "m1" ? "user" : "assistant",
    ...(messageUid === "m1"
      ? { messageOrigin: MESSAGE_ORIGIN.NATURAL }
      : { modelMessageId: `mm_${messageUid}`, presentationMessageId: "pm_active" }),
    content: messageUid,
    attachments: [],
    dialogProcessId: "dialog-active",
    turnScopeId: "active",
    ts,
  });
  await sessionRepo.save(
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      parentSessionId: "",
      sessionId,
      aggregateVersion: 0,
      messages: [
        message("m1", "2026-01-01T00:00:00.000Z"),
        message("m2", "2026-01-01T00:00:30.000Z"),
      ],
      turnSummaryCheckpoints: {
        active: {
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          checkpointRevision: 1,
          receipts: [
            {
              checkpointId: "checkpoint-1",
              checkpointRevision: 1,
              requestHash: "sha256:fixture",
              persistedMessageUids: ["m1", "m2"],
              summarizedMessageUids: ["m1"],
              retainedMessageUids: [],
              markedCount: 1,
              committedAt: "2026-01-01T00:01:00.000Z",
            },
          ],
        },
      },
    }),
    { createOnly: true, persistenceContext },
  );
  const scope = await sessionRepo.requireSessionScope("alice", sessionId, persistenceContext);
  return { sessionDir: scope.sessionDir, tail: message("m3", "2026-01-01T00:02:00.000Z") };
}

async function downgradeToSchema10JournalSnapshots(sessionDir, tail) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readJson(manifestFile);
  const [turn] = manifest.turnOrder;
  const records = [
    ...turn.summarySnapshots.map((index) => ({
      op: "summary_snapshot",
      ...index,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
    })),
    { op: "upsert", messageUid: tail.messageUid, message: tail, hash: messageHash(tail) },
  ];
  const journalText = jsonl(records);
  await writeFile(path.join(sessionDir, turn.file), journalText, "utf8");
  const { summarySnapshots, ...v10Turn } = turn;
  manifest.schemaVersion = 10;
  manifest.messageOrder = [...manifest.messageOrder, { messageUid: tail.messageUid }];
  manifest.turnOrder = [
    {
      ...v10Turn,
      committedBytes: Buffer.byteLength(journalText),
      recordCount: records.length,
      messageCount: 3,
      messageOrder: ["m1", "m2", "m3"],
    },
  ];
  await writeFile(manifestFile, JSON.stringify(manifest), "utf8");
  return { file: turn.file, summarySnapshots };
}

test("v9 upgrade moves schema 10 journal snapshot indexes into the manifest", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionId = "v10-journal-snapshot-index";
    const { sessionDir, tail } = await saveCheckpointedSession(sessionRepo, sessionId);
    const { file, summarySnapshots } = await downgradeToSchema10JournalSnapshots(sessionDir, tail);

    const result = await upgradeSessionMessageIdentity({
      base: path.join(root, "alice"),
      backupBase: path.join(root, "layout-backup"),
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      storageService: TEST_STORAGE_SERVICE,
    });

    assert.deepEqual(
      result.sessions.map((item) => [item.sessionId, item.fromSchemaVersion]),
      [[sessionId, 10]],
    );
    const migrated = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(migrated.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    const withoutContentHash = ({ contentHash, ...index }) => index;
    assert.deepEqual(
      migrated.turnOrder[0].summarySnapshots.map(withoutContentHash),
      summarySnapshots.map(withoutContentHash),
    );
    const journal = readJournalLines(await readFile(path.join(sessionDir, file), "utf8"));
    assert.equal(
      journal.some((record) => record.op === "summary_snapshot"),
      false,
    );
    const restored = await readSessionArtifact({
      sessionDir,
      storageService: sessionRepo.storageService,
    });
    assert.deepEqual(
      restored.messages.map((entry) => entry.messageUid),
      ["m1", "m2", "m3"],
    );
  } finally {
    await harness.cleanup();
  }
});

async function saveCompletedTurnWithRejectedBatch(sessionRepo, sessionId) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", sessionId);
  const turn = { sessionId, dialogProcessId: "dialog-done", turnScopeId: "done" };
  const assistant = (messageUid, extra) => ({
    messageUid,
    ts: TEST_MESSAGE_TS,
    role: "assistant",
    modelMessageId: `mm_${messageUid}`,
    presentationMessageId: "pm_done",
    content: "",
    attachments: [],
    ...turn,
    ...extra,
  });
  const toolCall = (messageUid, id, name) =>
    assistant(messageUid, {
      type: "tool_call",
      chatPresentation: false,
      tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
    });

  const canonical = projectTurnCompletionMessages([
    {
      messageUid: "m1",
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      userMessageId: "um_done",
      content: "go",
      attachments: [],
      ...turn,
    },
    toolCall("m2", "call-ok", "read_file"),
    {
      messageUid: "m3",
      ts: TEST_MESSAGE_TS,
      role: "tool",
      type: "tool_result",
      presentationMessageId: "pm_done",
      content: "file",
      attachments: [],
      tool_call_id: "call-ok",
      toolName: "read_file",
      ...turn,
    },
    assistant("m5", { content: "done" }),
  ]);

  const rejected = {
    ...toolCall("m4", "call-rejected", "task_check"),
    summarized: false,
  };
  await sessionRepo.save(
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      sessionId,
      aggregateVersion: 0,
      turnLifecycle: {
        ...createTestSessionRequiredFields().turnLifecycle,
        turns: {
          done: {
            revision: 1,
            sequence: 1,
            ...turn,
            terminalStatus: { ...turn, status: "completed", reason: "run_completed" },
          },
        },
      },
      messages: [...canonical.slice(0, 3), rejected, canonical[3]],
    }),
    { createOnly: true, persistenceContext },
  );
  const scope = await sessionRepo.requireSessionScope("alice", sessionId, persistenceContext);
  return scope.sessionDir;
}

test("v11 upgrade removes rejected-batch tool_calls of completed turns, backs up and is idempotent", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionId = "v11-rejected-batch";
    const base = path.join(root, "alice");
    const backupBase = path.join(root, "layout-backup");
    const sessionDir = await saveCompletedTurnWithRejectedBatch(sessionRepo, sessionId);
    const openSession = () =>
      readSessionArtifactSnapshot({
        storageService: TEST_STORAGE_SERVICE,
        outputDir: sessionDir,
        includeExecutionLogs: false,
      });
    await assert.rejects(openSession(), {
      code: SESSION_ERROR_CODE.COMPLETION_SUMMARY_REPAIR_REQUIRED,
    });
    const options = {
      base,
      backupBase,
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      storageService: TEST_STORAGE_SERVICE,
    };

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(first.quarantined, []);
    assert.deepEqual(
      first.sessions.map((item) => item.sessionId),
      [sessionId],
    );
    assert.ok(first.sessions[0].migrations.includes("completed-turn-orphan-tool-calls"));
    const { session: restored } = await openSession();
    assert.deepEqual(
      restored.messages.map((entry) => entry.messageUid),
      ["m1", "m2", "m3", "m5"],
    );
    const relativeDir = path.relative(base, sessionDir);
    const backedUp = await readJson(path.join(backupBase, relativeDir, "session.json"));
    assert.ok(backedUp.messageOrder.some((entry) => entry.messageUid === "m4"));

    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(second.quarantined, []);
  } finally {
    await harness.cleanup();
  }
});

test("v14 upgrade drops schema 15 turn timing starts and timing shells, backs up and is idempotent", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const base = path.join(root, "alice");
    const backupBase = path.join(root, "layout-backup");
    const sessionDir = await saveCanonicalSession(sessionRepo);
    const manifestFile = path.join(sessionDir, "session.json");
    const manifest = await readJson(manifestFile);
    manifest.schemaVersion = 15;
    manifest.turnTimings = [
      {
        turnScopeId: "t1",
        dialogProcessId: "d1",
        thinkingStartedAt: "2026-01-01T00:00:01.000Z",
        thinkingFinishedAt: "2026-01-01T00:00:09.000Z",
      },
      { turnScopeId: "t0", dialogProcessId: "d0", thinkingStartedAt: "2026-01-01T00:00:00.000Z" },
    ];
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
    await assert.rejects(
      readSessionArtifactSnapshot({
        storageService: TEST_STORAGE_SERVICE,
        outputDir: sessionDir,
        includeExecutionLogs: false,
      }),
      { code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED },
    );
    const options = {
      base,
      backupBase,
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      storageService: TEST_STORAGE_SERVICE,
    };

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(first.quarantined, []);
    assert.deepEqual(
      first.sessions.map((item) => item.sessionId),
      [SESSION_ID],
    );
    assert.ok(first.sessions[0].migrations.includes("turn-timing-lifecycle-start-v16"));
    const upgraded = await readJson(manifestFile);
    assert.equal(upgraded.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    assert.deepEqual(upgraded.turnTimings, [
      { turnScopeId: "t1", dialogProcessId: "d1", thinkingFinishedAt: "2026-01-01T00:00:09.000Z" },
    ]);
    const { session: restored } = await readSessionArtifactSnapshot({
      storageService: TEST_STORAGE_SERVICE,
      outputDir: sessionDir,
      includeExecutionLogs: false,
    });
    assert.deepEqual(restored.turnTimings, upgraded.turnTimings);
    const relativeDir = path.relative(base, sessionDir);
    const backedUp = await readJson(path.join(backupBase, relativeDir, "session.json"));
    assert.equal(backedUp.schemaVersion, 15);
    assert.equal(backedUp.turnTimings.length, 2);

    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(second.quarantined, []);
  } finally {
    await harness.cleanup();
  }
});

const RETIRED_TASK_FIELDS = Object.freeze({ taskId: "", taskStatus: "" });

function withRetiredTaskFields(record) {
  if (record.op !== "upsert") return record;
  const message = { ...record.message, ...RETIRED_TASK_FIELDS };
  return { ...record, message, hash: messageHash(message) };
}

async function downgradeToSchema17WithTaskFields(sessionDir) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readJson(manifestFile);
  manifest.currentTaskId = "";
  for (const turn of manifest.turnOrder) {
    const latestHash = new Map();
    let previousCheckpointHash = "";
    for (const index of turn.summarySnapshots) {
      const snapshotFile = path.join(sessionDir, index.file);
      const snapshot = await readJson(snapshotFile);
      snapshot.records = snapshot.records.map(withRetiredTaskFields);
      snapshot.previousCheckpointHash = previousCheckpointHash;
      for (const record of snapshot.records) {
        if (record.op === "upsert") latestHash.set(record.messageUid, record.hash);
      }
      await writeFile(snapshotFile, JSON.stringify(snapshot), "utf8");
      index.contentHash = summarySnapshotContentHash(snapshot);
      previousCheckpointHash = index.contentHash;
    }
    const journalFile = path.join(sessionDir, turn.file);
    const records = readJournalLines(await readFile(journalFile, "utf8")).map(
      withRetiredTaskFields,
    );
    for (const record of records) {
      if (record.op === "upsert") latestHash.set(record.messageUid, record.hash);
    }
    const journalText = jsonl(records);
    await writeFile(journalFile, journalText, "utf8");
    turn.committedBytes = Buffer.byteLength(journalText);
    turn.messageHashes = Object.fromEntries(
      turn.messageOrder.map((uid) => [uid, latestHash.get(uid)]),
    );
  }
  manifest.schemaVersion = 17;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
}

test("v16 upgrade drops retired task fields from journals and snapshots so stored hashes match", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionId = "v17-retired-task-fields";
    const { sessionDir } = await saveCheckpointedSession(sessionRepo, sessionId);
    await downgradeToSchema17WithTaskFields(sessionDir);
    const options = v9Options(root);

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(first.quarantined, []);
    assert.deepEqual(
      first.sessions.map((item) => [item.sessionId, item.fromSchemaVersion]),
      [[sessionId, 17]],
    );
    assert.ok(first.sessions[0].migrations.includes("retired-task-fields-v18"));
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(manifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    assert.equal(Object.hasOwn(manifest, "currentTaskId"), false);
    const restored = await readSessionArtifact({
      sessionDir,
      storageService: TEST_STORAGE_SERVICE,
    });
    const storedHashes = Object.assign({}, ...manifest.turnOrder.map((turn) => turn.messageHashes));
    for (const message of restored.messages) {
      assert.equal(Object.hasOwn(message, "taskId"), false);
      assert.equal(Object.hasOwn(message, "taskStatus"), false);
      assert.equal(storedHashes[message.messageUid], messageHash(message));
    }
    const { session: opened } = await readSessionArtifactSnapshot({
      storageService: TEST_STORAGE_SERVICE,
      outputDir: sessionDir,
      includeExecutionLogs: false,
    });
    assert.match(createSessionDisplaySourceRevision(opened), /^sha256:/);

    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(second.quarantined, []);
  } finally {
    await harness.cleanup();
  }
});
