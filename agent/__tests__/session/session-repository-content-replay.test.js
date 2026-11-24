/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionRepositoryFixture as fixture } from "../helpers/session-repository-fixture.js";
import { repositoryMessage as message, timestamp } from "../helpers/session-repository-message.js";
import { partitionRepositoryPerformanceFixture } from "../helpers/partition-repository-performance-fixture.js";

const appendCount = 16;

test("partition session repository replays a committed append after reopen", async (t) => {
  const fixture = await partitionRepositoryPerformanceFixture(t);
  const original = message("long-turn", 1);
  const {
    result: {
      messageReceipts: [created],
    },
  } = await fixture.commit({ messages: [original] });
  const { messageUid, dialogProcessId, turnScopeId } = original;
  const withReader = (run) => {
    const { repository, persistenceContext } = fixture.services;
    return repository.withSessionReader("u1", "s1", run, { persistenceContext });
  };
  const chunks = ['"first"', '"second"'];
  let contentReference = created.contentReference;
  let request;
  let committed;
  for (const [index, content] of chunks.entries()) {
    ({ request, committed } = await withReader(async ({ reader, commitChanges }) => {
      const request = await reader.prepareRequest({
        operationId: `reopen-append-${index}`,
        committedAt: timestamp,
        changes: {
          messageContentAppends: [
            {
              messageUid,
              dialogProcessId,
              turnScopeId,
              owner: created.owner,
              expectedContentReference: contentReference,
              content,
            },
          ],
        },
      });
      return { request, committed: await commitChanges(request) };
    }));
    [{ contentReference }] = committed.result.messageReceipts;
  }

  await fixture.reopen();
  const replay = await withReader(({ commitChanges }) => commitChanges(request));
  assert.deepEqual(replay, { ...committed, replayed: true });
  await withReader(async ({ reader }) => {
    assert.equal(reader.generation, committed.generation);
    const page = await reader.readTurnPage({ turnScopeId, limit: 1 });
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].message.messageUid, messageUid);
    assert.equal(page.records[0].message.content, original.content + chunks.join(""));
  });
});

test("immutable repository content appends preserve snapshot versions and replay receipts", async (t) => {
  const {
    services: { repository, persistenceContext },
    commit,
    prepare,
    submit,
  } = await fixture(t);
  const { messageUid, dialogProcessId, turnScopeId, content } = message("long-turn", 1);
  let {
    result: {
      messageReceipts: [receipt],
    },
  } = await commit({
    messages: [message("long-turn", 1)],
  });
  const openReader = () => repository.requireSessionReader("u1", "s1", { persistenceContext });
  await using oldReader = await openReader();
  const readPage = (reader, expectedContentReference, byteOffset) =>
    reader.readMessageContentPage({
      messageUid,
      byteOffset,
      maxBytes: 8,
      expectedContentReference,
    });
  const first = await readPage(oldReader, receipt.contentReference, 0);
  assert.equal(first.hasMore, true);
  const chunk = '"🙂'.repeat(32);
  for (let index = 0; index < appendCount; index += 1) {
    const request = await prepare({
      messageContentAppends: [
        {
          messageUid,
          dialogProcessId,
          turnScopeId,
          owner: receipt.owner,
          expectedContentReference: receipt.contentReference,
          content: chunk,
        },
      ],
    });
    const applied = await submit(request);
    const next = applied.result.messageReceipts[0];
    assert.notEqual(next.contentReference, receipt.contentReference);
    receipt = next;
    if (index === appendCount - 1) {
      await using reader = await openReader();
      assert.equal(reader.generation, applied.generation);
      const replay = await submit(request);
      assert.equal(replay.replayed, true);
      assert.equal(replay.generation, applied.generation);
      assert.deepEqual(replay.result, applied.result);
      const page = await reader.readTurnPage({ turnScopeId, after: 0, limit: 1 });
      assert.equal(page.records[0].message.content, content + chunk.repeat(appendCount));
      await assert.rejects(readPage(reader, first.contentReference, first.nextByteOffset), {
        code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
      });
    }
  }
  const second = await readPage(oldReader, first.contentReference, first.nextByteOffset);
  assert.equal(second.contentReference, first.contentReference);
  assert.equal(second.totalBytes, Buffer.byteLength(JSON.stringify(content)));
});
