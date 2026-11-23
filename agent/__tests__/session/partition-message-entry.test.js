/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  publishInvalidMessageHeader,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("point message entries share the turn-page contract and bind their content version to the reader", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const created = await messages.commit(
    await prepare(journal, messages, "create", {
      messages: [message(sessionId, "m1")],
    }),
  );
  const [{ owner, contentReference }] = created.result.messageReceipts;
  let escaped;
  await withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, async (reader) => {
    escaped = reader;
    const original = await reader.readMessageEntry({ messageUid: "m1" });
    const turn = await reader.readTurnMessageEntryPage({ ...scope, cursor: null, limit: 1 });
    assert.deepEqual(original, turn.entries[0]);
    assert.equal(Object.hasOwn(original.message, "content"), false);
    assert.deepEqual(original.owner, owner);
    assert.equal(original.contentReference, contentReference);
    assert.equal(await reader.readMessageEntry({ messageUid: "missing" }), null);
    await assert.rejects(reader.readMessageEntry({ messageUid: " m1" }), TypeError);
    await assert.rejects(reader.readMessageEntry({ messageUid: "m1", maxBytes: 1 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });
    assert.deepEqual(await reader.readMessageEntry({ messageUid: "m1" }), original);
    await messages.commit(
      await prepare(journal, messages, "append", {
        messageContentAppends: [
          {
            ...scope,
            messageUid: "m1",
            owner,
            expectedContentReference: contentReference,
            content: " tail",
          },
        ],
      }),
    );
    assert.deepEqual(
      await reader.readMessageEntry({ messageUid: "m1", snapshot: journal.head }),
      original,
    );
    await withPartitionSessionReader(
      { journal, sessionId, parentSessionId: "" },
      async (current) => {
        const updated = await current.readMessageEntry({ messageUid: "m1" });
        assert.notEqual(updated.contentReference, original.contentReference);
        assert.deepEqual(updated.owner, original.owner);
        assert.deepEqual(
          await current.readContentPage({
            ...scope,
            messageUid: "m1",
            contentReference: updated.contentReference,
            cursor: null,
            limit: 2,
          }),
          { entries: ["m1", " tail"], nextCursor: null },
        );
      },
    );
  });
  await assert.rejects(escaped.readMessageEntry({ messageUid: "m1" }), {
    code: "SESSION_READER_CLOSED",
  });
});

test("point message entries hide a deleted suffix while preserving the interleaved prefix and retained view", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  await messages.commit(
    await prepare(journal, messages, "create", {
      messages: [
        message(sessionId, "retained"),
        { ...message(sessionId, "anchor"), ...other },
        message(sessionId, "removed"),
      ],
    }),
  );
  await withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, async (reader) => {
    const retained = await reader.readMessageEntry({ messageUid: "retained" });
    const removed = await reader.readMessageEntry({ messageUid: "removed" });
    await messages.commit(
      await prepare(journal, messages, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: other.turnScopeId } },
      }),
    );
    assert.deepEqual(await reader.readMessageEntry({ messageUid: "removed" }), removed);
    await withPartitionSessionReader(
      { journal, sessionId, parentSessionId: "" },
      async (current) => {
        assert.deepEqual(await current.readMessageEntry({ messageUid: "retained" }), retained);
        assert.equal(await current.readMessageEntry({ messageUid: "anchor" }), null);
        assert.equal(await current.readMessageEntry({ messageUid: "removed" }), null);
        const turn = await current.readTurnMessageEntryPage({ ...scope, cursor: null, limit: 1 });
        assert.deepEqual(turn.entries, [retained]);
      },
    );
  });
});

test("point message entries reject corrupt message authority rather than treating it as missing", async (t) => {
  const { journal, repository, messageUid } = await publishInvalidMessageHeader(t, {
    sessionId: "foreign",
  });
  t.after(() => journal.close());
  await journal.usingSnapshot(async (snapshot) => {
    await assert.rejects(repository.readMessageEntry({ snapshot, messageUid }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });
});

test("cold point metadata reads and attachment validation avoid the stored body", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const messages = openTestMessages(journal, sessionId);
  const content = "x".repeat(6 * 1024);
  await messages.commit(
    await prepare(journal, messages, "create", {
      messages: [
        {
          ...scope,
          sessionId,
          messageUid: "user",
          type: "message",
          attachments: [],
          ts: message(sessionId, "user").ts,
          role: "user",
          messageOrigin: "natural",
          content,
        },
      ],
    }),
  );
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const { result: attachments, work: attachmentWork } = await withPartitionSessionReader(
    { journal: cold, sessionId, parentSessionId: "" },
    (reader) =>
      observeStorageIo(root, () =>
        reader.readAttachmentBindingTarget({ messageUid: "user", turnScopeId: scope.turnScopeId }),
      ),
  );
  assert.deepEqual(attachments, []);
  assert.ok(attachmentWork.readBytes > 0);
  assert.ok(attachmentWork.readBytes < Buffer.byteLength(content), JSON.stringify(attachmentWork));
  assert.equal(attachmentWork.writeBytes, 0);
  const coldEntry = await PartitionJournal.open({ root, sessionId });
  t.after(() => coldEntry.close());
  await withPartitionSessionReader(
    { journal: coldEntry, sessionId, parentSessionId: "" },
    async (reader) => {
      const before = structuredClone(coldEntry.head);
      const { result, work } = await observeStorageIo(root, () =>
        reader.readMessageEntry({ messageUid: "user" }),
      );
      assert.equal(Object.hasOwn(result.message, "content"), false);
      assert.ok(work.readBytes > 0);
      assert.ok(
        work.readBytes < Buffer.byteLength(content),
        JSON.stringify({ readBytes: work.readBytes }),
      );
      assert.equal(work.writeBytes, 0);
      assert.deepEqual(coldEntry.head, before);
      await assert.rejects(
        reader.readAttachmentBindingTarget({ messageUid: "user", turnScopeId: "foreign-turn" }),
        { code: "SESSION_MESSAGE_NOT_FOUND" },
      );
    },
  );
});
