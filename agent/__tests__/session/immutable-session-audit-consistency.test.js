/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeImmutableSessionHead } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { upgradeImmutableCommitIndex } from "../../src/session/session-artifact-session/immutable-commit-index-upgrade.js";
import { readCommittedIndex } from "./helpers/immutable-record-reads.js";

async function fixture(context) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-audit-consistency-"));
  context.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "audit", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initial",
    changes: [{ collection: "messages", key: "message", value: "original" }],
  });
  const original = await store.snapshot();
  const originalRoot = await store.objects.withSnapshot(original, () =>
    store.index.get(original.root, "messages"),
  );
  await store.commit({
    expectedGeneration: 1,
    operationId: "update",
    changes: [{ collection: "messages", key: "message", value: "updated" }],
  });
  return { store, sessionDir, originalRoot };
}

async function publishFault(store, mutate) {
  const snapshot = await store.snapshot();
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(snapshot);
    const root = await mutate(snapshot);
    await store.objects.publishReachable(
      [root, snapshot.operations, snapshot.commit].filter(Boolean),
    );
    const changed = { ...snapshot, root, ...store.objects.publicationHeadFields() };
    await writeFile(store.headPath, encodeImmutableSessionHead(changed, store.format));
  });
}

for (const corruption of [
  "old value",
  "missing collection",
  "extra key",
  "extra collection",
  "resurrection",
]) {
  test(`audit rejects hash-valid current state with ${corruption}`, async (context) => {
    const { store, sessionDir, originalRoot } = await fixture(context);
    assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
    if (corruption === "resurrection") {
      await store.commit({
        expectedGeneration: 2,
        operationId: "remove",
        changes: [{ collection: "messages", key: "message", remove: true }],
      });
      assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
    }
    await publishFault(store, async (snapshot) => {
      const collection = corruption === "extra collection" ? "metadata" : "messages";
      let root = corruption === "missing collection" ? null : originalRoot;
      if (corruption === "extra key")
        root = await store.index.set(
          await store.index.get(snapshot.root, collection),
          "ghost",
          await store.objects.putValue("uncommitted"),
        );
      return store.index.set(snapshot.root, collection, root);
    });
    const report = await auditImmutableSession({ sessionDir, batchSize: 1 });
    assert.equal(report.ok, false, JSON.stringify(report));
    assert.equal(report.complete, false);
    assert.equal(report.issues[0].code, "SESSION_IMMUTABLE_STORAGE_INVALID");
  });
}

test("audit accepts deletion followed by recreation and identical keys in different collections", async (context) => {
  const { store, sessionDir } = await fixture(context);
  await store.commit({
    expectedGeneration: 2,
    operationId: "remove",
    changes: [{ collection: "messages", key: "message", remove: true }],
  });
  await store.commit({
    expectedGeneration: 3,
    operationId: "recreate",
    changes: [
      { collection: "messages", key: "message", value: "recreated" },
      { collection: "metadata", key: "message", value: "separate" },
    ],
  });
  const report = await auditImmutableSession({ sessionDir, batchSize: 1 });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checkedCommits, 4);
});

test("audit verifies derived command origins after updates, upgrade, deletion and recreation", async (context) => {
  const { store, sessionDir } = await fixture(context);
  for (const [position, remove] of [false, false, true, false].entries()) {
    const generation = (await store.snapshot()).generation;
    await store.commit({
      expectedGeneration: generation,
      operationId: `command-${position}`,
      changes: [
        remove
          ? { collection: "commands", key: "command", remove: true }
          : { collection: "commands", key: "command", value: { revision: position } },
      ],
    });
    const report = await auditImmutableSession({ sessionDir });
    assert.equal(report.ok, true, JSON.stringify(report));
  }
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "upgrade-fixture",
    changes: [{ collection: "metadata", key: "commitIndex", value: { version: 1 } }],
  });
  await upgradeImmutableCommitIndex({ sessionDir, sessionId: store.sessionId });
  const report = await auditImmutableSession({ sessionDir });
  assert.equal(report.ok, true, JSON.stringify(report));
});

for (const corruption of ["missing", "stale", "orphan"]) {
  test(`audit rejects ${corruption} derived command origin`, async (context) => {
    const { store, sessionDir } = await fixture(context);
    await store.commit({
      expectedGeneration: 2,
      operationId: "command",
      changes: [{ collection: "commands", key: "command", value: "receipt" }],
    });
    await publishFault(store, async (snapshot) => {
      const root = await store.index.set(
        await store.index.get(snapshot.root, "commandCommits"),
        corruption === "orphan" ? "ghost" : "command",
        corruption === "missing"
          ? null
          : await store.objects.putValue({ kind: "baseline", generation: 1 }),
      );
      return store.index.set(snapshot.root, "commandCommits", root);
    });
    const report = await auditImmutableSession({ sessionDir });
    assert.equal(report.ok, false, JSON.stringify(report));
    assert.equal(report.issues[0].location.collection, "commandCommits");
  });
}

test("audit reconciles branched indexes without confusing nested and top-level message indexes", async (context) => {
  const { store, sessionDir } = await fixture(context);
  await store.commit({
    expectedGeneration: 2,
    operationId: "many-messages",
    changes: Array.from({ length: 100 }, (_, position) => ({
      collection: "messages",
      key: `message-${position}`,
      value: position,
    })),
  });
  const snapshot = await store.snapshot();
  const root = await readCommittedIndex(store, snapshot.root, "messages");
  await store.transact({
    expectedGeneration: 3,
    operationId: "nested",
    input: null,
    prepare: async () => {
      let order = null;
      for await (const [key] of store.index.entries(root))
        order = await store.index.set(order, key, await store.objects.putValue(key));
      return {
        changes: [
          {
            collection: "turns",
            key: "turn",
            value: { messagesRoot: root, messageOrderRoot: order, messageCount: 101 },
          },
        ],
      };
    },
  });
  const report = await auditImmutableSession({ sessionDir, batchSize: 1 });
  assert.equal(report.ok, true, JSON.stringify(report));
});
