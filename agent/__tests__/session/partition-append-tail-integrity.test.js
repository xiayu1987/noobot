/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  message,
  prepare,
  publishInvalidMessageHeader,
} from "./partition-session-messages.test-helpers.js";

for (const fields of [
  { parentSessionId: "foreign-parent" },
  { workspaceRootDirectory: "/workspace" },
  { transferEnvelopes: [{}] },
]) {
  test(`new message creation rejects malformed existing tail ${Object.keys(fields)[0]}`, async (t) => {
    const { journal, repository } = await publishInvalidMessageHeader(t, fields);
    const request = await prepare(journal, repository, "create-after-corrupt-tail", {
      messages: [message(journal.head.sessionId, "unpublished")],
    });
    const before = structuredClone(journal.head);
    const publications = journal.work.publications;
    const failure = { code: "SESSION_STORAGE_CORRUPT" };
    await assert.rejects(repository.commit(request), failure);
    await assert.rejects(journal.close(), failure);
    assert.deepEqual(journal.head, before);
    assert.equal(journal.work.publications, publications);
    await journal.usingSnapshot(async (snapshot) => {
      const values = await new PartitionTransactions(journal).getLatestMany({
        snapshot,
        collection: "messages",
        keys: ["unpublished"],
      });
      assert.equal(values.get("unpublished"), null);
    });
  });
}
