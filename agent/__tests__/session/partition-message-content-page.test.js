/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
  scope,
} from "./partition-session-messages.test-helpers.js";

function selection(messageUid, byteOffset = 0, expectedContentReference = null, maxBytes = 7) {
  return { messageUid, byteOffset, expectedContentReference, maxBytes };
}

async function collectPages(reader, messageUid, maxBytes) {
  const chunks = [];
  let page;
  do {
    page = await reader.readMessageContentPage(
      selection(messageUid, page?.nextByteOffset ?? 0, page?.contentReference ?? null, maxBytes),
    );
    assert.equal(page.encoding, "json-utf8-base64");
    chunks.push(Buffer.from(page.dataBase64, "base64"));
  } while (page.hasMore);
  return Buffer.concat(chunks);
}

test("business content pages preserve canonical JSON bytes across append boundaries and reopen", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const parts = ['prefix"\\\n\u0000中文\ud83d', "", "\ude80 tail\ud800", "", "\udc00", "end\udfff"];
  let receipt = (
    await repository.commit(
      await prepare(journal, repository, "create", {
        messages: [{ ...message(sessionId, "m1"), content: parts[0] }],
      }),
    )
  ).result.messageReceipts[0];
  await using old = await openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  for (const [index, content] of parts.entries()) {
    if (index === 0 || content.length === 0) continue;
    receipt = (
      await repository.commit(
        await prepare(journal, repository, `append-${index}`, {
          messageContentAppends: [
            {
              ...scope,
              messageUid: "m1",
              owner: receipt.owner,
              expectedContentReference: receipt.contentReference,
              content,
            },
          ],
        }),
      )
    ).result.messageReceipts[0];
  }
  const expected = Buffer.from(JSON.stringify(parts.join("")));
  const verify = async (source) => {
    await using reader = await openPartitionSessionReader({
      journal: source,
      sessionId,
      parentSessionId: "",
    });
    assert.deepEqual(await collectPages(reader, "m1", 1), expected);
    assert.deepEqual(await collectPages(reader, "m1", 7), expected);
    const [stored] = await reader.readMessages({ messageUids: ["m1"] });
    assert.equal(stored.message.content, parts.join(""));
    const atEnd = await reader.readMessageContentPage(
      selection("m1", expected.length, receipt.contentReference),
    );
    assert.equal(atEnd.dataBase64, "");
    assert.equal(atEnd.hasMore, false);
    await assert.rejects(
      reader.readMessageContentPage(selection("m1", expected.length + 1, receipt.contentReference)),
      RangeError,
    );
    assert.equal(await reader.readMessageContentPage(selection("missing")), null);
  };
  await verify(journal);
  assert.deepEqual(await collectPages(old, "m1", 5), Buffer.from(JSON.stringify(parts[0])));
  await old[Symbol.asyncDispose]();
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await verify(reopened);
});

test("business content service uses the partition port and rejects stale continuation after replacement", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const created = await repository.commit(
    await prepare(journal, repository, "create", {
      messages: [message(sessionId, "m1")],
    }),
  );
  const service = new SessionMessageService({
    now: () => "2026-11-20T00:00:00.000Z",
    sessionRepo: {
      requireSessionReader: async () =>
        openPartitionSessionReader({ journal, sessionId, parentSessionId: "" }),
    },
  });
  const read = (input) =>
    service.getSessionMessageContentPage({ userId: "test-user", sessionId, ...input });
  const first = await read(selection("m1", 0, null, 1));
  await repository.commit(
    await prepare(journal, repository, "replace", {
      messageContentReplacements: [
        {
          ...scope,
          messageUid: "m1",
          owner: created.result.messageReceipts[0].owner,
          expectedContentReference: first.contentReference,
          content: "replaced 中文",
        },
      ],
    }),
  );
  await assert.rejects(read(selection("m1", first.nextByteOffset, first.contentReference)), {
    code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
    statusCode: 409,
  });
  const updated = await read(selection("m1", 0, null, 100));
  assert.equal(JSON.parse(Buffer.from(updated.dataBase64, "base64").toString()), "replaced 中文");
  await assert.rejects(read(selection("absent")), {
    code: "SESSION_MESSAGE_NOT_FOUND",
    statusCode: 404,
  });
});

test("cold thinking detail rejects oversized selected content before reading body chunks", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, {
    transactionBytes: 128 * 1024,
    receiptBytes: 128 * 1024,
    entityProjectionBytes: 512 * 1024,
    batchBytes: 128 * 1024,
    partitionBytes: 256 * 1024,
    pageBytes: 128 * 1024,
    pageRecords: 32,
  });
  const repository = openTestMessages(journal, sessionId);
  const content = '"\\\n'.repeat(8 * 1024);
  await repository.commit(
    await prepare(journal, repository, "create-long-content", {
      messages: [
        { ...message(sessionId, "ordinary"), content },
        { ...message(sessionId, "injected"), injectedMessage: true, content },
      ],
    }),
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using reader = await openPartitionSessionReader({
    journal: reopened,
    sessionId,
    parentSessionId: "",
  });
  const options = { lookupKey: scope, cursor: null, limit: 2 };
  const { work } = await observeStorageIo(root, () =>
    assert.rejects(reader.readThinkingDetailPage({ ...options, maxBytes: 4096 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    }),
  );
  t.diagnostic(`Cold rejected thinking detail: ${work.readBytes} bytes`);
  assert.ok(work.readBytes < 16 * 1024, JSON.stringify(Object.fromEntries(work.readBytesByPath)));
  const page = await reader.readThinkingDetailPage({ ...options, maxBytes: 64 * 1024 });
  assert.equal(page.records[0].message.content, null);
  assert.equal(page.records[1].message.content, content);
});

for (const initialContent of ["", "x".repeat(2304)]) {
  test(`cold byte range seeks under the original budget with ${initialContent.length} initial bytes`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t, { pageBytes: 4096 });
    const repository = openTestMessages(journal, sessionId);
    const content = "x".repeat(2304);
    let receipt = (
      await repository.commit(
        await prepare(journal, repository, "create", {
          messages: [{ ...message(sessionId, "m1"), content: initialContent }],
        }),
      )
    ).result.messageReceipts[0];
    for (let index = 0; index < (initialContent.length ? 24 : 25); index += 1) {
      receipt = (
        await repository.commit(
          await prepare(journal, repository, `append-${index}`, {
            messageContentAppends: [
              {
                ...scope,
                messageUid: "m1",
                owner: receipt.owner,
                expectedContentReference: receipt.contentReference,
                content,
              },
            ],
          }),
        )
      ).result.messageReceipts[0];
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await using reader = await openPartitionSessionReader({
      journal: reopened,
      sessionId,
      parentSessionId: "",
    });
    const offset = 1 + content.length * 24 + 31;
    const { result, work } = await observeStorageIo(root, async () => {
      try {
        return {
          page: await reader.readMessageContentPage(
            selection("m1", offset, receipt.contentReference, 17),
          ),
        };
      } catch (error) {
        return { error };
      }
    });
    t.diagnostic(
      `Cold 25-chunk range: ${work.readBytes} bytes, ${JSON.stringify(Object.fromEntries(work.readBytesByPath))}`,
    );
    if (result.error) throw result.error;
    const { page } = result;
    assert.equal(Buffer.from(page.dataBase64, "base64").toString(), "x".repeat(17));
    assert.ok(work.readBytes <= 4096, JSON.stringify(Object.fromEntries(work.readBytesByPath)));
  });
}
