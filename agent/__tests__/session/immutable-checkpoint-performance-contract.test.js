/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { collectValueRecords, committedPhysicalRecord } from "./helpers/immutable-record-reads.js";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { evaluatePerformanceCollection } from "../../../scripts/e2e-docker/performance-gate.mjs";
import { performanceReportFixture } from "../../../scripts/e2e-docker/__tests__/performance-fixture.mjs";

const ts = "2026-01-01T00:00:00.000Z";
function message(uid, content = uid, scope = uid) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "performance-contract",
    parentSessionId: "",
    dialogProcessId: `dialog-${scope}`,
    parentDialogProcessId: "",
    turnScopeId: `turn-${scope}`,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content,
    attachments: [],
    transferEnvelopes: [],
    ts,
  };
}

async function fixture(t, historyCount, sameTurn = false) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "checkpoint-performance-contract-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const messages = Array.from({ length: historyCount }, (_, index) =>
    message(
      `history-${index}`,
      `history-${index}:` + "旧🙂".repeat(20000),
      sameTurn ? "current" : `history-${index}`,
    ),
  );
  const dialogs = [...new Map(messages.map((entry) => [entry.dialogProcessId, entry])).values()];
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "performance-contract",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: dialogs.map((entry, index) => ({
        dialogProcessId: entry.dialogProcessId,
        turnScopeId: entry.turnScopeId,
        userMessageUid: entry.messageUid,
        dialogOrdinal: index + 1,
      })),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return ImmutableSessionStore.open({ sessionDir });
}

function request(store, generation, operationId, content) {
  return {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: generation,
    operationId,
    changes: { messages: [message("current", content)] },
    committedAt: ts,
  };
}

function assertGateAccepts(work) {
  const report = performanceReportFixture();
  const samples = [...report.samples, ...report.stopContinues.map(({ continued }) => continued)];
  for (const index of [1, 9, 19, 21]) samples[index].checkpointSamples[0].storageWork = work;
  const result = evaluatePerformanceCollection(
    report.samples,
    report.stopContinues.map(({ continued }) => continued),
    report.stopContinues,
  );
  assert.equal(result.passed, true, JSON.stringify(result.failures));
}

for (const [historyCount, sameTurn] of [
  [0, false],
  [64, false],
  [64, true],
]) {
  test(`real cold checkpoint satisfies the performance gate with ${historyCount} messages in ${sameTurn ? "the same turn" : "unrelated turns"}`, async (t) => {
    let store = await fixture(t, historyCount, sameTurn);
    const before = await store.snapshot();
    const historicalValues = new Set();
    await store.objects.withSnapshot(before, async () => {
      for await (const [, reference] of store.index.entries(
        await store.index.get(before.root, "messages"),
      ))
        await collectValueRecords(store, reference, historicalValues);
    });
    const ranges = new Map();
    for (const reference of historicalValues) {
      const record = await committedPhysicalRecord(store, reference);
      const file = store.objects.segments.segmentPath(record.segmentId);
      if (!ranges.has(file)) ranges.set(file, []);
      ranges.get(file).push(record);
    }
    store = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
    const historicalReads = [];
    setFsAdapter({
      open: async (file, flags) => {
        const handle = await open(file, flags);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "read" && flags === "r" && ranges.has(file))
              return async (buffer, offset, length, position) => {
                if (
                  ranges
                    .get(file)
                    .some(
                      (record) =>
                        position < record.offset + record.length &&
                        position + length > record.offset,
                    )
                )
                  historicalReads.push({ file, position, length });
                return target.read(buffer, offset, length, position);
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    let observation;
    try {
      observation = await observeSessionStorageWork(() =>
        commitSessionChanges(request(store, before.generation, "append-current", "first")),
      );
    } finally {
      resetFsAdapter();
    }
    assert.deepEqual(historicalReads, [], "checkpoint must not read unrelated message values");
    assertGateAccepts(observation.work);
    assert.equal(observation.result.generation, before.generation + 1);
    assert.equal(await store.get(before, "messages", "current"), null);
    const pinned = await store.snapshot();
    await commitSessionChanges(request(store, pinned.generation, "edit-current", "second"));
    assert.equal((await store.get(pinned, "messages", "current")).message.content, "first");
    assert.equal(
      (await store.get(await store.snapshot(), "messages", "current")).message.content,
      "second",
    );
  });
}

test("uncertain publication retries the same business delta after restart without rewriting head", async (t) => {
  let store = await fixture(t, 4);
  const before = await store.snapshot();
  const operation = request(store, before.generation, "uncertain-checkpoint", "durable");
  const failure = Object.assign(new Error("head directory synchronization failed"), {
    code: "EIO",
  });
  let published = false;
  setFsAdapter({
    rename: async (source, target) => {
      await rename(source, target);
      if (target === store.headPath) published = true;
    },
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync" && flags === "r" && file === store.sessionDir && published)
            return async () => {
              throw failure;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  });
  try {
    await assert.rejects(commitSessionChanges(operation), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  const bytes = await readFile(store.headPath);
  store = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const { result, work } = await observeSessionStorageWork(() => commitSessionChanges(operation));
  assert.equal(result.replayed, true);
  assert.equal(result.generation, before.generation + 1);
  assert.deepEqual(await readFile(store.headPath), bytes);
  assert.equal(Object.hasOwn(work, "immutableHeadWriteBytes"), false);
  assert.equal(Object.hasOwn(work, "immutableObjectWrites"), false);
  assert.equal(Object.hasOwn(work, "immutableSegmentWrites"), false);
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "current")).message.content,
    "durable",
  );
});
