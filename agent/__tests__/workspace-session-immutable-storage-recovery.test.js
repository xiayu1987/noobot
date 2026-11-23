/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";
import test from "node:test";
import assert from "node:assert/strict";
import { releaseQuarantinedUnits } from "./helpers/user-workspace.js";
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { commitSessionChanges } from "./helpers/commit-immutable-session-fixture.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
import {
  migrateSessionImmutableStorage,
  upgradeSessionImmutableStorage,
} from "../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  WORKSPACE_LAYOUT_UPGRADE_OWNER,
} from "@noobot/workspace-protocol";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import { PartitionJournalOwner } from "../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../src/session/partition-storage/partition-reader-access.js";
import { IMMUTABLE_CURRENT_SESSION_FORMAT } from "@noobot/session-protocol/immutable-storage";
import { ImmutableObjectStore } from "../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../src/session/session-artifact-session/immutable-record-store.js";
import { exportImmutableSession } from "../src/session/session-artifact-session/immutable-session-export.js";
import { immutableSessionImportProjection } from "../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { setFsAdapter, resetFsAdapter } from "../src/shared/storage/fs-adapter.js";
import {
  quarantineMigrationUnit,
  listQuarantinedUnits,
} from "../src/workspace-lifecycle/migration-quarantine.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import {
  readCommittedIndex,
  readCommittedValueMetadata,
} from "./session/helpers/immutable-record-reads.js";
import { fixture } from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

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
    targetStorageBudget: createTestPartitionStorageBudget(),
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
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService,
  });
  assert.equal(retried.sessions.length, 2);
  assert.deepEqual(retried.quarantined, []);
});

test("v34 workspace migrates healthy sessions without releasing a rejected source", async (t) => {
  const original = await fixture(t);
  const base = await mkdtemp(path.join(tmpdir(), "immutable-layout-quarantine-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const rejected = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "broken");
  const healthy = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  const state = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  const source = "{not json";
  await mkdir(path.join(base, rejected), { recursive: true });
  await rename(original, healthy);
  await mkdir(path.dirname(state), { recursive: true });
  await writeFile(state, JSON.stringify({ version: 34 }));
  await writeFile(path.join(base, rejected, "session.json"), source);
  const owner = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY;
  await quarantineMigrationUnit({
    base,
    kind: owner,
    relativePath: rejected,
    error: new Error("invalid source"),
  });

  const options = {
    base,
    backupBase: path.join(base, "backup"),
    created: false,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService,
  };
  const failed = await upgradeWorkspaceLayout(options);
  assert.equal(failed.at(-1).failed.code, "ENOENT");
  assert.deepEqual(JSON.parse(await readFile(state, "utf8")), { version: 34 });
  assert.deepEqual(
    (await listQuarantinedUnits({ base })).map((unit) => unit.path),
    [rejected],
  );

  await writeFile(
    path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE),
    JSON.stringify({
      nodes: {
        s1: { sessionId: "s1", parentSessionId: "", caller: SESSION_CALLER.USER },
        broken: { sessionId: "broken", parentSessionId: "", caller: SESSION_CALLER.USER },
      },
    }),
  );
  const applied = await upgradeWorkspaceLayout(options);

  const v35 = applied.find(({ toVersion }) => toVersion === 35);
  assert.ok(v35, JSON.stringify(applied));
  const evidence = await listQuarantinedUnits({ base });
  assert.deepEqual(
    evidence.map(({ path: relativePath }) => relativePath),
    [rejected],
  );
  assert.equal(evidence[0].error.details.reason, "PERSISTED_JSON_CORRUPTED");
  assert.deepEqual(
    v35.result.quarantined.map(({ quarantinePath }) => quarantinePath),
    evidence.map(({ quarantinePath }) => quarantinePath),
  );
  assert.equal(applied.at(-1).failed.code, "SESSION_STORAGE_UPGRADE_BLOCKED");
  assert.equal(await readFile(path.join(base, rejected, "session.json"), "utf8"), source);
  await assert.rejects(readFile(path.join(base, rejected, "head.json")), { code: "ENOENT" });
  const store = await ImmutableSessionStore.open({ sessionDir: healthy });
  assert.equal((await store.snapshot()).generation, 1);
  assert.deepEqual(JSON.parse(await readFile(state, "utf8")), {
    version: 45,
  });
});

test("v43 retains earlier releases when a quarantine retry fails partway through", async (t) => {
  const original = await fixture(t);
  const base = await mkdtemp(path.join(tmpdir(), "quarantine-batch-retry-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const sessionDir = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  const relativePath = path.relative(base, sessionDir);
  await mkdir(path.dirname(sessionDir), { recursive: true });
  await rename(original, sessionDir);
  const state = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 43 }));
  await writeFile(
    path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE),
    JSON.stringify({
      nodes: { s1: { sessionId: "s1", parentSessionId: "", caller: SESSION_CALLER.USER } },
    }),
  );
  const kind = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY;
  const unit = await quarantineMigrationUnit({
    base,
    kind,
    relativePath,
    error: new Error("previous failure"),
  });
  const reasonFile = path.join(base, unit.quarantinePath);
  const reason = JSON.parse(await readFile(reasonFile, "utf8"));
  await writeFile(
    reasonFile,
    JSON.stringify({ ...reason, path: relativePath.split(path.sep).join("\\") }),
  );
  const missingPath = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "z-missing");
  await writeFile(path.join(base, missingPath), "missing source");
  const missingUnit = await quarantineMigrationUnit({
    base,
    kind,
    relativePath: missingPath,
    error: new Error("previous failure"),
    move: true,
  });
  const missingHeld = path.join(base, missingUnit.quarantinePath);
  const brokenReason = `${missingHeld}.reason.json`;
  await rm(missingHeld);
  const options = {
    base,
    backupBase: path.join(base, "backup"),
    created: false,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService,
  };

  const [failed] = await upgradeWorkspaceLayout(options);
  assert.equal(failed.id, `quarantine-retry:${kind}`);
  assert.equal(failed.failed.code, "ENOENT");
  assert.equal(JSON.parse(await readFile(state)).version, 43);
  assert.equal(JSON.parse(await readFile(reasonFile)).error.code, "ENOENT");
  assert.equal(JSON.parse(await readFile(brokenReason)).moved, true);
  await assert.rejects(readFile(path.join(sessionDir, "head.json")), { code: "ENOENT" });

  await rm(brokenReason);
  const applied = await upgradeWorkspaceLayout(options);
  assert.equal(
    applied.some(({ failed }) => failed),
    false,
    JSON.stringify(applied),
  );
  assert.deepEqual(await listQuarantinedUnits({ base }), []);
  const store = await ImmutableSessionStore.open({ sessionDir });
  assert.equal((await store.snapshot()).generation, 1);
  assert.equal(JSON.parse(await readFile(state)).version, WORKSPACE_LAYOUT_VERSION);
  assert.deepEqual(await upgradeWorkspaceLayout(options), []);
});

for (const injectFailure of [false, true]) {
  test(`partition cutover completes immutable migration after a source-owner quarantine retry (fault=${injectFailure})`, async (t) => {
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
      JSON.stringify({ version: 45 }),
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
      targetStorageBudget: createTestPartitionStorageBudget(),
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
        assert.equal(pending.length, 2);
        const source = pending.find(({ path: unitPath }) => unitPath === relativePath);
        assert.equal(source.restored, true);
        assert.equal(source.kind, WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY);
        const immutable = pending.find(
          ({ kind }) => kind === WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_IMMUTABLE_STORAGE,
        );
        assert.equal(immutable.error.code, migration.failed.code);
        const layoutFile = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
        assert.equal(JSON.parse(await readFile(layoutFile)).version, 45);
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
      owner: record.ordinal,
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
      session: {
        sessionId: "s1",
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
        aggregateVersion: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      lifecycle: { sequence: 0, activeTurnScopeId: "" },
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
      targetStorageBudget: createTestPartitionStorageBudget(),
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
    assert.deepEqual(
      applied.filter(({ failed }) => failed),
      [],
      JSON.stringify(applied),
    );
    assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
    const target = await ImmutableSessionStore.open({ sessionDir });
    const head = await target.snapshot();
    assert.equal(head.format, IMMUTABLE_CURRENT_SESSION_FORMAT);
    assert.deepEqual(await target.get(head, "metadata", "proof"), metadata.proof);
    assert.ok(head.generation >= seedReceipt.generation);
    await assert.rejects(target.commit(seedRequest), {
      code: "SESSION_STORAGE_AUTHORITY_MISMATCH",
    });
    assert.deepEqual(await upgradeWorkspaceLayout(options), []);
    assert.deepEqual(await target.snapshot(), head);
    await using owner = new PartitionJournalOwner({
      durableAncestor: base,
      maxJournals: 1,
      allowNewJournals: false,
    });
    const access = createPartitionSessionReaderAccess({
      acquireJournal: owner.acquire.bind(owner),
      withJournalRemoval: owner.withRemoval.bind(owner),
    });
    await using reader = await access.openArtifact({ sessionDir });
    assert.deepEqual(await reader.readMetadata(), metadata.session);
  });
}
