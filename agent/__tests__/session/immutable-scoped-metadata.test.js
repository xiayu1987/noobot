/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, rename, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TURN_EVENT,
  TURN_PHASE,
  createSessionPersistenceScope,
  validateSessionProvisionIntent,
  createScopedSessionMetadataRecord,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createTestSessionServices, withTreeContext } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { upgradeImmutableScopedMetadata } from "../../src/session/session-artifact-session/immutable-scoped-metadata-upgrade.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const metadata = { scope: "workflow_node", origin: { nodeId: "n1", executionId: "e1" } };

function request() {
  return {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "t1",
    presentationMessageId: "pm_t1",
    commandId: "c1",
    causationId: "c1",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution("t1", "s1"),
    userMessage: { content: "task", userMessageId: "um_task", messageOrigin: "natural" },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
    initialSessionMetadata: metadata,
  };
}

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-scoped-metadata-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot });
  const repo = runtime.repositories.sessionRepository;
  const scope = await repo.placeSessionScope(
    "u1",
    { sessionId: "s1", parentSessionId: "" },
    repo.treePersistenceContext("u1", "s1"),
  );
  const apply = (input = request(), services = runtime) =>
    services.sessionMessageService.applyTurnLifecycleEvent(withTreeContext(services, input));
  const reader = () =>
    repo.requireSessionReader("u1", "s1", {
      persistenceContext: repo.treePersistenceContext("u1", "s1"),
    });
  return { workspaceRoot, runtime, repo, scope, apply, reader };
}

test("both creation entries reject legacy storage without publishing a new head", async (t) => {
  const f = await fixture(t);
  await mkdir(f.scope.sessionDir, { recursive: true });
  await writeFile(f.scope.sessionFile, "legacy storage must be upgraded offline");
  const persistenceContext = f.repo.treePersistenceContext("u1", "s1");
  await assert.rejects(
    f.repo.ensureSession({
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      persistenceContext,
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_UPGRADE_REQUIRED" },
  );
  await assert.rejects(f.apply(), { code: "SESSION_IMMUTABLE_STORAGE_UPGRADE_REQUIRED" });
  await assert.rejects(readFile(path.join(f.scope.sessionDir, "head.json")), { code: "ENOENT" });
  assert.equal(
    await readFile(f.scope.sessionFile, "utf8"),
    "legacy storage must be upgraded offline",
  );
});

test("detached first acceptance publishes its head, metadata and outbox together and survives restart", async (t) => {
  const f = await fixture(t);
  const persistenceScope = createSessionPersistenceScope({
    scopeId: "agent:s1",
    parentSessionId: "parent",
    allowedRoot: "runtime/plugin-data/workflow/session",
    relativeDir: "runtime/plugin-data/workflow/session/run/node",
  });
  const context = (runtime) =>
    runtime.createSessionPersistenceContext({
      userId: "u1",
      sessionId: "s1",
      persistenceScope,
    });
  const apply = (runtime) =>
    runtime.sessionMessageService.applyTurnLifecycleEvent({
      ...request(),
      parentSessionId: "parent",
      userMessage: { ...request().userMessage, messageOrigin: "internal" },
      sessionCaller: SESSION_CALLER.BOT,
      dialogProcessId: "dialog-child",
      persistenceContext: context(runtime),
    });
  assert.equal((await apply(f.runtime)).sessionCreated, true);
  const restarted = createTestSessionServices({ workspaceRoot: f.workspaceRoot });
  assert.equal((await apply(restarted)).deduplicated, true);
  const reader = await restarted.repositories.sessionRepository.requireSessionReader("u1", "s1", {
    persistenceContext: context(restarted),
  });
  assert.equal(reader.generation, 1);
  assert.deepEqual(await reader.readScopedMetadata(), metadata);
  assert.equal((await reader.exportSession()).messages.length, 1);
  assert.equal((await reader.readLifecycleHead()).sequence, 1);
  assert.equal((await reader.readOutboxPage({ consumerId: "test", limit: 10 })).events.length, 1);
  assert.equal((await reader.readDialog("dialog-child")).userMessageUid, "");
  const reused = await restarted.sessionMessageService.assertReusedUserTurnIdentity({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "dialog-child",
    persistenceContext: context(restarted),
    attachments: [],
  });
  assert.equal(reused.asserted, true);
  assert.equal(reused.userMessage.messageOrigin, "internal");
  assert.equal(
    (await reader.readTurnPage({ turnScopeId: "t1", limit: 1 })).records[0].message.messageUid,
    reused.userMessage.messageUid,
  );
  const scope = await restarted.repositories.sessionRepository.requireSessionScope(
    "u1",
    "s1",
    context(restarted),
  );
  await rm(path.join(scope.sessionDir, "head.json"));
  await assert.rejects(apply(restarted), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("provision metadata protocol rejects invalid input and distinguishes recorded absence", () => {
  for (const value of [null, [], "bad", 1]) {
    assert.equal(
      validateSessionProvisionIntent({ ...request(), initialSessionMetadata: value }).valid,
      false,
    );
  }
  assert.equal(validateSessionProvisionIntent(request()).valid, true);
  assert.equal(
    validateSessionProvisionIntent({ ...request(), createSessionIfAbsent: false }).valid,
    false,
  );
  assert.equal(readScopedSessionMetadataRecord(createScopedSessionMetadataRecord(null)), null);
  assert.throws(() => readScopedSessionMetadataRecord(null), /offline upgrade/);
});

test("provision retry preserves metadata, rejects disagreement and pins old reader generations", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.apply()).sessionCreated, true);
  const old = await f.reader();
  assert.equal(old.generation, 1);
  assert.deepEqual(await old.readScopedMetadata(), metadata);
  assert.equal((await old.readOutboxPage({ consumerId: "test", limit: 10 })).events.length, 1);
  const restarted = createTestSessionServices({ workspaceRoot: f.workspaceRoot });
  assert.equal(
    (
      await f.apply(
        {
          ...request(),
          initialSessionMetadata: {
            origin: { executionId: "e1", nodeId: "n1" },
            scope: "workflow_node",
          },
        },
        restarted,
      )
    ).deduplicated,
    true,
  );
  for (const value of [undefined, { ...metadata, scope: "other" }]) {
    const result = await f.apply({ ...request(), initialSessionMetadata: value }, restarted);
    assert.equal(result.applied, false);
    assert.equal(result.reason, "initial_session_metadata_conflict");
  }
  assert.equal((await f.reader()).generation, old.generation);
  await f.repo.writeSessionMetadata(
    "u1",
    "s1",
    { scope: "updated" },
    {
      persistenceContext: f.repo.treePersistenceContext("u1", "s1"),
    },
  );
  assert.deepEqual(await old.readScopedMetadata(), metadata);
  assert.deepEqual(await (await f.reader()).readScopedMetadata(), { scope: "updated" });
  await assert.rejects(readFile(f.scope.metadataFile), { code: "ENOENT" });
});

for (const published of [false, true]) {
  test(`initial head interruption ${published ? "after" : "before"} publication retries with metadata and acceptance together`, async (t) => {
    const f = await fixture(t);
    const headPath = path.join(f.scope.sessionDir, "head.json");
    setFsAdapter({
      rename: async (from, target) => {
        if (target !== headPath) return rename(from, target);
        if (published) await rename(from, target);
        throw Object.assign(new Error("interrupted initial head"), { code: "EIO" });
      },
    });
    try {
      await assert.rejects(f.apply(), { code: "SESSION_COMMIT_UNCERTAIN" });
    } finally {
      resetFsAdapter();
    }
    if (!published) await assert.rejects(readFile(headPath), { code: "ENOENT" });
    const restarted = createTestSessionServices({ workspaceRoot: f.workspaceRoot });
    const result = await f.apply(request(), restarted);
    assert.equal(published ? result.deduplicated : result.applied, true);
    const current = await f.reader();
    assert.equal(current.generation, 1);
    assert.deepEqual(await current.readScopedMetadata(), metadata);
    assert.equal((await current.exportSession()).messages.length, 1);
    assert.equal((await current.readLifecycleHead()).sequence, 1);
    assert.equal(
      (await current.readOutboxPage({ consumerId: "test", limit: 10 })).events.length,
      1,
    );
  });
}

test("offline metadata upgrade imports once and never revives a retained legacy file", async (t) => {
  const f = await fixture(t);
  await f.apply();
  const store = new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
  const snapshot = await store.snapshot();
  await store.transact({
    expectedGeneration: snapshot.generation,
    operationId: "simulate-pre-metadata-storage",
    input: {},
    prepare: () => ({ changes: [{ collection: "metadata", key: "scoped", value: null }] }),
  });
  await writeFile(f.scope.metadataFile, JSON.stringify(metadata));
  const upgrade = () =>
    upgradeImmutableScopedMetadata({
      storageService,
      sessionDir: f.scope.sessionDir,
      sessionId: "s1",
    });
  await upgrade();
  assert.deepEqual(await (await f.reader()).readScopedMetadata(), metadata);
  const generation = (await f.reader()).generation;
  await writeFile(f.scope.metadataFile, "invalid retained legacy file");
  await upgrade();
  assert.equal((await f.reader()).generation, generation);
  assert.deepEqual(await (await f.reader()).readScopedMetadata(), metadata);
});

test("offline metadata upgrade records absence and ignores subsequently retained legacy data", async (t) => {
  const f = await fixture(t);
  await f.apply();
  const store = new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
  await store.transact({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "remove-scoped-record",
    input: {},
    prepare: () => ({ changes: [{ collection: "metadata", key: "scoped", value: null }] }),
  });
  const upgrade = () =>
    upgradeImmutableScopedMetadata({
      storageService,
      sessionDir: f.scope.sessionDir,
      sessionId: "s1",
    });
  await assert.rejects((await f.reader()).readScopedMetadata(), /offline upgrade/);
  await upgrade();
  assert.equal(await (await f.reader()).readScopedMetadata(), null);
  const generation = (await f.reader()).generation;
  await writeFile(f.scope.metadataFile, JSON.stringify(metadata));
  await upgrade();
  assert.equal((await f.reader()).generation, generation);
  assert.equal(await (await f.reader()).readScopedMetadata(), null);
});
