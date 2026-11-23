/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  readCommittedIndex,
  readCommittedPage,
  readCommittedValue,
  readCommittedValueMetadata,
  collectValueRecords,
  collectScopedValueRecords,
  forbidRecordReads,
} from "../session/helpers/immutable-record-reads.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "./commit-immutable-session-fixture.js";
import { readImmutableIndexedTitle } from "../../src/session/session-artifact-session/immutable-title-index.js";
import { readImmutableTurnPage } from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function collectBodyPayloads(store, reference, payloads = new Set()) {
  const page = await readCommittedPage(store, reference);
  if (page.kind === "value") payloads.add(page.data);
  else if (page.kind === "value-inline") payloads.add(reference);
  else {
    assert.equal(page.kind, "value-branch");
    await collectBodyPayloads(store, page.left, payloads);
    await collectBodyPayloads(store, page.right, payloads);
  }
  return payloads;
}

function forbidBodyMaterialization(t, store, references) {
  const prototype = Object.getPrototypeOf(store.objects);
  const readValueChunks = prototype.readValueChunks;
  const interception = t.mock.method(prototype, "readValueChunks", function (reference, ...args) {
    assert.equal(references.has(reference), false, `Unexpected body materialization: ${reference}`);
    return readValueChunks.call(this, reference, ...args);
  });
  assert.throws(
    () => store.objects.readValueChunks(references.values().next().value),
    /Unexpected body materialization/,
  );
  return interception;
}

export function registerImmutableMessageBodyStorageTests({ fixture, message, append, timestamp }) {
  test("cold append does not read earlier message bodies in either long turns or historical turns", async (t) => {
    for (const historicalTurns of [false, true]) {
      const store = await fixture(t);
      const messages = Array.from({ length: 128 }, (_, index) =>
        message(
          `m-${index}`,
          historicalTurns
            ? {
                dialogProcessId: `dialog-${index}`,
                turnScopeId: `turn-${index}`,
              }
            : {},
        ),
      );
      await append(store, messages, "seed");
      const head = await store.snapshot();
      const references = new Set();
      for (const item of messages) {
        const reference = await readCommittedIndex(
          store,
          await readCommittedIndex(store, head.root, "messages"),
          item.messageUid,
        );
        references.add(reference);
      }
      const reopened = new ImmutableSessionStore({
        sessionDir: store.sessionDir,
        sessionId: store.sessionId,
      });
      setFsAdapter(await forbidRecordReads(store, references));
      t.after(resetFsAdapter);
      const { work } = await observeSessionStorageWork(() =>
        append(
          reopened,
          [
            message(
              "current",
              historicalTurns
                ? {
                    dialogProcessId: "current-dialog",
                    turnScopeId: "current-turn",
                  }
                : {},
            ),
          ],
          "current",
        ),
      );
      assert.ok(work.immutableIndexPageReads < 100, JSON.stringify(work));
      assert.ok(work.immutableHeadWriteBytes < 4096, JSON.stringify(work));
      assert.equal(
        (await reopened.get(await reopened.snapshot(), "messages", "current")).message.content,
        "current",
      );
      const page = await readImmutableTurnPage({
        store: reopened,
        snapshot: await reopened.snapshot(),
        turnScopeId: historicalTurns ? "current-turn" : "turn-1",
        after: historicalTurns ? 0 : 128,
        limit: 1,
      });
      assert.equal(page.records[0].message.messageUid, "current");
      assert.equal(page.hasMore, false);
      resetFsAdapter();
    }
  });

  test("message replacement does not read old payloads and keeps title eligibility and old snapshots", async (t) => {
    const store = await fixture(t);
    const content = "old body 中文".repeat(20000);
    await append(store, [message("old", { content }), message("second")], "seed");
    const previous = await store.snapshot();
    const reference = await readCommittedIndex(
      store,
      await readCommittedIndex(store, previous.root, "messages"),
      "old",
    );
    const before = await readCommittedValueMetadata(store, reference);
    const forbidden = await collectBodyPayloads(store, before.parts[0].reference);
    setFsAdapter(await forbidRecordReads(store, forbidden));
    try {
      await append(store, [message("old", { content: "" })], "empty");
      const empty = await store.snapshot();
      assert.equal(
        await store.objects.withSnapshot(empty, () =>
          readImmutableIndexedTitle(store, {
            get: (collection, key) => store.get(empty, collection, key),
            getMetadata: async (collection, key) =>
              (await store.getManyMetadata(empty, collection, [key])).get(key),
          }),
        ),
        "second",
      );
      await append(store, [message("old", { content: "replacement" })], "restore");
    } finally {
      resetFsAdapter();
    }
    const current = await store.snapshot();
    assert.equal((await store.get(current, "messages", "old")).message.content, "replacement");
    assert.equal((await store.get(previous, "messages", "old")).message.content, content);
    assert.equal(
      await store.objects.withSnapshot(current, () =>
        readImmutableIndexedTitle(store, {
          get: (collection, key) => store.get(current, collection, key),
          getMetadata: async (collection, key) =>
            (await store.getManyMetadata(current, collection, [key])).get(key),
        }),
      ),
      "replacement",
    );
  });

  test("user meta commit preserves physical content identity and original replay result", async (t) => {
    const store = await fixture(t);
    const content = "source 中文".repeat(20000);
    await append(store, [message("source", { content })], "seed");
    const previous = await store.snapshot();
    const stored = async (head) =>
      readCommittedValueMetadata(
        store,
        await readCommittedIndex(
          store,
          await readCommittedIndex(store, head.root, "messages"),
          "source",
        ),
      );
    const before = await stored(previous);
    const forbidden = await collectValueRecords(store, before.parts[0].reference);
    const request = (head, operationId, summary) => ({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: head.generation,
      operationId,
      committedAt: timestamp,
      changes: {
        userMetaParsedResult: {
          messageUid: "source",
          result: { sourceAttachmentRef: "attach://source", summary },
        },
      },
    });
    const first = request(previous, "parse-first", "first");
    setFsAdapter(await forbidRecordReads(store, forbidden));
    let committed;
    let current;
    try {
      const observed = await observeSessionStorageWork(() => commitSessionChanges(first));
      committed = observed.result;
      assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
      current = await store.snapshot();
      assert.deepEqual((await stored(current)).parts, before.parts);
      await commitSessionChanges(request(current, "parse-second", "second"));
      const latest = await store.snapshot();
      const replay = await commitSessionChanges(first);
      assert.deepEqual(replay.result, committed.result);
      assert.deepEqual(await store.snapshot(), latest);
      await assert.rejects(
        commitSessionChanges({
          ...request(latest, "missing", "missing"),
          changes: {
            userMetaParsedResult: {
              messageUid: "missing",
              result: first.changes.userMetaParsedResult.result,
            },
          },
        }),
        { code: "USER_META_SOURCE_NOT_FOUND" },
      );
      assert.deepEqual(await store.snapshot(), latest);
    } finally {
      resetFsAdapter();
    }
    assert.equal((await store.get(previous, "messages", "source")).message.content, content);
    assert.equal(
      (await store.get(previous, "messages", "source")).message.userMetaParsedResults,
      undefined,
    );
    assert.equal(
      (await store.get(current, "messages", "source")).message.userMetaParsedResults[0].summary,
      "first",
    );
  });

  test("first message receipt projection never reads its staged body graph", async (t) => {
    const store = await fixture(t);
    const prototype = Object.getPrototypeOf(store.objects);
    const readValuesMetadata = prototype.readValuesMetadata;
    let blockedBodies = 0;
    t.mock.method(prototype, "readValuesMetadata", async function (references, ...args) {
      const objects = this;
      const forbidden = new Set();
      for (const reference of references) {
        const [metadata] = await readValuesMetadata.call(objects, [reference], ...args);
        for (const part of metadata.parts) {
          await collectScopedValueRecords(objects, part.reference, forbidden);
          blockedBodies += 1;
        }
      }
      if (!forbidden.size) return readValuesMetadata.call(objects, references, ...args);
      const { read, readMany } = objects;
      const assertAllowed = (reference) =>
        assert.equal(forbidden.has(reference), false, `Unexpected body record read: ${reference}`);
      t.mock.method(objects, "read", async (reference) => {
        assertAllowed(reference);
        return read.call(objects, reference);
      });
      t.mock.method(objects, "readMany", async (references) => {
        for (const reference of references) assertAllowed(reference);
        return readMany.call(objects, references);
      });
      const body = forbidden.values().next().value;
      assert.notEqual(body, undefined);
      await assert.rejects(objects.read(body), /Unexpected body record read/);
      await assert.rejects(objects.readMany([body]), /Unexpected body record read/);
      forbidBodyMaterialization(t, { objects }, forbidden);
      return readValuesMetadata.call(objects, references, ...args);
    });
    const committed = await commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "first-receipt-without-body",
      committedAt: timestamp,
      changes: {
        messages: [message("large-receipt", { content: "receipt body 中文".repeat(20000) })],
      },
    });
    assert.equal(blockedBodies, 1);
    assert.equal(committed.result.messageReceipts[0].messageUid, "large-receipt");
    assert.equal(Object.hasOwn(committed.result.messageReceipts[0], "content"), false);
  });

  test("message receipts own identities and replay their original generation after updates and removal", async (t) => {
    const store = await fixture(t);
    const request = {
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "projected-append",
      committedAt: timestamp,
      changes: {
        messages: [
          message("one"),
          message("two"),
          message("one", { content: "receipt body 中文".repeat(20000) }),
        ],
      },
    };
    const committed = await commitSessionChanges(request);
    assert.deepEqual(
      committed.result.messageReceipts.map((item) => item.messageUid),
      ["one", "two", "one"],
    );
    const head = await store.snapshot();
    const receipt = await readCommittedValue(
      store,
      await readCommittedIndex(store, head.operations, request.operationId),
    );
    assert.deepEqual(receipt.result.messages, ["one", "two", "one"]);
    const reference = await readCommittedIndex(
      store,
      await readCommittedIndex(store, head.root, "messages"),
      "one",
    );
    const metadata = await readCommittedValueMetadata(store, reference);
    const forbidden = await collectValueRecords(store, metadata.parts[0].reference);
    await append(store, [message("one", { content: "later" })], "later");
    await store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "remove-index-entry",
      changes: [{ collection: "messages", key: "one", remove: true }],
    });
    const latest = await store.snapshot();
    setFsAdapter(await forbidRecordReads(store, forbidden));
    const materializationGuard = forbidBodyMaterialization(t, store, forbidden);
    try {
      const replay = await commitSessionChanges(request);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, committed.result);
      assert.deepEqual(await store.snapshot(), latest);
    } finally {
      resetFsAdapter();
      materializationGuard.mock.restore();
    }
  });

  test("nonrepeated message bodies reuse physical blocks for metadata updates and short appends", async (t) => {
    for (const size of [65536, 1048576]) {
      const store = await fixture(t);
      const content = randomBytes(size / 2).toString("hex");
      await append(store, [message("large", { content })], "seed");
      const original = await store.snapshot();
      const stored = async () =>
        readCommittedValueMetadata(
          store,
          await readCommittedIndex(
            store,
            await readCommittedIndex(store, (await store.snapshot()).root, "messages"),
            "large",
          ),
        );
      const before = await stored();
      const payloads = await collectBodyPayloads(store, before.parts[0].reference);
      setFsAdapter(await forbidRecordReads(store, payloads));
      try {
        const observed = await observeSessionStorageWork(() =>
          append(store, [message("large", { content, summarized: true })], "metadata"),
        );
        assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
        assert.deepEqual((await stored()).parts, before.parts);
        const appended = await observeSessionStorageWork(() =>
          append(
            store,
            [message("large", { content: `${content}extra`, summarized: true })],
            "append-five",
          ),
        );
        assert.ok(appended.work.immutableWriteBytes < 65536, JSON.stringify(appended.work));
        t.diagnostic(
          JSON.stringify({
            size,
            metadataWriteBytes: observed.work.immutableWriteBytes,
            appendWriteBytes: appended.work.immutableWriteBytes,
          }),
        );
      } finally {
        resetFsAdapter();
      }
      assert.equal((await store.get(original, "messages", "large")).message.content, content);
      assert.equal(
        (await store.get(await store.snapshot(), "messages", "large")).message.content,
        `${content}extra`,
      );
      const response = await observeSessionStorageWork(() =>
        commitSessionChanges({
          sessionDir: store.sessionDir,
          sessionId: store.sessionId,
          expectedGeneration: original.generation + 2,
          operationId: "projected-metadata",
          committedAt: timestamp,
          changes: {
            messages: [message("large", { content: `${content}extra`, summarized: false })],
          },
        }),
      );
      assert.ok(response.work.immutableWriteBytes < 32768, JSON.stringify(response.work));
      assert.equal(response.result.result.messageReceipts[0].messageUid, "large");
      assert.equal(Object.hasOwn(response.result.result.messageReceipts[0], "content"), false);
      t.diagnostic(
        JSON.stringify({ size, projectedWriteBytes: response.work.immutableWriteBytes }),
      );
    }
  });
}
