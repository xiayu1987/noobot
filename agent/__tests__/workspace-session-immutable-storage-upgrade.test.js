/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { commitSessionChanges } from "./helpers/commit-immutable-session-fixture.js";
import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { PartitionJournal } from "../src/session/partition-storage/partition-journal.js";
import { withPartitionSessionReader } from "../src/session/partition-storage/partition-session-reader.js";
import { journalHeadPath } from "../src/session/partition-storage/journal-io.js";
import { withStorageCleanup } from "../src/shared/storage/durable-file.js";
import { readPartitionStorageRoot } from "../src/session/session-storage-authority.js";
import { immutableAttachmentBindingKey } from "../src/session/session-artifact-session/immutable-command-index.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
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
import { IMMUTABLE_TITLE_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage";
import { exportImmutableSession } from "../src/session/session-artifact-session/immutable-session-export.js";
import { immutableSessionImportProjection } from "../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { setFsAdapter, resetFsAdapter } from "../src/shared/storage/fs-adapter.js";
import {
  quarantineMigrationUnit,
  listQuarantinedUnits,
} from "../src/workspace-lifecycle/migration-quarantine.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import {
  fixture,
  migratedWorkspace,
  checkpointWorkspace,
} from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

async function withMigratedCheckpoint(
  { sessionDir, sessionId, expectedGeneration, ...command },
  run,
) {
  const root = await readPartitionStorageRoot(sessionDir);
  const request = prepareScopedSessionCommitRequest({ epoch: null, expectedGeneration }, command);
  const journal = await PartitionJournal.open({ root, sessionId });
  return withStorageCleanup(
    () =>
      withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, (reader, commit) =>
        run(reader, () => commit(request), journalHeadPath(root)),
      ),
    () => journal.close(),
  );
}

for (const retryQuarantine of [false, true]) {
  test(`workspace checkpoint evidence is scoped, digest checked and retryable (quarantine=${retryQuarantine})`, async (t) => {
    const { options, sessionDir, store, request, evidence } = await checkpointWorkspace(t);
    const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
    const version = retryQuarantine ? 45 : 37;
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
    const replay = await withMigratedCheckpoint(request, async (reader, commit, current) => {
      const beforeReplay = await readFile(current);
      const result = await commit();
      assert.deepEqual(await readFile(current), beforeReplay);
      assert.deepEqual(
        await reader.readCheckpoint("t0", "legacy-cp"),
        result.result.summaryCheckpoints[0].receipt,
      );
      return result;
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(
      replay.result.summaryCheckpoints[0].messageReceipts.map((item) => item.messageUid),
      ["m0"],
    );
  });
}

test("workspace upgrade without original input retains evidence and makes historical retry explicitly unavailable", async (t) => {
  const { options, store, request } = await checkpointWorkspace(t);
  const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: 37 }));
  const before = await store.snapshot();
  const original = await exportImmutableSession({ store, snapshot: before });
  const applied = await upgradeWorkspaceLayout(options);
  assert.equal(
    applied.some((item) => item.failed),
    false,
    JSON.stringify(applied),
  );
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  await withMigratedCheckpoint(request, async (reader, commit, current) => {
    assert.deepEqual(
      await reader.readCheckpoint("t0", "legacy-cp"),
      original.turnSummaryCheckpoints.t0.receipts[0],
    );
    const headBytes = await readFile(current);
    await assert.rejects(commit(), { code: "SESSION_OPERATION_RETRY_UNAVAILABLE" });
    assert.deepEqual(await upgradeWorkspaceLayout(options), []);
    assert.deepEqual(await readFile(current), headBytes);
  });
});

test("v43 workspace publishes the rebuilt title index before committing the layout upgrade", async (t) => {
  const { base, store } = await migratedWorkspace(t);
  const initial = await store.snapshot();
  const metadata = await store.get(initial, "metadata", "session");
  await store.commit({
    expectedGeneration: initial.generation,
    operationId: "seed-v43-title-index",
    changes: [{ collection: "metadata", key: "titleIndex", value: { version: 1, root: null } }],
  });
  const before = await store.snapshot();
  const layoutFile = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: 43 }));
  const options = {
    base,
    backupBase: path.join(base, "backup"),
    created: false,
    scopedSessionRoots: [],
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService,
  };
  setFsAdapter({
    rename: async (from, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("title publication fault"), { code: "EIO" });
      return rename(from, target);
    },
  });
  try {
    const [failed] = await upgradeWorkspaceLayout(options);
    assert.equal(failed.id, "session-title-index-v44");
    assert.equal(failed.failed.code, "SESSION_COMMIT_UNCERTAIN");
    assert.deepEqual(await store.snapshot(), before);
    assert.equal(JSON.parse(await readFile(layoutFile)).version, 43);
  } finally {
    resetFsAdapter();
  }
  const [applied] = await upgradeWorkspaceLayout(options);
  assert.equal(applied.id, "session-title-index-v44");
  assert.equal(applied.failed, undefined, JSON.stringify(applied));
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  const after = await store.snapshot();
  assert.equal(after.generation, before.generation + 1);
  const descriptor = await store.get(after, "metadata", "titleIndex");
  assert.equal(descriptor.version, IMMUTABLE_TITLE_INDEX_VERSION);
  assert.notEqual(descriptor.root, null);
  assert.deepEqual(await store.get(after, "metadata", "session"), metadata);
  assert.deepEqual(await upgradeWorkspaceLayout(options), []);
  assert.deepEqual(await store.snapshot(), after);
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
    targetStorageBudget: createTestPartitionStorageBudget(),
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
