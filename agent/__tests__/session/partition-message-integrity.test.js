/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scope,
  prepare,
  publishInvalidMessageHeader,
  createMessageCase,
  openTestMessages,
  message,
} from "./partition-session-messages.test-helpers.js";

test("rejected plugin input leaves publication unchanged and permits a valid write and close", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const repository = openTestMessages(journal, sessionId);
  const valid = message(sessionId, "valid");
  const generation = journal.head.sequence;
  const publications = journal.work.publications;
  const invalid = {
    ...valid,
    pluginMeta: { pluginId: "workflow", payload: { nested: { transferEnvelopes: [] } } },
  };
  await assert.rejects(
    async () =>
      repository.commit(
        await prepare(journal, repository, "invalid-plugin", { messages: [invalid] }),
      ),
    { code: "PLUGIN_MESSAGE_PAYLOAD_INVALID" },
  );
  assert.equal(journal.head.sequence, generation);
  assert.equal(journal.work.publications, publications);
  const committed = await repository.commit(
    await prepare(journal, repository, "valid-plugin", { messages: [valid] }),
  );
  assert.equal(committed.generation, generation + 1);
  await journal.usingSnapshot(async (snapshot) => {
    const stored = await repository.readMessages({ snapshot, messageUids: [valid.messageUid] });
    assert.equal(stored[0].message.messageUid, valid.messageUid);
    assert.equal(stored[0].message.content, valid.content);
  });
  await journal.close();
});

test("a persisted message with a foreign parent cannot be read or appended", async (t) => {
  const { journal, repository, messageUid, owner, contentReference } =
    await publishInvalidMessageHeader(t, { parentSessionId: "foreign-parent" });
  const failure = { code: "SESSION_STORAGE_CORRUPT" };
  await journal.usingSnapshot(async (snapshot) => {
    const page = { snapshot, ...scope, cursor: null, limit: 1 };
    await assert.rejects(repository.readTurnPage(page), failure);
    await assert.rejects(
      repository.readMessages({ snapshot, messageUids: ["absent", messageUid] }),
      failure,
    );
    await assert.rejects(
      repository.readContentPage({ ...page, messageUid, contentReference }),
      failure,
    );
  });
  const request = await prepare(journal, repository, "append", {
    messageContentAppends: [
      { ...scope, messageUid, owner, expectedContentReference: contentReference, content: "!" },
    ],
  });
  const before = journal.work.publications;
  await assert.rejects(repository.commit(request), failure);
  await assert.rejects(journal.close(), failure);
  assert.equal(journal.work.publications, before);
});

test("invalid persisted message metadata stops writes rather than rejecting only the update", async (t) => {
  const { journal, repository, messageUid, contentReference, owner } =
    await publishInvalidMessageHeader(t, {
      workspaceRootDirectory: "/workspace",
    });
  const request = await prepare(journal, repository, "update", {
    messageMetadataUpdates: [
      {
        ...scope,
        messageUid,
        owner,
        expectedContentReference: contentReference,
        metadata: {},
        metadataRemovals: ["workspaceRootDirectory"],
      },
    ],
  });
  const publications = journal.work.publications;
  const failure = { code: "SESSION_STORAGE_CORRUPT", message: /workspace_root_requires/ };
  await assert.rejects(repository.commit(request), failure);
  await assert.rejects(journal.close(), failure);
  assert.equal(journal.work.publications, publications);
  await journal.usingSnapshot((snapshot) =>
    assert.equal(snapshot.sequence, request.expectedGeneration),
  );
});

for (const change of [
  "messageContentAppends",
  "messageContentReplacements",
  "messageMetadataUpdates",
]) {
  test(`published malformed transfer references block paging and ${change}`, async (t) => {
    const { journal, repository, messageUid, contentReference, owner } =
      await publishInvalidMessageHeader(t, {
        transferEnvelopes: [{}],
      });
    const selection = { ...scope, messageUid, contentReference, cursor: null, limit: 1 };
    const failure = { code: "SESSION_STORAGE_CORRUPT", message: /invalid_transfer_envelope/ };
    await journal.usingSnapshot(async (snapshot) => {
      await assert.rejects(
        repository.readTurnPage({ ...scope, snapshot, cursor: null, limit: 1 }),
        failure,
      );
      await assert.rejects(repository.readContentPage({ ...selection, snapshot }), failure);
      await assert.rejects(
        repository.readMessages({ snapshot, messageUids: [messageUid, "absent"] }),
        failure,
      );
    });
    const request = await prepare(journal, repository, "update", {
      [change]: [
        {
          ...scope,
          messageUid,
          owner,
          expectedContentReference: contentReference,
          ...(change === "messageMetadataUpdates"
            ? { metadata: {}, metadataRemovals: ["transferEnvelopes"] }
            : { content: "new body" }),
        },
      ],
    });
    const publications = journal.work.publications;
    await assert.rejects(repository.commit(request), failure);
    await assert.rejects(journal.close(), failure);
    assert.equal(journal.work.publications, publications);
    await journal.usingSnapshot((snapshot) =>
      assert.equal(snapshot.sequence, request.expectedGeneration),
    );
  });
}
