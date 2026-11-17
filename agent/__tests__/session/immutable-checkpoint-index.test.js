/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import {
  immutableCheckpointKey,
  removeImmutableMessageCheckpoints,
  removeImmutableTurnCheckpoints,
} from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { upgradeImmutableCheckpointIndexes } from "../../src/session/session-artifact-session/immutable-checkpoint-index-upgrade.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";

const ts = "2026-01-01T00:00:00.000Z";
const checkpoint = (scope, id, persisted, summarized = persisted) => ({
  userId: "admin",
  sessionId: "s1",
  dialogProcessId: "d1",
  turnScopeId: scope,
  checkpointId: id,
  expectedCheckpointRevision: 0,
  persistedMessageUids: persisted,
  summarizedMessageUids: summarized,
  retainedMessageUids: [],
  messages: [],
});
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "checkpoint-index-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const messages = ["m1", "m2", "m3"].map((uid) => ({
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: uid === "m3" ? "t2" : "t1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
  }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: [
        { dialogProcessId: "d1", dialogOrdinal: 1, turnScopeId: "t1", userMessageUid: "m1" },
      ],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  await commitSessionChanges({
    sessionDir,
    sessionId: "s1",
    expectedGeneration: 1,
    operationId: "seed",
    committedAt: ts,
    changes: {
      summaryCheckpoints: [checkpoint("t1", "a", ["m1", "m2"]), checkpoint("t2", "b", ["m3"])],
    },
  });
  return store;
}
async function mutate(store, operationId, apply) {
  return store.transact({
    expectedGeneration: (await store.snapshot()).generation,
    operationId,
    input: {},
    prepare: async ({ get }) => {
      const plan = new ImmutableSessionChanges(get);
      const result = await apply(plan);
      return { changes: plan.changes(), result };
    },
  });
}

test("message references remove a shared receipt once, retain other receipts and preserve pinned readers", async (t) => {
  const store = await fixture(t);
  const before = await store.snapshot();
  assert.equal((await store.get(before, "messageCheckpoints", "m1")).count, 1);
  const removed = await mutate(store, "remove", (plan) =>
    removeImmutableMessageCheckpoints(store, plan, ["m1", "m2", "m1"]),
  );
  assert.deepEqual(removed.result, { removed: 1 });
  const after = await store.snapshot();
  assert.equal(await store.get(after, "checkpoints", immutableCheckpointKey("t1", "a")), null);
  assert.equal(await store.get(after, "messageCheckpoints", "m2"), null);
  assert.equal(await store.get(after, "turnCheckpoints", "t1"), null);
  assert.equal((await store.get(after, "checkpointHeads", "t1")).checkpointRevision, 1);
  assert.equal((await store.get(after, "turnCheckpoints", "t2")).count, 1);
  assert.equal(
    (await store.get(before, "checkpoints", immutableCheckpointKey("t1", "a"))).checkpointId,
    "a",
  );
  assert.deepEqual(
    (
      await mutate(store, "turn-remove", (plan) =>
        removeImmutableTurnCheckpoints(store, plan, ["t2", "t2"]),
      )
    ).result,
    { removed: 1 },
  );
  assert.equal(await store.get(await store.snapshot(), "checkpointHeads", "t2"), null);
});

test("cross-turn summary dependencies are invalidated by the referenced message", async (t) => {
  const store = await fixture(t);
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "cross",
    committedAt: ts,
    changes: {
      summaryCheckpoints: [
        { ...checkpoint("t2", "cross", [], ["m1"]), expectedCheckpointRevision: 1 },
      ],
    },
  });
  assert.deepEqual(
    (
      await mutate(store, "remove", (plan) =>
        removeImmutableMessageCheckpoints(store, plan, ["m1", "m2"]),
      )
    ).result,
    { removed: 2 },
  );
  const snapshot = await store.snapshot();
  assert.equal((await store.get(snapshot, "turnCheckpoints", "t2")).count, 1);
  assert.equal(
    (await store.get(snapshot, "checkpoints", immutableCheckpointKey("t2", "b"))).checkpointId,
    "b",
  );
});

test("cold removal never reads unrelated receipt bodies", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const records = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "checkpoints");
    const reference = await store.index.get(root, immutableCheckpointKey("t2", "b"));
    return collectValueRecords(store, reference);
  });
  setFsAdapter(await forbidRecordReads(store, records));
  t.after(resetFsAdapter);
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  assert.deepEqual(
    (
      await mutate(reopened, "remove", (plan) =>
        removeImmutableMessageCheckpoints(reopened, plan, ["m1"]),
      )
    ).result,
    { removed: 1 },
  );
});

test("failed head publication preserves all memberships and permits retry", async (t) => {
  const store = await fixture(t);
  const before = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(
      mutate(store, "remove", (plan) => removeImmutableTurnCheckpoints(store, plan, ["t1"])),
      { code: "SESSION_COMMIT_UNCERTAIN" },
    );
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal((await store.get(before, "messageCheckpoints", "m1")).count, 1);
  assert.deepEqual(
    (await mutate(store, "remove", (plan) => removeImmutableTurnCheckpoints(store, plan, ["t1"])))
      .result,
    { removed: 1 },
  );
});

test("missing indexes require offline rebuild and upgrade is idempotent", async (t) => {
  const store = await fixture(t);
  await mutate(store, "legacy", (plan) => {
    plan.remove("metadata", "checkpointIndex");
    for (const uid of ["m1", "m2", "m3"]) plan.remove("messageCheckpoints", uid);
    for (const scope of ["t1", "t2"]) plan.remove("turnCheckpoints", scope);
  });
  await assert.rejects(
    mutate(store, "remove", (plan) => removeImmutableMessageCheckpoints(store, plan, ["m1"])),
    { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" },
  );
  const options = { sessionDir: store.sessionDir, sessionId: "s1" };
  assert.equal((await upgradeImmutableCheckpointIndexes(options)).result.upgraded, true);
  const after = await store.snapshot();
  assert.equal((await store.get(after, "messageCheckpoints", "m2")).count, 1);
  assert.equal((await upgradeImmutableCheckpointIndexes(options)).result.upgraded, false);
  assert.deepEqual(await store.snapshot(), after);
  assert.deepEqual(
    (
      await mutate(store, "remove", (plan) =>
        removeImmutableMessageCheckpoints(store, plan, ["m1", "m2"]),
      )
    ).result,
    { removed: 1 },
  );
});

test("corrupt membership aborts without publishing partial removals", async (t) => {
  const store = await fixture(t);
  await mutate(store, "corrupt", async (plan) => {
    plan.set("messageCheckpoints", "m2", {
      ...(await plan.get("messageCheckpoints", "m2")),
      count: 2,
    });
  });
  const before = await store.snapshot();
  await assert.rejects(
    mutate(store, "remove", (plan) => removeImmutableMessageCheckpoints(store, plan, ["m2"])),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await store.snapshot(), before);
});

test("offline upgrade rejects unknown versions and orphan or missing order entries", async (t) => {
  for (const corruption of ["version", "orphan", "missing"]) {
    const store = await fixture(t);
    await mutate(store, "corrupt", (plan) => {
      plan.remove("metadata", "checkpointIndex");
      if (corruption === "version") plan.set("metadata", "checkpointIndex", { version: 2 });
      else if (corruption === "orphan")
        plan.set("checkpointOrder", immutableCheckpointKey("t1", immutableOrderKey(2)), "missing");
      else plan.remove("checkpointOrder", immutableCheckpointKey("t1", immutableOrderKey(1)));
    });
    const before = await store.snapshot();
    await assert.rejects(
      upgradeImmutableCheckpointIndexes({ sessionDir: store.sessionDir, sessionId: "s1" }),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    assert.deepEqual(await store.snapshot(), before);
  }
});
