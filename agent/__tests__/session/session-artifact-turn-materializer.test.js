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
import { createSessionStorageMessageIndex } from "@noobot/session-protocol";
import {
  observeSessionStorageWork,
  withSessionStorageTransaction,
} from "../../src/session/session-artifact-session/storage-transaction.js";

import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
  readSessionArtifactForRepair,
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
  createByteLru,
  createVerifiedSnapshotCache,
  getVerifiedSnapshotCache,
  readFileIdentity,
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

for (const reader of ["payload", "receipts"])
  test(`checkpoint ${reader} reader preserves simultaneous missing snapshot failures`, async () =>
    withTemp(async (root) => {
      await seedCheckpointedTurn(root, false);
      const files = buildSessionArtifactFileMap(root);
      const session = JSON.parse(await readFile(files.session, "utf8"));
      const item = session.turnOrder[0];
      const index = item.summarySnapshots[0];
      item.summarySnapshots = ["missing-one.json", "missing-two.json"].map((name) => ({
        ...index,
        file: path.posix.join(path.posix.dirname(index.file), name),
      }));
      await assert.rejects(
        reader === "payload"
          ? createTurnMaterializer({
              payloadByteBudget: 1024 * 1024,
              identityByteBudget: 16384,
            }).materialize({
              storageService,
              sessionDir: root,
              item,
            })
          : readCheckpointReceiptProjection({ storageService, sessionDir: root, session }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.errors.length, 2);
          assert.equal(error.cause, error.errors[0]);
          for (const failure of error.errors)
            assert.equal(failure.code, "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH");
          return true;
        },
      );
    }));

async function seedCheckpointedTurn(root, stable = true) {
  const base = [message("m1", "user", "question"), message("m2", "assistant", "answer")];
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: payloadOf(base, [receipt(1, ["m1", "m2"], ["m1"])]),
  });
  if (stable) await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
  return base;
}

test("transaction shares cold snapshot verification between identity and payload readers", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root, false);
    const index = (await manifestTurn(root)).summarySnapshots[0];
    const file = path.join(root, index.file);
    const original = await readFile(file, "utf8");
    getVerifiedSnapshotCache().forget(file);
    const options = { storageService, sessionDir: root, index, previousCheckpointHash: "" };
    const { work } = await observeSessionStorageWork(() =>
      withSessionStorageTransaction(root, async () => {
        const [identity, snapshot] = await Promise.all([
          readVerifiedCheckpointIdentity(options),
          readVerifiedSnapshot(options),
        ]);
        assert.equal(identity.checkpointId, snapshot.payload.checkpointId);
        assert.deepEqual(identity.persistedMessageUids, snapshot.payload.persistedMessageUids);
        await assert.rejects(
          readVerifiedSnapshot({ ...options, previousCheckpointHash: "sha256:wrong" }),
          { code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH" },
        );
      }),
    );
    assert.equal(work.snapshotReadBytes, Buffer.byteLength(original));
    await writeFile(file, original.replace('"answer"', '"ANSWER"'));
    await assert.rejects(readVerifiedCheckpointIdentity(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
  }));

test("schema23 repair reuses canonical checkpoint projections while preserving source version", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const expected = await readSessionArtifact({ storageService, sessionDir: root });
    const file = buildSessionArtifactFileMap(root).session;
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.schemaVersion = 23;
    await writeFile(file, JSON.stringify(manifest));
    const { result: source, work } = await observeSessionStorageWork(() =>
      readSessionArtifactForRepair({ storageService, sessionDir: root }),
    );
    assert.equal(source.schemaVersion, 23);
    assert.deepEqual(source.messages, expected.messages);
    assert.deepEqual(source.turnSummaryCheckpoints, expected.turnSummaryCheckpoints);
    assert.equal(work.snapshotReadBytes || 0, 0);
    assert.equal(work.materializedMessages || 0, 0);
  }));

test("verified checkpoint chain and journal prefix are reused across reads", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
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
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
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
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
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
      item: { ...item, summarySnapshots: [], ...createSessionStorageMessageIndex([]) },
    });
    assert.deepEqual(uids(shortened), [], "a shortened chain must not reuse cached state");
  }));

test("reverified identical checkpoint replacement preserves materialization and detects removal", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root, false);
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
    const item = await manifestTurn(root);
    const options = { storageService, sessionDir: root, item };
    const first = await materializer.materializeEntries(options);
    assert.equal(await materializer.materializeEntries(options), first);
    const snapshotFile = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(snapshotFile, "utf8");
    await writeFile(`${snapshotFile}.tmp`, original, "utf8");
    await rename(`${snapshotFile}.tmp`, snapshotFile);
    assert.equal(await materializer.materializeEntries(options), first);
    const cold = createTurnMaterializer({ payloadByteBudget: 0, identityByteBudget: 0 });
    assert.deepEqual(await cold.materializeEntries(options), first);
    await rm(snapshotFile);
    await assert.rejects(materializer.materializeEntries(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
    });
  }));

test("byte budget evicts least recently materialized turns", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const item = await manifestTurn(root);
    const unbounded = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 0,
    });
    await unbounded.materialize({ storageService, sessionDir: root, item });
    const entryBytes = unbounded.cachedBytes();
    assert.ok(entryBytes > 0);
    const tight = createTurnMaterializer({
      payloadByteBudget: entryBytes - 1,
      identityByteBudget: 0,
    });
    const first = await tight.materialize({ storageService, sessionDir: root, item });
    assert.equal(tight.cachedBytes(), 0, "an entry above the budget is not retained");
    const second = await tight.materialize({ storageService, sessionDir: root, item });
    assert.equal(
      second[0],
      first[0],
      "verified snapshots remain reusable after turn cache eviction",
    );
    assert.equal(tight.cachedBytes(), 0);
    for (const budgets of [
      { payloadByteBudget: -1, identityByteBudget: 0 },
      { payloadByteBudget: 0, identityByteBudget: -1 },
      { payloadByteBudget: 0 },
      { identityByteBudget: 0 },
    ])
      assert.throws(() => createTurnMaterializer(budgets), TypeError);
  }));

test("snapshot cache tiers enforce independent byte budgets, LRU order and immutability", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 2, identityByteBudget: 1024 });
  const identity = { key: "identity", bytes: 1, reusable: true };
  const payload = {
    checkpointId: "c1",
    persistedMessageUids: [],
    summarizedMessageUids: [],
    records: [{ message: { content: "original" } }],
  };
  cache.retain("a", "hash", identity, payload);
  assert.throws(() => {
    payload.records[0].message.content = "mutated";
  }, TypeError);
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
    cache.checkpoint("a", "hash", { ...identity, key: "changed" }),
    null,
    "identity mismatch requires content verification in both tiers",
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

test("frequently read projections survive scans within the shared byte budget", () => {
  const cache = createByteLru(10);
  const active = { bytes: 4, value: "active" };
  cache.set("active", active);
  assert.equal(cache.get("active"), active);
  for (let index = 0; index < 20; index += 1) {
    cache.set(`history-${index}`, { bytes: 5 });
    assert.ok(cache.bytes() <= 10);
  }
  assert.equal(cache.get("active"), active);
  cache.set("active", { bytes: 3, value: "updated" });
  cache.set("next-history", { bytes: 7 });
  assert.equal(cache.get("active").value, "updated");
  assert.equal(cache.bytes(), 10);
  cache.remove("active");
  assert.equal(cache.bytes(), 7);
});

test("snapshots verified during the identity guard require content verification before reuse", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 100, identityByteBudget: 100 });
  const recent = { key: "same-stat-identity", bytes: 1, reusable: false };
  const stable = { ...recent, reusable: true };
  const payload = { persistedMessageUids: [], summarizedMessageUids: [], records: [] };
  cache.retain("snapshot", "hash", recent, payload);
  assert.equal(cache.payload("snapshot", "hash", recent), null);
  assert.equal(cache.checkpoint("snapshot", "hash", stable), null);
  assert.equal(cache.revalidate("payload", "snapshot", "another-hash", stable), null);
  assert.equal(cache.revalidate("payload", "snapshot", "hash", stable), payload);
  assert.deepEqual(cache.payload("snapshot", "hash", stable), payload);
});

test("recent snapshots reread and hash content while reusing verified projections", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root, false);
    const [index] = (await manifestTurn(root)).summarySnapshots;
    const countedStorage = Object.create(storageService);
    let reads = 0;
    countedStorage.readJson = async (file) => {
      reads += 1;
      return storageService.readJson(file);
    };
    const options = {
      storageService: countedStorage,
      sessionDir: root,
      index,
      previousCheckpointHash: "",
    };
    const first = await readVerifiedSnapshot(options);
    const second = await readVerifiedSnapshot(options);
    assert.ok(reads >= 2);
    assert.equal(second.payload, first.payload);
    const file = path.resolve(root, index.file);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace('"answer"', '"ANSWER"'), "utf8");
    await assert.rejects(readVerifiedSnapshot(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await writeFile(file, original, "utf8");
    assert.equal((await readVerifiedSnapshot(options)).payload, first.payload);
  }));

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
    cache.retain(file, "hash", identity, {
      checkpointId: file,
      persistedMessageUids: [],
      summarizedMessageUids: [],
      records: [],
    });
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
    assert.ok(getVerifiedSnapshotCache().checkpoint(file, index.contentHash, identity));
    assert.ok(getVerifiedSnapshotCache().payload(file, index.contentHash, identity));
    const other = (uid, role) => ({ ...message(uid, role, "next"), turnScopeId: "other" });
    const { turnSummaryCheckpoints: _omitted, ...replacement } = payloadOf(
      [other("n1", "user"), other("n2", "assistant")],
      [],
    );
    await writeSessionArtifact({ sessionDir: root, sessionPayload: replacement });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(getVerifiedSnapshotCache().checkpoint(file, index.contentHash, identity), null);
    assert.equal(getVerifiedSnapshotCache().payload(file, index.contentHash, identity), null);
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

for (const payloadByteBudget of [8192, 131072])
  test(`ownership projection survives body scans with payload budget ${payloadByteBudget}`, async () =>
    withTemp(async (root) => {
      const messages = Array.from({ length: 4 }, (_, index) => ({
        ...message(`large-${index}`, "user", "x".repeat(65536)),
        turnScopeId: `large-${index}`,
      }));
      await writeSessionArtifact({
        sessionDir: root,
        sessionPayload: {
          ...createTestSessionRequiredFields(),
          sessionId: "large",
          aggregateVersion: 0,
          messages,
        },
      });
      await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
      const manifest = JSON.parse(
        await readFile(buildSessionArtifactFileMap(root).session, "utf8"),
      );
      const materializer = createTurnMaterializer({
        payloadByteBudget,
        identityByteBudget: 8192,
      });
      const options = manifest.turnOrder.map((item) => ({
        storageService,
        sessionDir: root,
        item,
      }));
      const first = [];
      for (const option of options) first.push(await materializer.materializeMessageUids(option));
      const body = await materializer.materializeEntries(options[0]);
      for (const option of options) await materializer.materializeEntries(option);
      assert.notEqual(await materializer.materializeEntries(options[0]), body);
      for (const [index, option] of options.entries()) {
        assert.deepEqual(first[index], [messages[index].messageUid]);
        assert.equal(await materializer.materializeMessageUids(option), first[index]);
      }
      assert.ok(materializer.cachedBytes() <= payloadByteBudget + 8192);
      const option = options[0];
      await assert.rejects(
        materializer.materializeMessageUids({
          ...option,
          item: { ...option.item, messageRevision: "sha256:wrong" },
        }),
        {
          code: "SESSION_TURN_JOURNAL_RECORD_INVALID",
        },
      );
      await writeFile(path.join(root, option.item.file), "corrupt journal");
      await assert.rejects(materializer.materializeMessageUids(option));
    }));

test("ownership projection preserves a resident journal projection for readers", async () =>
  withTemp(async (root) => {
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf([message("journal-only", "user", "body")], []),
    });
    await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
    const options = { storageService, sessionDir: root, item: await manifestTurn(root) };
    const before = await materializer.materializeEntries(options);
    assert.deepEqual(await materializer.materializeMessageUids(options), ["journal-only"]);
    assert.equal(await materializer.materializeEntries(options), before);
  }));

test("ownership projection revalidates snapshot changes and does not cache during the guard", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root, false);
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
    const item = await manifestTurn(root);
    const options = { storageService, sessionDir: root, item };
    const first = await materializer.materializeMessageUids(options);
    assert.notEqual(await materializer.materializeMessageUids(options), first);
    await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
    const stable = await materializer.materializeMessageUids(options);
    assert.equal(await materializer.materializeMessageUids(options), stable);
    const file = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace('"answer"', '"ANSWER"'));
    await assert.rejects(materializer.materializeMessageUids(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await rm(file);
    await assert.rejects(materializer.materializeMessageUids(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
    });
  }));

test("materializer budget counts retained messages instead of superseded snapshot records", async () =>
  withTemp(async (root) => {
    const receipts = [];
    for (let revision = 1; revision <= 4; revision += 1) {
      receipts.push(receipt(revision, ["m1", "m2"], ["m2"]));
      await writeSessionArtifact({
        sessionDir: root,
        sessionPayload: payloadOf(
          [
            message("m1", "user", "question"),
            { ...message("m2", "assistant", `${revision}${"x".repeat(65536)}`), summarized: true },
          ],
          receipts,
        ),
      });
    }
    await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
    const item = await manifestTurn(root);
    const byteBudget = 128 * 1024;
    const files = await Promise.all(
      item.summarySnapshots.map((index) => readFile(path.join(root, index.file))),
    );
    assert.ok(files.reduce((bytes, file) => bytes + file.length, 0) > byteBudget);
    const materializer = createTurnMaterializer({
      payloadByteBudget: byteBudget,
      identityByteBudget: 0,
    });
    const options = { storageService, sessionDir: root, item };
    const first = await materializer.materializeEntries(options);
    assert.ok(materializer.cachedBytes() > 65536);
    assert.ok(materializer.cachedBytes() <= byteBudget);
    assert.equal(await materializer.materializeEntries(options), first);
    const file = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("question", "QUESTION"));
    await assert.rejects(materializer.materializeEntries(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
  }));

test("checkpoint journal rotation replaces the turn projection without retaining old generations", async () =>
  withTemp(async (root) => {
    const materializer = createTurnMaterializer({
      payloadByteBudget: 1024 * 1024,
      identityByteBudget: 16384,
    });
    const receipts = [];
    const files = new Set();
    let initialBytes;
    for (let revision = 1; revision <= 4; revision += 1) {
      receipts.push(receipt(revision, ["m1", "m2"], ["m2"]));
      await writeSessionArtifact({
        sessionDir: root,
        sessionPayload: payloadOf(
          [message("m1", "user", "question"), message("m2", "assistant", "x".repeat(65536))],
          receipts,
        ),
      });
      await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
      const item = await manifestTurn(root);
      files.add(item.file);
      const options = { storageService, sessionDir: root, item };
      const entries = await materializer.materializeEntries(options);
      const cold = createTurnMaterializer({ payloadByteBudget: 0, identityByteBudget: 0 });
      assert.deepEqual(entries, await cold.materializeEntries(options));
      assert.equal(await materializer.materializeEntries(options), entries);
      initialBytes ??= materializer.cachedBytes();
      assert.ok(materializer.cachedBytes() < initialBytes * 2);
    }
    assert.equal(files.size, 4);
    const item = await manifestTurn(root);
    const file = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("question", "QUESTION"));
    await assert.rejects(
      materializer.materializeEntries({ storageService, sessionDir: root, item }),
      {
        code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
      },
    );
  }));

test("committed projection publishes only after commit and matches cold reconstruction accounting", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const options = { storageService, sessionDir: root, item: await manifestTurn(root) };
    const budgets = { payloadByteBudget: 1024 * 1024, identityByteBudget: 0 };
    const cold = createTurnMaterializer(budgets);
    const entries = await cold.materializeEntries(options);
    const writer = createTurnMaterializer(budgets);
    const publish = await writer.prepareCommittedEntries({
      ...options,
      materializedEntries: entries,
      checkpointed: true,
    });
    assert.equal(
      writer.cachedBytes(),
      0,
      "preparing a failed commit must not publish a projection",
    );
    publish();
    assert.equal(await writer.materializeEntries(options), entries);
    assert.equal(
      writer.cachedBytes(),
      cold.cachedBytes(),
      "writer and recovery must charge the same retained state",
    );
    const warm = await observeSessionStorageWork(async () => {
      const publishAgain = await writer.prepareCommittedEntries({
        ...options,
        materializedEntries: entries,
        checkpointed: true,
      });
      publishAgain();
      assert.equal(await writer.materializeEntries(options), entries);
    });
    assert.equal(warm.work.projectionRebuiltMessages || 0, 0);
    assert.equal(warm.work.projectionMetadataMessages || 0, 0);
    assert.equal(writer.cachedBytes(), cold.cachedBytes());
    const snapshot = path.join(root, options.item.summarySnapshots[0].file);
    const raw = await readFile(snapshot, "utf8");
    await writeFile(snapshot, raw.replace('"answer"', '"ANSWER"'));
    await assert.rejects(writer.materializeEntries(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
  }));
