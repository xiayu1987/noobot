/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import {
  createTurnMaterializer,
  readVerifiedCheckpointIdentity,
  readVerifiedSnapshot,
} from "../../src/session/session-artifact-session/turn-materializer.js";
import {
  buildStoredCheckpointReceipts,
  readCheckpointReceiptProjection,
} from "../../src/session/session-artifact-session/checkpoint-receipts.js";
import {
  createVerifiedSnapshotCache,
  readFileIdentity,
  verifiedSnapshotCache,
} from "../../src/session/session-artifact-session/verified-snapshot-cache.js";
import { replaceJournalRecords } from "../../src/session/session-artifact-session/turn-journal-store.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

const TS = "2026-01-01T00:00:00.000Z";

function message(uid, role, content) {
  return role === "user"
    ? { role, messageOrigin: "natural", content, turnScopeId: "active", messageUid: uid, ts: TS }
    : {
        role,
        presentationMessageId: "pm_active",
        content,
        turnScopeId: "active",
        messageUid: uid,
        ts: TS,
      };
}

function receipt(revision, persisted, summarized) {
  return {
    checkpointId: `checkpoint-${revision}`,
    checkpointRevision: revision,
    requestHash: "sha256:fixture",
    persistedMessageUids: persisted,
    summarizedMessageUids: summarized,
    retainedMessageUids: [],
    markedCount: summarized.length,
    committedAt: TS,
  };
}

function payloadOf(messages, receipts) {
  return {
    ...createTestSessionRequiredFields(),
    sessionId: "materializer",
    aggregateVersion: 0,
    messages,
    turnSummaryCheckpoints: {
      active: {
        dialogProcessId: "dialog-active",
        turnScopeId: "active",
        checkpointRevision: receipts.length,
        receipts,
      },
    },
  };
}

async function manifestTurn(root) {
  const files = buildSessionArtifactFileMap(root);
  return JSON.parse(await readFile(files.session, "utf8")).turnOrder[0];
}

const uids = (messages) => messages.map((item) => item.messageUid);

async function seedCheckpointedTurn(root, stable = true) {
  const base = [message("m1", "user", "question"), message("m2", "assistant", "answer")];
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: payloadOf(base, [receipt(1, ["m1", "m2"], ["m1"])]),
  });
  if (stable) await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
  return base;
}

test("verified checkpoint chain and journal prefix are reused across reads", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const first = await materializer.materialize({
      storageService,
      sessionDir: root,
      item: await manifestTurn(root),
    });
    assert.deepEqual(uids(first), ["m1", "m2"]);
    assert.equal(Object.isFrozen(first[0]), true);
    const second = await materializer.materialize({
      storageService,
      sessionDir: root,
      item: await manifestTurn(root),
    });
    assert.equal(second[0], first[0], "checkpoint message must come from the verified cache");

    const grown = [...base, message("m3", "assistant", "tail")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(grown, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    const item = await manifestTurn(root);
    assert.ok(item.committedBytes > 0, "tail message must live in the turn journal");
    const third = await materializer.materialize({ storageService, sessionDir: root, item });
    assert.deepEqual(uids(third), ["m1", "m2", "m3"]);
    assert.equal(third[0], first[0]);
    assert.equal(Object.isFrozen(third[2]), true, "journal tail messages are frozen as well");
    const fourth = await materializer.materialize({ storageService, sessionDir: root, item });
    assert.equal(fourth[2], third[2], "journal prefix must be reused, not re-parsed");
    assert.throws(() => {
      fourth[2].content = "mutated";
    }, TypeError);
  }));

test("journal replacement changes the identity and forces a full journal read", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const grown = [...base, message("m3", "assistant", "tail")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(grown, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const item = await manifestTurn(root);
    const before = await materializer.materialize({ storageService, sessionDir: root, item });
    const journal = path.join(root, item.file);
    const records = (await readFile(journal, "utf8")).trim().split("\n").map(JSON.parse);
    const committedBytes = await replaceJournalRecords(journal, records);
    assert.equal(committedBytes, item.committedBytes);
    const after = await materializer.materialize({
      storageService,
      sessionDir: root,
      item: { ...item, committedBytes },
    });
    assert.deepEqual(uids(after), ["m1", "m2", "m3"]);
    assert.notEqual(after[2], before[2], "a replaced journal must be parsed again");
    assert.equal(after[0], before[0], "the unchanged checkpoint chain stays verified");
  }));

test("checkpoint chain is re-verified when a link changes on disk or in the manifest", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const item = await manifestTurn(root);
    await materializer.materialize({ storageService, sessionDir: root, item });
    const snapshotFile = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(snapshotFile, "utf8");
    await writeFile(`${snapshotFile}.tmp`, original.replace('"answer"', '"ANSWER"'), "utf8");
    await rename(`${snapshotFile}.tmp`, snapshotFile);
    await assert.rejects(materializer.materialize({ storageService, sessionDir: root, item }), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await writeFile(`${snapshotFile}.tmp`, original, "utf8");
    await rename(`${snapshotFile}.tmp`, snapshotFile);
    assert.deepEqual(
      uids(await materializer.materialize({ storageService, sessionDir: root, item })),
      ["m1", "m2"],
    );
    await assert.rejects(
      materializer.materialize({
        storageService,
        sessionDir: root,
        item: {
          ...item,
          summarySnapshots: [{ ...item.summarySnapshots[0], contentHash: "sha256:other" }],
        },
      }),
      { code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH" },
    );
    const shortened = await materializer.materialize({
      storageService,
      sessionDir: root,
      item: { ...item, summarySnapshots: [], messageOrder: [] },
    });
    assert.deepEqual(uids(shortened), [], "a shortened chain must not reuse cached state");
  }));

test("byte budget evicts least recently materialized turns", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const item = await manifestTurn(root);
    const unbounded = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    await unbounded.materialize({ storageService, sessionDir: root, item });
    const entryBytes = unbounded.cachedBytes();
    assert.ok(entryBytes > 0);
    const tight = createTurnMaterializer({ byteBudget: entryBytes - 1 });
    const first = await tight.materialize({ storageService, sessionDir: root, item });
    assert.equal(tight.cachedBytes(), 0, "an entry above the budget is not retained");
    const second = await tight.materialize({ storageService, sessionDir: root, item });
    assert.equal(
      second[0],
      first[0],
      "verified snapshots remain reusable after turn cache eviction",
    );
    assert.equal(tight.cachedBytes(), 0);
    assert.throws(() => createTurnMaterializer({ byteBudget: -1 }), TypeError);
  }));

test("snapshot cache tiers enforce independent byte budgets, LRU order and immutability", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 2, identityByteBudget: 1024 });
  const identity = { key: "identity", bytes: 1, reusable: true };
  const payload = { checkpointId: "c1", records: [{ message: { content: "original" } }] };
  cache.retain("a", "hash", identity, payload);
  payload.records[0].message.content = "mutated";
  assert.equal(cache.payload("a", "hash", identity).records[0].message.content, "original");
  cache.retain("b", "hash", identity, payload);
  cache.payload("a", "hash", identity);
  cache.retain("c", "hash", identity, payload);
  assert.equal(cache.payload("b", "hash", identity), null);
  assert.equal(cache.cachedBytes().payload, 2);
  assert.equal(
    cache.checkpoint("b", "hash", identity).checkpointId,
    "c1",
    "payload eviction keeps the verified checkpoint identity",
  );
  assert.equal(Object.hasOwn(cache.checkpoint("b", "hash", identity), "records"), false);
  assert.throws(() => {
    cache.payload("a", "hash", identity).records.push({});
  }, TypeError);
  assert.equal(cache.payload("a", "hash", { ...identity, key: "changed" }), null);
  assert.equal(
    cache.checkpoint("a", "hash", identity),
    null,
    "identity mismatch forgets both tiers",
  );
  cache.retain("oversize", "hash", { key: "large", bytes: 3, reusable: true }, payload);
  assert.equal(cache.payload("oversize", "hash", { key: "large", bytes: 3, reusable: true }), null);
  assert.throws(
    () => createVerifiedSnapshotCache({ payloadByteBudget: -1, identityByteBudget: 1 }),
    TypeError,
  );
  assert.throws(
    () => createVerifiedSnapshotCache({ payloadByteBudget: 1, identityByteBudget: -1 }),
    TypeError,
  );
});

test("snapshot cache rejects in-place edits, invalid chain indexes and deleted files", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root, false);
    const item = await manifestTurn(root);
    const index = item.summarySnapshots[0];
    const file = path.join(root, index.file);
    const options = { storageService, sessionDir: root, index, previousCheckpointHash: "" };
    await readVerifiedSnapshot(options);
    await assert.rejects(readVerifiedSnapshot({ ...options, previousCheckpointHash: "wrong" }), {
      code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
    });
    await assert.rejects(
      readVerifiedSnapshot({ ...options, index: { ...index, checkpointRevision: 99 } }),
      {
        code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
      },
    );
    const original = await readFile(file, "utf8");
    const changed = original.replace('"answer"', '"ANSWER"');
    assert.notEqual(changed, original);
    await writeFile(file, changed, "utf8");
    await assert.rejects(readVerifiedSnapshot(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await writeFile(file, original, "utf8");
    await readVerifiedSnapshot(options);
    await rm(file);
    await assert.rejects(readVerifiedSnapshot(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
    });
  }));

test("snapshots verified during the identity guard require stable verification before reuse", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 100, identityByteBudget: 100 });
  const recent = { key: "same-stat-identity", bytes: 1, reusable: false };
  const stable = { ...recent, reusable: true };
  const payload = { records: [] };
  cache.retain("snapshot", "hash", recent, payload);
  assert.equal(cache.payload("snapshot", "hash", recent), null);
  assert.equal(cache.checkpoint("snapshot", "hash", stable), null);
  cache.retain("snapshot", "hash", stable, payload);
  assert.deepEqual(cache.payload("snapshot", "hash", stable), payload);
});

test("receipt read and write projections reuse verified checkpoint identities as history grows", async (t) =>
  withTemp(async (root) => {
    const base = [message("m1", "user", "question"), message("m2", "assistant", "x".repeat(65536))];
    let reads = 0;
    const countedStorage = Object.create(storageService);
    countedStorage.readJson = async (file) => {
      reads += 1;
      return storageService.readJson(file);
    };
    for (const count of [1, 8, 32]) {
      await writeSessionArtifact({
        sessionDir: root,
        sessionPayload: payloadOf(
          base,
          Array.from({ length: count }, (_, i) => receipt(i + 1, ["m1", "m2"], ["m1"])),
        ),
      });
      const files = buildSessionArtifactFileMap(root);
      const session = JSON.parse(await readFile(files.session, "utf8"));
      await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
      const options = { storageService: countedStorage, sessionDir: root, session };
      await readCheckpointReceiptProjection(options);
      reads = 0;
      const started = performance.now();
      await readCheckpointReceiptProjection(options);
      await buildStoredCheckpointReceipts(options);
      assert.equal(reads, 0, `${count} cached snapshots must incur no JSON reads or hashing`);
      t.diagnostic(
        `${count} snapshots: receipt read + write ${(performance.now() - started).toFixed(2)}ms, snapshot reads=${reads}`,
      );
    }
  }));

test("payload eviction under sequential scans keeps checkpoint identities resident", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 3, identityByteBudget: 1024 });
  const files = ["a", "b", "c", "d", "e"];
  const identity = { key: "stable", bytes: 1, reusable: true };
  for (const file of files)
    cache.retain(file, "hash", identity, { checkpointId: file, records: [] });
  for (let scan = 0; scan < 3; scan += 1) {
    for (const file of files)
      assert.equal(cache.checkpoint(file, "hash", identity).checkpointId, file);
  }
  assert.equal(cache.cachedBytes().payload, 3);
});

test("pruned snapshots are forgotten from both verified cache tiers", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const [index] = (await manifestTurn(root)).summarySnapshots;
    const file = path.resolve(root, index.file);
    const identity = await readFileIdentity(file);
    const options = { storageService, sessionDir: root, index, previousCheckpointHash: "" };
    await readVerifiedCheckpointIdentity(options);
    await readVerifiedSnapshot(options);
    assert.ok(verifiedSnapshotCache.checkpoint(file, index.contentHash, identity));
    assert.ok(verifiedSnapshotCache.payload(file, index.contentHash, identity));
    const other = (uid, role) => ({ ...message(uid, role, "next"), turnScopeId: "other" });
    const { turnSummaryCheckpoints: _omitted, ...replacement } = payloadOf(
      [other("n1", "user"), other("n2", "assistant")],
      [],
    );
    await writeSessionArtifact({ sessionDir: root, sessionPayload: replacement });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(verifiedSnapshotCache.checkpoint(file, index.contentHash, identity), null);
    assert.equal(verifiedSnapshotCache.payload(file, index.contentHash, identity), null);
  }));

test("session reads expose frozen materialized messages without breaking writers", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const restored = await readSessionArtifact({ sessionDir: root, storageService });
    assert.deepEqual(uids(restored.messages), ["m1", "m2"]);
    const next = [...restored.messages, message("m3", "assistant", "after read")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(next, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    assert.deepEqual(
      uids((await readSessionArtifact({ sessionDir: root, storageService })).messages),
      [...uids(base), "m3"],
    );
  }));
