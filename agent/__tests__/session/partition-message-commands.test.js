/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("partition attachment binding commits once and replays after reopening", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const user = {
    ...scope,
    sessionId,
    messageUid: "source",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: "source",
    attachments: [],
    ts: committedAt,
  };
  await repository.commit(await prepare(journal, repository, "create-user", { messages: [user] }));
  const page = (store, reader) =>
    store.usingSnapshot((snapshot) =>
      reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 1 }),
    );
  const original = (await page(journal, repository)).entries[0];
  const attachment = {
    attachmentId: "upload",
    attachmentSource: "user",
    sessionId,
    name: "input.txt",
    mimeType: "text/plain",
  };
  const binding = {
    userId: "user-1",
    sessionId,
    turnScopeId: scope.turnScopeId,
    messageUid: user.messageUid,
    commandId: "bind-upload",
    expectedAggregateVersion: 0,
    attachments: [attachment],
  };
  const submit = (store, reader, operationId, override = {}) =>
    prepare(store, reader, operationId, {
      attachmentBinding: { ...binding, ...override },
    });
  const initial = journal.head.sequence;
  const { mimeType: _mimeType, ...invalidAttachment } = attachment;
  await assert.rejects(
    repository.commit(
      await submit(journal, repository, "invalid", {
        attachments: [invalidAttachment],
      }),
    ),
    { statusCode: 400, message: "invalid_attachment_mime_type" },
  );
  assert.equal(journal.head.sequence, initial);
  await assert.rejects(
    repository.commit(
      await submit(journal, repository, "stale", {
        expectedAggregateVersion: 1,
      }),
    ),
    { code: "SESSION_AGGREGATE_VERSION_CONFLICT", currentVersion: 0 },
  );
  assert.equal(journal.head.sequence, initial);
  const request = await submit(journal, repository, "bind");
  const committed = await repository.commit(request);
  assert.equal(journal.head.sequence, initial + 1);
  assert.deepEqual(committed.result, {
    attachmentBinding: { messageUid: "source", aggregateVersion: 1, deduplicated: false },
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  const duplicate = await reader.commit(await submit(reopened, reader, "repeat-command"));
  assert.deepEqual(duplicate.result, {
    attachmentBinding: { messageUid: "source", aggregateVersion: 1, deduplicated: true },
  });
  await assert.rejects(
    reader.commit(
      await submit(reopened, reader, "change-command", {
        attachments: [{ ...attachment, attachmentId: "other" }],
      }),
    ),
    { code: "SESSION_IDEMPOTENCY_KEY_REUSED" },
  );
  await assert.rejects(
    reader.commit(
      await submit(reopened, reader, "rebind", {
        commandId: "second-bind",
        expectedAggregateVersion: 1,
      }),
    ),
    { code: "SESSION_TURN_ATTACHMENTS_ALREADY_BOUND" },
  );
  assert.equal(reopened.head.sequence, initial + 1);
  const updated = (await page(reopened, reader)).entries[0];
  assert.equal(updated.contentReference, original.contentReference);
  assert.equal(updated.message.attachments[0].attachmentId, attachment.attachmentId);
  const readAttachments = (turnScopeId, messageUid = user.messageUid) =>
    reopened.usingSnapshot((snapshot) =>
      reader.readAttachmentBindingTarget({ snapshot, turnScopeId, messageUid }),
    );
  assert.deepEqual(await readAttachments(scope.turnScopeId), [attachment]);
  await assert.rejects(readAttachments("another-turn"), { code: "SESSION_MESSAGE_NOT_FOUND" });
  await assert.rejects(readAttachments(scope.turnScopeId, "missing"), {
    code: "SESSION_MESSAGE_NOT_FOUND",
  });
  const update = {
    ...scope,
    messageUid: user.messageUid,
    owner: updated.owner,
    expectedContentReference: updated.contentReference,
  };
  for (const [index, changes] of [
    { metadata: { attachments: [] }, metadataRemovals: [] },
    { metadata: {}, metadataRemovals: ["attachments"] },
  ].entries()) {
    const bypass = await prepare(reopened, reader, `attachment-bypass-${index}`, {
      messageMetadataUpdates: [{ ...update, ...changes }],
    });
    await assert.rejects(reader.commit(bypass), {
      code: "SESSION_COMMIT_INPUT_INVALID",
      message: /require the binding command/,
    });
  }
  const duplicateCreation = await prepare(reopened, reader, "attachment-recreation", {
    messages: [user],
  });
  await assert.rejects(reader.commit(duplicateCreation), { code: "SESSION_ENTITY_EXISTS" });
  assert.equal(reopened.head.sequence, initial + 1);
  assert.deepEqual((await page(reopened, reader)).entries[0], updated);
});

test("suffix deletion preserves only bindings whose messages survive a cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  for (const [uid, turnScopeId] of [
    ["retained", "a"],
    ["anchor", "b"],
    ["removed", "a"],
  ]) {
    await repository.commit(
      await prepare(journal, repository, uid, {
        messages: [
          {
            ...scope,
            sessionId,
            turnScopeId,
            messageUid: uid,
            role: "user",
            messageOrigin: "natural",
            type: "message",
            content: uid,
            attachments: [],
            ts: committedAt,
          },
        ],
      }),
    );
  }
  const binding = (messageUid, expectedAggregateVersion) => ({
    attachmentBinding: {
      userId: "u1",
      sessionId,
      turnScopeId: "a",
      messageUid,
      commandId: `bind-${messageUid}`,
      expectedAggregateVersion,
      attachments: [
        {
          attachmentId: messageUid,
          sessionId,
          attachmentSource: "user",
          name: "input.txt",
          mimeType: "text/plain",
        },
      ],
    },
  });
  await repository.commit(
    await prepare(journal, repository, "bind-retained", binding("retained", 0)),
  );
  await repository.commit(
    await prepare(journal, repository, "bind-removed", binding("removed", 1)),
  );
  await repository.commit(
    await prepare(journal, repository, "delete", {
      messageDeletion: {
        anchor: { turnScopeId: "b" },
        commandId: "delete",
        expectedAggregateVersion: 2,
      },
    }),
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  const retry = await reader.commit(
    await prepare(reopened, reader, "retry-binding", binding("retained", 0)),
  );
  assert.equal(retry.result.attachmentBinding.deduplicated, true);
  const changed = binding("removed", 1);
  changed.attachmentBinding.attachments[0].attachmentId = "changed";
  await assert.rejects(reader.commit(await prepare(reopened, reader, "retry-removed", changed)), {
    code: "SESSION_MESSAGE_NOT_FOUND",
  });
});

test("an invalid mixed command does not abort other commits in the batch", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const first = await prepare(journal, repository, "first", {
    messages: [message(sessionId, "first")],
  });
  const invalid = await prepare(journal, repository, "mixed", {
    attachmentBinding: {},
    messages: [],
  });
  const last = await prepare(journal, repository, "last", {
    messages: [message(sessionId, "last")],
  });
  const expectedGeneration = first.expectedGeneration + 1;
  const commits = await Promise.allSettled([
    repository.commit(first),
    repository.commit({ ...invalid, expectedGeneration }),
    repository.commit({ ...last, expectedGeneration }),
  ]);
  assert.deepEqual(
    commits.map(({ status }) => status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(commits[1].reason.code, "SESSION_COMMIT_INPUT_INVALID");
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.sequence, expectedGeneration + 1);
    const page = await repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 4 });
    assert.deepEqual(page.entries, ["first", "last"]);
  });
});

test("user meta replaces the matching attachment result without changing the body and replays cold", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "user-meta-source", {
      messages: [
        {
          ...scope,
          sessionId,
          messageUid: "source",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: "source",
          attachments: [],
          ts: committedAt,
        },
        message(sessionId, "assistant"),
      ],
    }),
  );
  const readPage = (store, reader) =>
    store.usingSnapshot((snapshot) =>
      reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 }),
    );
  const original = (await readPage(journal, repository)).entries[0];
  const first = { sourceAttachmentRef: "attach://source", summary: "old" };
  const latest = { ...first, summary: "new" };
  const changes = (messageUid, result) => ({ userMetaParsedResult: { messageUid, result } });
  for (const [uid, code] of [
    ["missing", "USER_META_SOURCE_NOT_FOUND"],
    ["assistant", "USER_META_SOURCE_ROLE_CONFLICT"],
  ]) {
    const sequence = journal.head.sequence;
    await assert.rejects(
      repository.commit(await prepare(journal, repository, uid, changes(uid, first))),
      { code },
    );
    assert.equal(journal.head.sequence, sequence);
  }
  await repository.commit(await prepare(journal, repository, "parse-1", changes("source", first)));
  const request = await prepare(journal, repository, "parse-2", changes("source", latest));
  const committed = await repository.commit(request);
  assert.deepEqual(committed.result, { userMetaParsedResult: { userMetaParsedResults: [latest] } });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  const updated = (await readPage(reopened, reader)).entries[0];
  assert.equal(updated.contentReference, original.contentReference);
  assert.deepEqual(updated.message.userMetaParsedResults, [latest]);
});

test("same-batch attachment binding and user meta use the transaction pre-state", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { batchWaitMs: 20 });
  const repository = openTestMessages(journal, sessionId);
  const create = await prepare(journal, repository, "create-source", {
    messages: [
      {
        ...scope,
        sessionId,
        messageUid: "source",
        role: "user",
        messageOrigin: "natural",
        type: "message",
        content: "source",
        attachments: [],
        ts: committedAt,
      },
    ],
  });
  const attachment = {
    attachmentId: "upload",
    attachmentSource: "user",
    sessionId,
    name: "input.txt",
    mimeType: "text/plain",
  };
  const parsed = { sourceAttachmentRef: "attach://source", summary: "parsed" };
  const request = (offset, operationId, changes) => ({
    epoch: create.epoch,
    expectedGeneration: create.expectedGeneration + offset,
    operationId,
    input: { committedAt, changes },
  });
  const binding = request(1, "bind-source", {
    attachmentBinding: {
      userId: "user-1",
      sessionId,
      turnScopeId: scope.turnScopeId,
      messageUid: "source",
      commandId: "bind-upload",
      expectedAggregateVersion: 0,
      attachments: [attachment],
    },
  });
  const meta = request(2, "parse-source", {
    userMetaParsedResult: { messageUid: "source", result: parsed },
  });
  const page = (reader, snapshot) =>
    reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 1 });
  const publications = journal.work.publications;
  const [created, bound, updated] = await journal.usingSnapshot(async (old) => {
    const outcomes = await Promise.all(
      [create, binding, meta].map((item) => repository.commit(item)),
    );
    assert.equal(journal.work.publications, publications + 1);
    assert.deepEqual((await page(repository, old)).entries, []);
    return outcomes;
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(binding), { ...bound, replayed: true });
  assert.deepEqual(await reader.commit(meta), { ...updated, replayed: true });
  const {
    entries: [entry],
  } = await reopened.usingSnapshot((snapshot) => page(reader, snapshot));
  assert.equal(entry.contentReference, created.result.messageReceipts[0].contentReference);
  assert.deepEqual(entry.message.attachments, [attachment]);
  assert.deepEqual(entry.message.userMetaParsedResults, [parsed]);
});
