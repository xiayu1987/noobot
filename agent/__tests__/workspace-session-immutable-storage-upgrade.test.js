/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createEmptyTurnLifecycle,
  SESSION_COMMAND,
  appendCommandReceipt,
} from "@noobot/session-protocol";
import { prepareAttachmentBinding } from "../src/session/attachment-binding-request.js";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { immutableCheckpointKey } from "../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { commitSessionChanges } from "../src/session/session-artifact-session/commit-session-changes.js";
import { immutableAttachmentBindingKey } from "../src/session/session-artifact-session/immutable-command-index.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import {
  writeSessionArtifact,
  SESSION_ARTIFACT_PREDECESSOR,
  readSessionArtifact,
} from "../src/session/session-artifact-store.js";
import {
  migrateSessionImmutableStorage,
  upgradeSessionImmutableStorage,
} from "../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import { walkSessionManifestDirectories } from "../src/workspace-lifecycle/session-directory-walk.js";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  WORKSPACE_LAYOUT_UPGRADE_OWNER,
} from "@noobot/workspace-protocol";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_CURRENT_SESSION_FORMAT } from "@noobot/session-protocol/immutable-storage";
import { ImmutableObjectStore } from "../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../src/session/session-artifact-session/immutable-record-store.js";
import { exportImmutableSession } from "../src/session/session-artifact-session/immutable-session-export.js";
import { immutableSessionImportProjection } from "../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { setFsAdapter, resetFsAdapter } from "../src/shared/storage/fs-adapter.js";
import {
  quarantineMigrationUnit,
  listQuarantinedUnits,
  releaseQuarantinedUnits,
} from "../src/workspace-lifecycle/migration-quarantine.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import {
  readCommittedIndex,
  readCommittedValueMetadata,
} from "./session/helpers/immutable-record-reads.js";

async function fixture(t, binding = null) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-upgrade-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const timestamp = "2026-01-01T00:00:00.000Z";
  await writeSessionArtifact({
    storageService,
    sessionDir,
    atomic: true,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    sessionPayload: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: binding ? 1 : 0,
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        commandReceipts: binding
          ? appendCommandReceipt([], {
              commandId: binding.commandId,
              type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
              turnScopeId: binding.turnScopeId,
              requestHash: prepareAttachmentBinding(binding).requestHash,
              aggregateVersion: 1,
              result: { messageUid: binding.messageUid },
              committedAt: timestamp,
            })
          : [],
      },
      turnTimings: [],
      sessionArtifactEvents: [],
      selectedConnectorIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [0, 1, 2].map((index) => ({
        messageUid: `m${index}`,
        userMessageId: `u${index}`,
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: `d${index}`,
        turnScopeId: `t${index}`,
        parentDialogProcessId: "",
        role: "user",
        messageOrigin: "natural",
        type: "message",
        content: `message ${index}`,
        attachments: binding && index === 0 ? binding.attachments : [],
        transferEnvelopes: [],
        ts: timestamp,
      })),
      dialogOrder: [0, 1, 2].map((index) => ({
        dialogProcessId: `d${index}`,
        turnScopeId: `t${index}`,
        userMessageUid: `m${index}`,
        dialogOrdinal: index + 1,
      })),
    },
  });
  return sessionDir;
}

async function checkpointWorkspace(t) {
  const original = await fixture(t);
  const base = await mkdtemp(path.join(tmpdir(), "checkpoint-workspace-upgrade-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const sessionDir = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  await mkdir(path.dirname(sessionDir), { recursive: true });
  await rename(original, sessionDir);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const head = await store.snapshot();
  const record = await store.get(head, "messages", "m0");
  const checkpoint = parseTurnSummaryCheckpointRequest({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d0",
    turnScopeId: "t0",
    checkpointId: "legacy-cp",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m0"],
    summarizedMessageUids: ["m0"],
    retainedMessageUids: [],
    messages: [record.message],
  });
  const committedAt = "2026-01-01T00:00:00.000Z";
  const request = {
    sessionDir,
    sessionId: "s1",
    expectedGeneration: head.generation,
    operationId: "legacy-cp-operation",
    changes: { summaryCheckpoints: [checkpoint] },
    committedAt,
  };
  const receipt = {
    checkpointId: checkpoint.checkpointId,
    checkpointRevision: 1,
    requestHash: checkpoint.requestHash,
    persistedMessageUids: ["m0"],
    summarizedMessageUids: ["m0"],
    retainedMessageUids: [],
    markedCount: 1,
    committedAt,
  };
  const evidence = {
    expectedGeneration: head.generation,
    input: { changes: request.changes, committedAt },
  };
  await store.transact({
    expectedGeneration: head.generation,
    operationId: request.operationId,
    input: evidence.input,
    prepare: async () => ({
      changes: [
        { collection: "messages", key: "m0", value: record },
        {
          collection: "checkpoints",
          key: immutableCheckpointKey("t0", checkpoint.checkpointId),
          value: receipt,
        },
      ],
      result: {
        summaryCheckpoints: [{ committed: true, markedCount: 1, checkpointRevision: 1, receipt }],
      },
    }),
  });
  const options = {
    base,
    backupBase: path.join(base, "backups"),
    created: false,
    scopedSessionRoots: [],
    storageService,
  };
  return { options, sessionDir, store, request, evidence };
}

for (const retryQuarantine of [false, true]) {
  test(`workspace checkpoint evidence is scoped, digest checked and retryable (quarantine=${retryQuarantine})`, async (t) => {
    const { options, sessionDir, store, request, evidence } = await checkpointWorkspace(t);
    const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
    const version = retryQuarantine ? WORKSPACE_LAYOUT_VERSION : 37;
    await writeFile(layoutFile, JSON.stringify({ version }));
    if (retryQuarantine)
      await quarantineMigrationUnit({
        base: options.base,
        kind: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_IMMUTABLE_STORAGE,
        relativePath: WORKSPACE_LAYOUT.SESSION_DIR,
        error: Object.assign(new Error("checkpoint evidence missing"), {
          code: "EVIDENCE_REQUIRED",
        }),
      });
    const before = await readFile(store.headPath);
    let reads = 0;
    const readSessionOperationInput = async (identity) => {
      reads += 1;
      assert.deepEqual(identity, { sessionDir, operationId: request.operationId });
      return structuredClone(evidence);
    };
    const invalid = await upgradeWorkspaceLayout({
      ...options,
      readSessionOperationInput: async (identity) => {
        const input = await readSessionOperationInput(identity);
        input.input.committedAt = "2026-01-02T00:00:00.000Z";
        return input;
      },
    });
    assert.equal(invalid[0].failed.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    assert.deepEqual(await readFile(store.headPath), before);
    const applied = await upgradeWorkspaceLayout({ ...options, readSessionOperationInput });
    assert.equal(
      applied.some((item) => item.failed),
      false,
      JSON.stringify(applied),
    );
    assert.equal(reads, 2);
    assert.deepEqual(await listQuarantinedUnits({ base: options.base }), []);
    assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
    const replay = await commitSessionChanges(request);
    assert.equal(replay.replayed, true);
    assert.deepEqual(
      replay.result.summaryCheckpoints[0].messageReceipts.map((item) => item.messageUid),
      ["m0"],
    );
  });
}

test("workspace upgrade without original input retains evidence and makes historical retry explicitly unavailable", async (t) => {
  const { options, store, request, sessionDir } = await checkpointWorkspace(t);
  const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: 37 }));
  const before = await store.snapshot();
  const applied = await upgradeWorkspaceLayout(options);
  assert.equal(
    applied.some((item) => item.failed),
    false,
    JSON.stringify(applied),
  );
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  const current = await ImmutableSessionStore.open({ sessionDir });
  const after = await current.snapshot();
  assert.equal(after.generation, before.generation);
  assert.deepEqual(
    await current.get(after, "messages", "m0"),
    await store.get(before, "messages", "m0"),
  );
  await assert.rejects(commitSessionChanges(request), {
    code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
  });
  const headBytes = await readFile(current.headPath);
  await upgradeWorkspaceLayout(options);
  assert.deepEqual(await readFile(current.headPath), headBytes);
});

test("migration preserves session command receipts without inventing events and rebuilds attachment ownership", async (t) => {
  const binding = {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t0",
    messageUid: "m0",
    commandId: "bind",
    expectedAggregateVersion: 0,
    attachments: [
      {
        attachmentId: "a1",
        sessionId: "s1",
        attachmentSource: "user",
        name: "one.txt",
        mimeType: "text/plain",
      },
    ],
  };
  const sessionDir = await fixture(t, binding);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  const snapshot = await store.snapshot();
  assert.equal(await store.get(snapshot, "commands", immutableAttachmentBindingKey("m0")), "bind");
  assert.equal((await store.get(snapshot, "turnCommands", "t0")).count, 1);
  assert.deepEqual(await store.get(snapshot, "metadata", "commandIndex"), { version: 1 });
  const exported = await exportImmutableSession({ store, snapshot });
  assert.equal(exported.turnLifecycle.commandReceipts[0].commandId, "bind");
  assert.equal(exported.turnLifecycle.commandReceipts[0].eventId, undefined);
  const replay = await commitSessionChanges({
    sessionDir,
    sessionId: "s1",
    expectedGeneration: snapshot.generation,
    operationId: "replay-binding",
    committedAt: "2026-01-01T00:00:00.000Z",
    changes: { attachmentBinding: binding },
  });
  assert.equal(replay.result.attachmentBinding.deduplicated, true);
  await assert.rejects(
    commitSessionChanges({
      sessionDir,
      sessionId: "s1",
      expectedGeneration: snapshot.generation,
      operationId: "duplicate-binding",
      committedAt: "2026-01-01T00:00:00.000Z",
      changes: {
        attachmentBinding: { ...binding, commandId: "another", expectedAggregateVersion: 1 },
      },
    }),
    { statusCode: 409 },
  );
});

test("legacy journal migration verifies the new graph before publication and preserves source files for interruption recovery", async (t) => {
  const sessionDir = await fixture(t);
  const manifestPath = path.join(sessionDir, "session.json");
  const original = await readFile(manifestPath);
  const manifest = JSON.parse(original);
  const journals = await Promise.all(
    manifest.turnOrder.map((turn) => readFile(path.join(sessionDir, turn.file))),
  );
  const expected = immutableSessionImportProjection(
    await readSessionArtifact({ storageService, sessionDir }),
  );
  const first = await migrateSessionImmutableStorage({ storageService, sessionDir });
  assert.equal(first.generation, 1);
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  const actual = await exportImmutableSession({ store, snapshot: await store.snapshot() });
  assert.deepEqual(immutableSessionImportProjection(actual), expected);
  assert.deepEqual(await readFile(manifestPath), original);
  assert.deepEqual(
    await Promise.all(manifest.turnOrder.map((turn) => readFile(path.join(sessionDir, turn.file)))),
    journals,
  );
  assert.equal(
    (await migrateSessionImmutableStorage({ storageService, sessionDir })).replayed,
    true,
  );
});

test("repeated workspace migration preserves newer commits without opening the retired source or object tree", async (t) => {
  const original = await fixture(t);
  const base = await mkdtemp(path.join(tmpdir(), "immutable-workspace-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  await mkdir(root, { recursive: true });
  const sessionDir = path.join(root, "s1");
  await rename(original, sessionDir);
  await upgradeSessionImmutableStorage({ base, scopedSessionRoots: [], storageService });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  await store.commit({
    expectedGeneration: 1,
    operationId: "newer-commit",
    changes: [{ collection: "metadata", key: "proof", value: "newer" }],
  });
  await rm(path.join(sessionDir, "session.json"));
  const trap = path.join(sessionDir, "objects", "aa", "not-a-session");
  await mkdir(trap, { recursive: true });
  await writeFile(path.join(trap, "session.json"), "{}");
  const legacyDirectories = [];
  for await (const dir of walkSessionManifestDirectories(root)) legacyDirectories.push(dir);
  assert.deepEqual(legacyDirectories, []);
  let processed = 0;
  const result = await upgradeSessionImmutableStorage({
    base,
    scopedSessionRoots: [WORKSPACE_LAYOUT.SESSION_DIR],
    storageService,
    onSessionProcessed: () => {
      processed += 1;
    },
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(processed, 1);
  assert.equal(result.sessions[0].generation, 2);
  assert.equal(await store.get(await store.snapshot(), "metadata", "proof"), "newer");
});

test("workspace migration reports quarantine evidence, migrates nested healthy sessions and retries after release", async (t) => {
  const original = await fixture(t);
  const base = await mkdtemp(path.join(tmpdir(), "immutable-quarantine-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const parent = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "blocked");
  const child = path.join(parent, "s1");
  await mkdir(path.join(base, parent), { recursive: true });
  await rename(original, path.join(base, child));
  const source = "{not json";
  await writeFile(path.join(base, parent, "session.json"), source);
  const error = Object.assign(new Error("invalid source"), { code: "SOURCE_INVALID" });
  await quarantineMigrationUnit({ base, kind: "source-owner", relativePath: parent, error });
  await quarantineMigrationUnit({ base, kind: "second-owner", relativePath: parent, error });
  const evidence = await listQuarantinedUnits({ base });
  let processed = 0;
  const result = await upgradeSessionImmutableStorage({
    base,
    scopedSessionRoots: [WORKSPACE_LAYOUT.SESSION_DIR],
    storageService,
    onSessionProcessed: () => {
      processed += 1;
    },
  });
  assert.deepEqual(result.quarantined, evidence);
  assert.deepEqual(
    result.sessions.map((session) => session.sessionDir),
    [child],
  );
  assert.equal(processed, 2);
  assert.equal(await readFile(path.join(base, parent, "session.json"), "utf8"), source);
  await assert.rejects(readFile(path.join(base, parent, "head.json")), { code: "ENOENT" });
  assert.deepEqual(await listQuarantinedUnits({ base }), evidence);
  await releaseQuarantinedUnits({ base, kind: "source-owner" });
  assert.equal(
    (await upgradeSessionImmutableStorage({ base, scopedSessionRoots: [], storageService }))
      .quarantined.length,
    1,
  );
  await releaseQuarantinedUnits({ base, kind: "second-owner" });
  await assert.rejects(
    upgradeSessionImmutableStorage({ base, scopedSessionRoots: [], storageService }),
  );
  await rm(path.join(base, parent, "session.json"));
  const recovered = await fixture(t);
  await rename(recovered, path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "recovered"));
  const retried = await upgradeSessionImmutableStorage({
    base,
    scopedSessionRoots: [],
    storageService,
  });
  assert.equal(retried.sessions.length, 2);
  assert.deepEqual(retried.quarantined, []);
});

for (const injectFailure of [false, true]) {
  test(`current layout completes immutable migration after a source-owner quarantine retry (fault=${injectFailure})`, async (t) => {
    const original = await fixture(t);
    const base = await mkdtemp(path.join(tmpdir(), "immutable-source-retry-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const relativePath = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "s1");
    await mkdir(path.dirname(path.join(base, relativePath)), { recursive: true });
    await rename(original, path.join(base, relativePath));
    await writeFile(
      path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE),
      JSON.stringify({
        nodes: { s1: { sessionId: "s1", parentSessionId: "", caller: SESSION_CALLER.USER } },
      }),
    );
    await writeFile(
      path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE),
      JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION }),
    );
    await quarantineMigrationUnit({
      base,
      kind: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
      relativePath,
      error: Object.assign(new Error("source was repaired"), { code: "SOURCE_INVALID" }),
    });
    const options = {
      base,
      backupBase: path.join(base, "backup"),
      created: false,
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      storageService,
    };
    if (injectFailure) {
      setFsAdapter({
        rename: async (from, target) => {
          if (target === path.join(base, relativePath, "head.json"))
            throw Object.assign(new Error("retry head fault"), { code: "EIO" });
          return rename(from, target);
        },
      });
      try {
        const failed = await upgradeWorkspaceLayout(options);
        const migration = failed.find(
          (item) =>
            item.id ===
            `quarantine-retry:${WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_IMMUTABLE_STORAGE}`,
        );
        assert.equal(migration.failed.code, "SESSION_COMMIT_UNCERTAIN");
        const pending = await listQuarantinedUnits({ base });
        assert.equal(pending.length, 1);
        assert.equal(pending[0].kind, WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_IMMUTABLE_STORAGE);
        assert.equal(pending[0].error.code, migration.failed.code);
      } finally {
        resetFsAdapter();
      }
    }
    const applied = await upgradeWorkspaceLayout(options);
    assert.equal(
      applied.some((item) => item.failed),
      false,
      JSON.stringify(applied),
    );
    assert.deepEqual(await listQuarantinedUnits({ base }), []);
    const store = await ImmutableSessionStore.open({ sessionDir: path.join(base, relativePath) });
    assert.equal((await store.snapshot()).generation, 1);
  });
}

test("migration retry completes a missing format fence using only the verified committed head", async (t) => {
  const sessionDir = await fixture(t);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  await rm(path.join(sessionDir, "immutable-session.format"));
  await rm(path.join(sessionDir, "session.json"));
  const result = await migrateSessionImmutableStorage({ storageService, sessionDir });
  assert.equal(result.replayed, true);
  assert.equal(
    (await readFile(path.join(sessionDir, "immutable-session.format"), "utf8")).trim(),
    IMMUTABLE_CURRENT_SESSION_FORMAT,
  );
  await rm(path.join(sessionDir, "head.json"));
  await assert.rejects(migrateSessionImmutableStorage({ storageService, sessionDir }));
});

test("interrupted migration retains the complete legacy authority and retries deterministically", async (t) => {
  const sessionDir = await fixture(t);
  const before = await readSessionArtifact({ storageService, sessionDir });
  const headPath = path.join(sessionDir, "head.json");
  setFsAdapter({
    rename: async (from, target) => {
      if (target === headPath)
        throw Object.assign(new Error("migration head fault"), { code: "EIO" });
      return rename(from, target);
    },
  });
  try {
    await assert.rejects(migrateSessionImmutableStorage({ storageService, sessionDir }), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  await assert.rejects(readFile(headPath), { code: "ENOENT" });
  assert.deepEqual(await readSessionArtifact({ storageService, sessionDir }), before);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  assert.deepEqual(
    immutableSessionImportProjection(
      await exportImmutableSession({ store, snapshot: await store.snapshot() }),
    ),
    immutableSessionImportProjection(before),
  );
});

test("workspace upgrade converts legacy message receipts in the current storage format", async (t) => {
  const sessionDir = await fixture(t);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const before = await store.snapshot();
  const record = await store.get(before, "messages", "m0");
  const request = {
    sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "legacy-current-format-message",
    changes: { messages: [record.message] },
    committedAt: "2026-01-01T00:00:00.000Z",
  };
  await store.transact({
    expectedGeneration: request.expectedGeneration,
    operationId: request.operationId,
    input: { changes: request.changes, committedAt: request.committedAt },
    prepare: async () => ({
      changes: [{ collection: "messages", key: "m0", value: record }],
      result: { messages: [record.message] },
    }),
  });
  await assert.rejects(commitSessionChanges(request), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const generation = (await store.snapshot()).generation;
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  assert.equal((await store.snapshot()).generation, generation);
  const replay = await commitSessionChanges(request);
  assert.equal(replay.replayed, true);
  const migratedHead = await store.snapshot();
  const migratedMessage = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, migratedHead.root, "messages"),
      record.message.messageUid,
    ),
  );
  assert.deepEqual(replay.result.messageReceipts, [
    {
      sessionId: record.message.sessionId,
      messageUid: record.message.messageUid,
      dialogProcessId: record.message.dialogProcessId,
      turnScopeId: record.message.turnScopeId,
      contentReference: migratedMessage.parts[0].reference,
      generation,
      activityEventIds: (record.message.activityTimeline ?? []).map((activity) => activity.eventId),
    },
  ]);
  assert.equal(Object.hasOwn(replay.result, "messages"), false);
  const published = await readFile(store.headPath);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  assert.deepEqual(await readFile(store.headPath), published);
});

for (const [version, objectStore, step, injectFailure] of [
  [35, ImmutableObjectStore, "session-immutable-segments-v36", false],
  [35, ImmutableObjectStore, "session-immutable-segments-v36", true],
  [37, ImmutableRecordStore, "session-immutable-record-locations-v38", false],
  [37, ImmutableRecordStore, "session-immutable-record-locations-v38", true],
]) {
  test(`v${version} workspace migrates to current storage and retries publication (fault=${injectFailure})`, async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), "immutable-layout-upgrade-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const sessionDir = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
    const source = new ImmutableSessionStore({
      sessionDir,
      sessionId: "s1",
      allowCreate: true,
      objectStore,
    });
    const metadata = {
      session: { sessionId: "s1" },
      facts: {
        contextIndexVersion: 1,
        messageCount: 0,
        messageSequence: 0,
        turnSequence: 0,
        dialogSequence: 0,
        lastDialogOrdinal: 0,
        lastMessageOrdinal: 0,
        lastMessageUid: "",
      },
      events: { sequence: 0, outboxIndexVersion: 1 },
      commandIndex: { version: 1 },
      checkpointIndex: { version: 1 },
      titleIndex: { version: 1, root: null },
      proof: { text: "preserved across the versioned migration" },
    };
    const seedRequest = {
      expectedGeneration: 0,
      operationId: `seed-v${version}`,
      changes: Object.entries(metadata).map(([key, value]) => ({
        collection: "metadata",
        key,
        value,
      })),
    };
    const seedReceipt = await source.commit(seedRequest);
    const layoutFile = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
    await writeFile(layoutFile, JSON.stringify({ version }));
    const options = {
      base,
      backupBase: path.join(base, "backup"),
      created: false,
      scopedSessionRoots: [],
      storageService,
    };
    if (injectFailure) {
      const before = await readFile(source.headPath);
      setFsAdapter({
        rename: async (from, target) => {
          if (target === source.headPath)
            throw Object.assign(new Error("migration publication fault"), { code: "EIO" });
          return rename(from, target);
        },
      });
      try {
        const failed = await upgradeWorkspaceLayout(options);
        assert.equal(failed[0].id, step);
        assert.equal(failed[0].failed.code, "EIO");
        assert.deepEqual(await readFile(source.headPath), before);
        assert.equal(JSON.parse(await readFile(layoutFile)).version, version);
      } finally {
        resetFsAdapter();
      }
    }
    const applied = await upgradeWorkspaceLayout(options);
    assert.equal(applied[0].id, step);
    assert.equal(applied[0].failed, undefined, JSON.stringify(applied));
    assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
    const target = await ImmutableSessionStore.open({ sessionDir });
    const head = await target.snapshot();
    assert.equal(head.format, IMMUTABLE_CURRENT_SESSION_FORMAT);
    assert.deepEqual(await target.get(head, "metadata", "proof"), metadata.proof);
    const replay = await target.commit(seedRequest);
    assert.equal(replay.replayed, true);
    assert.equal(replay.generation, seedReceipt.generation);
    assert.deepEqual(await upgradeWorkspaceLayout(options), []);
    assert.deepEqual(await target.snapshot(), head);
  });
}
