/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  MESSAGE_REMOVED_FIELD_NAME,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { projectTurnCompletionMessages } from "@noobot/context-protocol";
import { SESSION_REPAIR_DATA_REJECTION_CODES } from "@noobot/session-repair";
import { TRANSFER_ENVELOPE_V2 } from "@noobot/semantic-transfer-protocol";
import { EVENT_FAMILY, createEventEnvelope, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { messageHash } from "../src/session/session-artifact-session/turn-journal-store.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
import { readSessionArtifactSnapshot } from "../src/session/session-artifact-snapshot.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { legacyV2TransferEnvelope } from "./helpers/legacy-transfer-envelope.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./helpers/session-message-facts.js";
import {
  buildHarness,
  readJson,
  readJournalLines,
} from "./session/scoped-session-repositories.fixtures.js";

const SESSION_ID = "s-v9";
const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;
const LEGACY_USER_ID = "msg_legacy_user";
const LEGACY_EVENT_MESSAGE_ID = "msg_event_msg_legacy";
const jsonl = (records) => records.map((record) => `${JSON.stringify(record)}\n`).join("");

async function saveCanonicalSession(sessionRepo) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", SESSION_ID);
  const message = (messageUid, role, extra) => ({
    sessionId: SESSION_ID,
    messageUid,
    role,
    content: messageUid,
    dialogProcessId: "d1",
    turnScopeId: "t1",
    ts: `2026-01-01T00:00:0${messageUid.at(-1)}.000Z`,
    ...extra,
  });
  await sessionRepo.save(
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      parentSessionId: "",
      sessionId: SESSION_ID,
      aggregateVersion: 0,
      messages: [
        message("m1", "user", {}),
        message("m2", "assistant", { modelMessageId: "mm_m2", presentationMessageId: "pm_1" }),
      ],
    }),
    { createOnly: true, persistenceContext },
  );
  const scope = await sessionRepo.requireSessionScope("alice", SESSION_ID, persistenceContext);
  return scope.sessionDir;
}

function legacyOutboxCommit() {
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "event-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: SESSION_ID,
      turnScopeId: "t1",
    },
    causality: {},
    ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: "pm_1", sequence: 1 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-01-01T00:00:03.000Z",
    payload: {},
  });
  const legacy = structuredClone(envelope);
  legacy.identity[LEGACY_MESSAGE_ID] = LEGACY_EVENT_MESSAGE_ID;
  return {
    op: "commit",
    eventId: "event-1",
    envelope: legacy,
    committedAt: "2026-01-01T00:00:03.000Z",
  };
}

async function downgradeToSchema12(sessionDir) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readJson(manifestFile);
  const [turn] = manifest.turnOrder;
  const journalFile = path.join(sessionDir, turn.file);
  const records = readJournalLines(await readFile(journalFile, "utf8")).map((record) => {
    if (record.messageUid !== "m1") return record;
    const message = { ...record.message, [LEGACY_MESSAGE_ID]: LEGACY_USER_ID };
    return { ...record, message, hash: messageHash(message) };
  });
  const journalText = jsonl(records);
  await writeFile(journalFile, journalText, "utf8");
  turn.committedBytes = Buffer.byteLength(journalText);
  turn.messageHashes = Object.fromEntries(
    records.map((record) => [record.messageUid, record.hash]),
  );
  manifest.schemaVersion = 12;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  await mkdir(path.join(sessionDir, "authority-outbox"), { recursive: true });
  await writeFile(
    path.join(sessionDir, "authority-outbox", "outbox.jsonl"),
    jsonl([legacyOutboxCommit()]),
    "utf8",
  );
}

async function writeCorruptScopedSession(base) {
  const sessionDir = path.join(base, WORKSPACE_LAYOUT.AGENT_SESSION_DIR, "bad-1");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "session.json"), "{", "utf8");
  return path.relative(base, sessionDir);
}

async function writeOutbox(sessionDir, records) {
  await writeFile(
    path.join(sessionDir, "authority-outbox", "outbox.jsonl"),
    jsonl(records),
    "utf8",
  );
}

function flatOutboxDelivery(eventId) {
  return [
    {
      op: "commit",
      eventId,
      envelope: { protocolVersion: 1, eventId, eventType: "turn.completed" },
      committedAt: "2026-01-01T00:00:04.000Z",
    },
    { op: "attempt", eventId, consumerId: "c1", attemptedAt: "2026-01-01T00:00:05.000Z" },
    {
      op: "ack",
      eventId,
      consumerId: "c1",
      deliveredAt: "2026-01-01T00:00:06.000Z",
      orderingDomain: "turn",
      orderingScopeId: "t1",
      sequence: 1,
    },
  ];
}

test("v9 upgrade migrates schema 12 message identity, backs up rewritten files and is idempotent", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const base = path.join(root, "alice");
    const backupBase = path.join(root, "layout-backup");
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    const badUnit = await writeCorruptScopedSession(base);
    const options = { base, backupBase, scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS };

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(
      first.sessions.map((item) => [item.sessionId, item.fromSchemaVersion]),
      [[SESSION_ID, 12]],
    );
    assert.deepEqual(
      first.quarantined.map((item) => item.path),
      [badUnit],
    );
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(manifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    const journal = await readFile(path.join(sessionDir, manifest.turnOrder[0].file), "utf8");
    const user = readJournalLines(journal).find((record) => record.messageUid === "m1").message;
    assert.equal(user.userMessageId, LEGACY_USER_ID);
    assert.equal(Object.hasOwn(user, "messageId"), false);
    const outbox = readJournalLines(
      await readFile(path.join(sessionDir, "authority-outbox", "outbox.jsonl"), "utf8"),
    );
    assert.equal(Object.hasOwn(outbox[0].envelope.identity, "messageId"), false);
    const relativeDir = path.relative(base, sessionDir);
    const backedUp = await readJson(path.join(backupBase, relativeDir, "session.json"));
    assert.equal(backedUp.schemaVersion, 12);
    const backupOutbox = await readFile(
      path.join(backupBase, relativeDir, "authority-outbox", "outbox.jsonl"),
      "utf8",
    );
    assert.match(backupOutbox, new RegExp(LEGACY_EVENT_MESSAGE_ID));

    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(
      second.quarantined.map((item) => item.path),
      [badUnit],
    );
  } finally {
    await harness.cleanup();
  }
});

test("v9 upgrade aborts on file system failures instead of quarantining the unit", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    const backupBase = path.join(root, "backup-is-a-file");
    await writeFile(backupBase, "", "utf8");
    const base = path.join(root, "alice");
    await assert.rejects(
      upgradeSessionMessageIdentity({
        base,
        backupBase,
        scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      }),
      (error) => Boolean(error.syscall),
    );
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(manifest.schemaVersion, 12);
    const quarantineDir = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR);
    await assert.rejects(readdir(quarantineDir), { code: "ENOENT" });
  } finally {
    await harness.cleanup();
  }
});

test("v9 upgrade aborts on unregistered rejection codes instead of quarantining the unit", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    const manifestFile = path.join(sessionDir, "session.json");
    const manifest = await readJson(manifestFile);
    const futureVersion = SESSION_ARTIFACT_SCHEMA_VERSION + 1;
    await writeFile(manifestFile, JSON.stringify({ ...manifest, schemaVersion: futureVersion }));
    const base = path.join(root, "alice");
    await assert.rejects(
      upgradeSessionMessageIdentity({
        base,
        backupBase: path.join(root, "layout-backup"),
        scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      }),
      (error) =>
        typeof error.code === "string" &&
        !SESSION_REPAIR_DATA_REJECTION_CODES.includes(error.code) &&
        !error.syscall,
    );
    assert.equal((await readJson(manifestFile)).schemaVersion, futureVersion);
    const quarantineDir = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR);
    await assert.rejects(readdir(quarantineDir), { code: "ENOENT" });
  } finally {
    await harness.cleanup();
  }
});

test("v9 upgrade drops legacy-envelope outbox commits with their deliveries and reports event ids", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    await writeOutbox(sessionDir, [legacyOutboxCommit(), ...flatOutboxDelivery("event-flat")]);
    const base = path.join(root, "alice");
    const options = {
      base,
      backupBase: path.join(root, "layout-backup"),
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    };

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(first.quarantined, []);
    assert.deepEqual(
      first.sessions.map((item) => item.outbox.droppedEventIds),
      [["event-flat"]],
    );
    const outbox = readJournalLines(
      await readFile(path.join(sessionDir, "authority-outbox", "outbox.jsonl"), "utf8"),
    );
    assert.deepEqual(
      outbox.map((record) => [record.op, record.eventId]),
      [["commit", "event-1"]],
    );
    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(second.quarantined, []);
  } finally {
    await harness.cleanup();
  }
});

test("v9 upgrade quarantines outbox commits whose v3 envelope fails validation", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    const invalid = legacyOutboxCommit();
    delete invalid.envelope.producer;
    await writeOutbox(sessionDir, [invalid]);
    const base = path.join(root, "alice");

    const result = await upgradeSessionMessageIdentity({
      base,
      backupBase: path.join(root, "layout-backup"),
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    });

    assert.deepEqual(result.sessions, []);
    assert.deepEqual(
      result.quarantined.map((item) => item.path),
      [path.relative(base, sessionDir)],
    );
    assert.match(JSON.stringify(result.quarantined[0].error), /outbox_envelope_invalid/);
    assert.equal((await readJson(path.join(sessionDir, "session.json"))).schemaVersion, 12);
  } finally {
    await harness.cleanup();
  }
});

async function injectLegacyTransferEnvelope(sessionDir, shapeEnvelope = (envelope) => envelope) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readJson(manifestFile);
  const [turn] = manifest.turnOrder;
  const journalFile = path.join(sessionDir, turn.file);
  const records = readJournalLines(await readFile(journalFile, "utf8")).map((record) => {
    if (record.messageUid !== "m2") return record;
    const envelope = shapeEnvelope(
      legacyV2TransferEnvelope("v2", { sessionId: SESSION_ID, turnScopeId: "t1" }),
    );
    const message = { ...record.message, transferEnvelopes: [envelope] };
    return { ...record, message, hash: messageHash(message) };
  });
  const journalText = jsonl(records);
  await writeFile(journalFile, journalText, "utf8");
  turn.committedBytes = Buffer.byteLength(journalText);
  turn.messageHashes = Object.fromEntries(
    records.map((record) => [record.messageUid, record.hash]),
  );
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
}

function v9Options(root) {
  return {
    base: path.join(root, "alice"),
    backupBase: path.join(root, "layout-backup"),
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
  };
}

test("v9 upgrade lifts a lingering v2 transfer envelope to v3 in place", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    await injectLegacyTransferEnvelope(sessionDir);
    const options = v9Options(root);

    const first = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(first.quarantined, []);
    assert.equal(first.sessions.length, 1);
    const [turn] = (await readJson(path.join(sessionDir, "session.json"))).turnOrder;
    const records = readJournalLines(await readFile(path.join(sessionDir, turn.file), "utf8"));
    const [envelope] = records.find((record) => record.messageUid === "m2").message
      .transferEnvelopes;
    assert.equal(envelope.version, 3);
    assert.equal(envelope.presentationMessageId, "msg_v2");
    const second = await upgradeSessionMessageIdentity(options);
    assert.deepEqual(second.sessions, []);
    assert.deepEqual(second.quarantined, []);
  } finally {
    await harness.cleanup();
  }
});

test("v9 upgrade quarantines a session whose v2 transfer envelope cannot migrate", async () => {
  const harness = buildHarness();
  const { sessionRepo, root } = await harness.setup();
  try {
    const sessionDir = await saveCanonicalSession(sessionRepo);
    await downgradeToSchema12(sessionDir);
    await injectLegacyTransferEnvelope(sessionDir, (envelope) => ({
      ...envelope,
      [TRANSFER_ENVELOPE_V2.presentationField]: "not-a-presentation-id",
    }));
    const options = v9Options(root);

    const result = await upgradeSessionMessageIdentity(options);

    assert.deepEqual(result.sessions, []);
    assert.deepEqual(
      result.quarantined.map((item) => item.path),
      [path.relative(options.base, sessionDir)],
    );
    assert.match(JSON.stringify(result.quarantined[0].error), /transfer_envelope_unmigratable/i);
    assert.equal((await readJson(path.join(sessionDir, "session.json"))).schemaVersion, 12);
  } finally {
    await harness.cleanup();
  }
});

async function saveCheckpointedSession(sessionRepo, sessionId) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", sessionId);
  const message = (messageUid, ts) => ({
    sessionId,
    messageUid,
    role: messageUid === "m1" ? "user" : "assistant",
    ...(messageUid === "m1"
      ? {}
      : { modelMessageId: `mm_${messageUid}`, presentationMessageId: "pm_active" }),
    content: messageUid,
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
    const restored = await readSessionArtifact({ sessionDir });
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
    role: "assistant",
    modelMessageId: `mm_${messageUid}`,
    presentationMessageId: "pm_done",
    content: "",
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
    { messageUid: "m1", role: "user", userMessageId: "um_done", content: "go", ...turn },
    toolCall("m2", "call-ok", "read_file"),
    {
      messageUid: "m3",
      role: "tool",
      type: "tool_result",
      presentationMessageId: "pm_done",
      content: "file",
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
      readSessionArtifactSnapshot({ outputDir: sessionDir, includeExecutionLogs: false });
    await assert.rejects(openSession(), {
      code: SESSION_ERROR_CODE.COMPLETION_SUMMARY_REPAIR_REQUIRED,
    });
    const options = { base, backupBase, scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS };

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
      readSessionArtifactSnapshot({ outputDir: sessionDir, includeExecutionLogs: false }),
      { code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED },
    );
    const options = { base, backupBase, scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS };

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
