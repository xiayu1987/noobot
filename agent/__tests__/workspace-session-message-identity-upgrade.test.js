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
} from "@noobot/session-protocol";
import { SESSION_REPAIR_DATA_REJECTION_CODES } from "@noobot/session-repair";
import { EVENT_FAMILY, createEventEnvelope, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { messageHash } from "../src/session/session-artifact-session/turn-journal-store.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
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
