/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { releaseQuarantinedUnits } from "../../agent/__tests__/helpers/user-workspace.js";
import { test } from "node:test";
import { appendFile, cp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";
import { executeEmptySessionCleanup } from "../../agent/__tests__/helpers/session-services.js";
import { IMMUTABLE_READER_RETENTION } from "@noobot/session-protocol/immutable-storage";
import { fileURLToPath } from "node:url";
import {
  resolvePluginDataRelativePath,
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
} from "@noobot/workspace-protocol";
import { createSessionServices, immutableSessionReaderAccess } from "noobot-agent/session";
import { createConfiguredSessionRuntime } from "../bootstrap/create-app-dependencies.js";
import { withImmutableSessionMigrationSource } from "../../agent/src/workspace-lifecycle/immutable-session-migration-source.js";
import { upgradeWorkspaceLayout } from "../../agent/src/workspace-lifecycle/sections.js";
import { getFsAdapter, setFsAdapter } from "../../agent/src/shared/storage/fs-adapter.js";
import { quarantineMigrationUnit } from "../../agent/src/workspace-lifecycle/migration-quarantine.js";
import { migrateImmutableSessionToPartition } from "../../agent/src/workspace-lifecycle/migrate-immutable-session-to-partition.js";
import {
  journalPartitionPath,
  readJournalHead,
} from "../../agent/src/session/partition-storage/journal-io.js";
import {
  partitionMigrationAuthorityPath,
  readPartitionStorageRoot,
} from "../../agent/src/session/session-storage-authority.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

async function readSourceReaderEntries(sessionDir) {
  try {
    return await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function createOfflineCutover(t) {
  let assemble = (config, dependencies) =>
    createSessionServices(config, {
      ...dependencies,
      sessionReaderAccess: immutableSessionReaderAccess,
    });
  const pluginRootDir = fileURLToPath(new URL("../../plugin/", import.meta.url));
  const f = await createPartitionBotFixture(t, {
    assemble: (config, dependencies) => assemble(config, dependencies),
    pluginRootDir,
  });
  const { bot: legacy } = await f.service.rebuildRuntimeConfig();
  const request = firstSend();
  const accepted = await legacy.session.applyTurnLifecycleEvent(request);
  await legacy.session.renameSession({ ...identity, title: "Before cutover" });
  const { sessionDir } = await legacy.session.locateSessionScope(identity);
  const bundle = await legacy.session.getSessionBundle(identity);
  const allowedRoot = "runtime/agent/session";
  const child = {
    ...firstSend({ ...identity, sessionId: "child" }),
    parentSessionId: identity.sessionId,
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:internal-turn:child-turn",
      parentSessionId: identity.sessionId,
      allowedRoot,
      relativeDir: `${allowedRoot}/child`,
    }),
  };
  const acceptedChild = await legacy.session.applyTurnLifecycleEvent(child);
  const { sessionDir: childDir } = await legacy.session.locateSessionScope({
    userId: child.userId,
    sessionId: child.sessionId,
    persistenceScope: child.persistenceScope,
  });
  const pluginRoot = resolvePluginDataRelativePath("workflow", "session");
  const pluginChild = {
    ...firstSend({ ...identity, sessionId: "workflow-child" }),
    parentSessionId: identity.sessionId,
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:workflow:workflow-child",
      parentSessionId: identity.sessionId,
      allowedRoot: pluginRoot,
      relativeDir: `${pluginRoot}/workflow-child`,
    }),
  };
  const acceptedPlugin = await legacy.session.applyTurnLifecycleEvent(pluginChild);
  const pluginScope = {
    userId: pluginChild.userId,
    sessionId: pluginChild.sessionId,
    persistenceScope: pluginChild.persistenceScope,
  };
  const { sessionDir: pluginDir } = await legacy.session.locateSessionScope(pluginScope);
  const originalPlugin = await legacy.session.getSessionBundle(pluginScope);
  await legacy.close();

  assemble = createConfiguredSessionRuntime;
  const { bot: beforeMigration } = await f.service.rebuildRuntimeConfig();
  const head = await readFile(join(sessionDir, "head.json"));
  await assert.rejects(beforeMigration.session.getSessionBundle(identity), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  await assert.rejects(beforeMigration.session.renameSession({ ...identity, title: "Forbidden" }), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  assert.deepEqual(await readFile(join(sessionDir, "head.json")), head);
  await beforeMigration.close();

  const backup = join(f.workspaceRoot, "before-cutover");
  await cp(sessionDir, backup, { recursive: true, errorOnExist: true, force: false });
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    ({ identity }) => identity,
  );
  const plan = {
    sessionDir,
    expectedSource,
    targetStorageBudget: f.budget,
    limit: 2,
    maxBytes: 4096,
  };
  const { targetStorageBudget } = plan;
  const base = join(f.workspaceRoot, identity.userId);
  const layoutFile = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: 45 }));
  const workspacePlan = {
    base,
    scopedSessionRoots: legacy.pluginRuntimeBundle.scopedSessionRoots,
    storageService: legacy.sessionRuntime.storageService,
    targetStorageBudget,
  };
  const quarantineKind = "unresolved-source";
  await quarantineMigrationUnit({
    base,
    kind: quarantineKind,
    relativePath: "runtime/session/rejected-session",
    error: new Error("Source could not be upgraded"),
  });
  const [blocked] = await upgradeWorkspaceLayout(workspacePlan);
  assert.equal(blocked.failed.code, "SESSION_STORAGE_UPGRADE_BLOCKED");
  assert.equal(JSON.parse(await readFile(layoutFile)).version, 45);
  for (const directory of [sessionDir, childDir, pluginDir])
    await assert.rejects(stat(partitionMigrationAuthorityPath(directory)), { code: "ENOENT" });
  await releaseQuarantinedUnits({ base, kind: quarantineKind });
  const sourceDirectories = [sessionDir, childDir, pluginDir];
  for (const directory of sourceDirectories)
    assert.deepEqual(await readSourceReaderEntries(directory), []);

  const adapter = getFsAdapter();
  const fault = new Error("Workflow selector publication interrupted");
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      if (to === partitionMigrationAuthorityPath(pluginDir)) throw fault;
      return adapter.rename(from, to);
    },
  });
  try {
    const [failed] = await upgradeWorkspaceLayout(workspacePlan);
    assert.equal(failed.failed.message, fault.message);
    assert.equal(JSON.parse(await readFile(layoutFile)).version, 45);
  } finally {
    setFsAdapter(adapter);
  }
  for (const directory of sourceDirectories)
    assert.deepEqual(await readSourceReaderEntries(directory), []);
  const mainSelector = await readFile(partitionMigrationAuthorityPath(sessionDir));
  const childSelector = await readFile(partitionMigrationAuthorityPath(childDir));
  await assert.rejects(stat(partitionMigrationAuthorityPath(pluginDir)), { code: "ENOENT" });
  const [policyFailure] = await upgradeWorkspaceLayout({
    ...workspacePlan,
    targetStorageBudget: {
      ...targetStorageBudget,
      journalLimits: {
        ...targetStorageBudget.journalLimits,
        batchWaitMs: targetStorageBudget.journalLimits.batchWaitMs + 1,
      },
    },
  });
  assert.equal(policyFailure.failed.code, "SESSION_STORAGE_POLICY_MISMATCH");
  assert.equal(JSON.parse(await readFile(layoutFile)).version, 45);
  assert.deepEqual(await readFile(partitionMigrationAuthorityPath(sessionDir)), mainSelector);
  assert.deepEqual(await readFile(partitionMigrationAuthorityPath(childDir)), childSelector);
  await assert.rejects(stat(partitionMigrationAuthorityPath(pluginDir)), { code: "ENOENT" });
  const [{ result: resumed }] = await upgradeWorkspaceLayout(workspacePlan);
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  assert.deepEqual(resumed.nativePartition, []);
  assert.deepEqual(
    new Set(resumed.receipts.map((entry) => entry.sessionDir)),
    new Set(sourceDirectories),
  );
  for (const { sessionDir: directory, ...receipt } of resumed.receipts) {
    const { source, target } = JSON.parse(
      await readFile(partitionMigrationAuthorityPath(directory)),
    );
    assert.deepEqual(receipt, { source, target });
  }
  assert.deepEqual(await readFile(partitionMigrationAuthorityPath(sessionDir)), mainSelector);
  assert.deepEqual(await readFile(partitionMigrationAuthorityPath(childDir)), childSelector);
  assert.deepEqual(await upgradeWorkspaceLayout(workspacePlan), []);

  const { bot: partition } = await f.service.rebuildRuntimeConfig();
  const migrated = await partition.session.getSessionBundle(identity);
  assert.equal(migrated.session.customTitle, "Before cutover");
  assert.equal(migrated.session.customTitle, bundle.session.customTitle);
  assert.deepEqual(migrated.session.messages, bundle.session.messages);
  const replay = await partition.session.applyTurnLifecycleEvent(request);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
  const childReplay = await partition.session.applyTurnLifecycleEvent(child);
  assert.equal(childReplay.deduplicated, true);
  assert.equal(childReplay.userMessage.messageUid, acceptedChild.userMessage.messageUid);
  const migratedPlugin = await partition.session.getSessionBundle(pluginScope);
  assert.deepEqual(migratedPlugin.session.messages, originalPlugin.session.messages);
  assert.equal(migratedPlugin.session.parentSessionId, identity.sessionId);
  const pluginReplay = await partition.session.applyTurnLifecycleEvent(pluginChild);
  assert.equal(pluginReplay.deduplicated, true);
  assert.equal(pluginReplay.userMessage.messageUid, acceptedPlugin.userMessage.messageUid);
  return { fixture: f, partition, sessionDir, backup, bundle, request, plan };
}

test("an offline restored backup must be upgraded before it can serve again", async (t) => {
  const { fixture, partition, sessionDir, backup, bundle, request, plan } =
    await createOfflineCutover(t);
  await partition.close();

  await rename(sessionDir, join(fixture.workspaceRoot, "after-cutover"));
  await rename(backup, sessionDir);
  const { bot: restored } = await fixture.service.rebuildRuntimeConfig();
  await assert.rejects(restored.session.getSessionBundle(identity), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  await restored.close();
  await migrateImmutableSessionToPartition(plan);
  const { bot: upgraded } = await fixture.service.rebuildRuntimeConfig();
  assert.deepEqual(
    (await upgraded.session.getSessionBundle(identity)).session.messages,
    bundle.session.messages,
  );
  assert.equal((await upgraded.session.applyTurnLifecycleEvent(request)).deduplicated, true);
});

test("cold recovery of a migrated session preserves writes committed after cutover", async (t) => {
  const { fixture, partition, sessionDir, request } = await createOfflineCutover(t);
  const legacyHead = await readFile(join(sessionDir, "head.json"));
  await partition.session.renameSession({ ...identity, title: "Committed after cutover" });
  const committed = await partition.session.getSessionBundle(identity);
  assert.equal(committed.session.customTitle, "Committed after cutover");
  assert.deepEqual(await readFile(join(sessionDir, "head.json")), legacyHead);
  await partition.close();

  const root = await readPartitionStorageRoot(sessionDir);
  const head = await readJournalHead(root, { readBytes: 0 });
  const tail = journalPartitionPath(root, head.tail.partition);
  await appendFile(tail, "unpublished suffix");
  assert.ok((await stat(tail)).size > head.tail.offset);

  const { bot: reopened } = await fixture.service.rebuildRuntimeConfig();
  assert.deepEqual(await reopened.session.getSessionBundle(identity), committed);
  assert.equal((await reopened.session.applyTurnLifecycleEvent(request)).deduplicated, true);
  assert.equal((await stat(tail)).size, head.tail.offset);
  assert.deepEqual(await readJournalHead(root, { readBytes: 0 }), head);
});

test("an offline partition backup restores published data including writes captured after cutover", async (t) => {
  const { fixture, partition, sessionDir, request } = await createOfflineCutover(t);
  await partition.session.renameSession({ ...identity, title: "Captured after cutover" });
  const captured = await partition.session.getSessionBundle(identity);
  await partition.close();

  const root = await readPartitionStorageRoot(sessionDir);
  const head = await readJournalHead(root, { readBytes: 0 });
  const tail = journalPartitionPath(root, head.tail.partition);
  const backup = join(fixture.workspaceRoot, "partition-backup");
  await cp(sessionDir, backup, { recursive: true });
  await rename(tail, join(fixture.workspaceRoot, "missing-committed-tail"));

  const { bot: damaged } = await fixture.service.rebuildRuntimeConfig();
  await assert.rejects(damaged.session.getSessionBundle(identity), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await damaged.close();
  await rename(sessionDir, join(fixture.workspaceRoot, "damaged-partition-session"));
  await cp(backup, sessionDir, { recursive: true });

  const { bot: restored } = await fixture.service.rebuildRuntimeConfig();
  assert.deepEqual(await restored.session.getSessionBundle(identity), captured);
  assert.equal(captured.session.customTitle, "Captured after cutover");
  assert.equal((await restored.session.applyTurnLifecycleEvent(request)).deduplicated, true);
  assert.deepEqual(await readJournalHead(root, { readBytes: 0 }), head);
  await restored.session.renameSession({ ...identity, title: "Written after restore" });
  assert.equal(
    (await restored.session.getSessionBundle(identity)).session.customTitle,
    "Written after restore",
  );
});

test("recorded migrated session deletion resumes with a damaged target head", async (t) => {
  const { fixture, partition } = await createOfflineCutover(t);
  const directory = ["runtime", "agent", "session", "child"];
  const sessionDir = join(fixture.workspaceRoot, identity.userId, ...directory);
  const root = await readPartitionStorageRoot(sessionDir);
  const key = sessionBranchDeletionKey(["child"]);
  await partition.sessionRuntime.repositories.sessionRepository.recordSessionBranchDeletion(
    identity.userId,
    key,
    [{ sessionId: "child", directory }],
    [],
  );
  await partition.close();
  await writeFile(join(root, "CURRENT"), "damaged migrated head");
  const { bot: restarted } = await fixture.service.rebuildRuntimeConfig();
  const request = { userId: identity.userId, sessionIds: ["child"] };
  const expected = { ok: true, deletedSessionIds: ["child"] };
  assert.deepEqual(
    await restarted.session.deleteSessionBranch(request, executeEmptySessionCleanup),
    expected,
  );
  await assert.rejects(stat(sessionDir), { code: "ENOENT" });
  const operation =
    await restarted.sessionRuntime.repositories.sessionRepository.readSessionBranchDeletion(
      identity.userId,
      key,
    );
  assert.equal(operation.nextStage, SESSION_DELETION_STAGE.COMPLETE);
  assert.deepEqual(
    await restarted.session.deleteSessionBranch(request, executeEmptySessionCleanup),
    expected,
  );
  assert.equal(
    (await restarted.session.getSessionBundle(identity)).session.customTitle,
    "Before cutover",
  );
});
