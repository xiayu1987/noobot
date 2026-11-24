/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";

const identity = { userId: "u1", sessionId: "s1", persistenceScope: null };

function guardContentQueries(query) {
  return Object.assign(
    async (input) => {
      assert.notEqual(input.collection, PARTITION_MESSAGE_COLLECTIONS.content);
      return query(input);
    },
    { readWindow: query.readWindow },
  );
}

test("user meta reuses source content without reading or encoding any message body", async (t) =>
  withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ session, runtime }) => {
    for (const turnScopeId of ["source", "unrelated"])
      await session.appendTurns({
        ...identity,
        turns: [
          {
            role: "user",
            messageOrigin: "natural",
            messageUid: `sm_${turnScopeId}`,
            dialogProcessId: turnScopeId,
            turnScopeId,
            attachments: [],
            transferEnvelopes: [],
            content: turnScopeId === "source" ? "source 中文".repeat(1000) : turnScopeId,
          },
        ],
      });
    const repository = runtime.repositories.sessionRepository;
    const options = { persistenceContext: repository.treePersistenceContext("u1", "s1") };
    for (let index = 1; index < 20; index += 1) {
      await using current = await repository.requireSessionReader("u1", "s1", options);
      const entry = await current.readMessageEntry({ messageUid: "sm_source" });
      await commitTestSessionChanges(runtime, {
        ...identity,
        changes: {
          messageContentAppends: [
            {
              messageUid: "sm_source",
              dialogProcessId: "source",
              turnScopeId: "source",
              owner: entry.owner,
              expectedContentReference: entry.contentReference,
              content: "source 中文".repeat(1000),
            },
          ],
        },
      });
    }
    await using beforeReader = await repository.requireSessionReader("u1", "s1", options);
    const before = await beforeReader.readMetadata();
    const read = PartitionTransactions.prototype.withCollectionReader;
    const bodyReads = t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, operation, options) {
        return read.call(this, snapshot, (query) => operation(guardContentQueries(query)), options);
      },
    );
    const commit = PartitionTransactions.prototype.commit;
    const bodyWrites = t.mock.method(
      PartitionTransactions.prototype,
      "commit",
      function (request, callbacks) {
        return commit.call(this, request, {
          ...callbacks,
          async prepare(...args) {
            const plan = await callbacks.prepare(...args);
            for (const mutation of plan.mutations ?? [])
              assert.notEqual(mutation.collection, PARTITION_MESSAGE_COLLECTIONS.content);
            return plan;
          },
        });
      },
    );
    const original = repository.findById;
    repository.findById = () => {
      throw new Error("user meta must use the source turn view");
    };
    const result = { sourceAttachmentRef: "attach://source", summary: "parsed source" };
    try {
      await session.recordUserMetaParsedResult({
        ...identity,
        userMetaSourceMessageUid: "sm_source",
        result,
      });
      await assert.rejects(
        session.recordUserMetaParsedResult({
          ...identity,
          userMetaSourceMessageUid: "sm_missing",
          result,
        }),
        { code: "USER_META_SOURCE_NOT_FOUND" },
      );
    } finally {
      repository.findById = original;
      bodyReads.mock.restore();
      bodyWrites.mock.restore();
    }
    await using afterReader = await repository.requireSessionReader("u1", "s1", options);
    const after = await afterReader.readMetadata();
    assert.equal(afterReader.generation, beforeReader.generation + 1);
    assert.equal(after.aggregateVersion, before.aggregateVersion);
    assert.ok(Date.parse(after.updatedAt) >= Date.parse(before.updatedAt));
    assert.deepEqual(
      (await afterReader.readMessageEntry({ messageUid: "sm_source" })).message
        .userMetaParsedResults,
      [result],
    );
    assert.equal(
      (await afterReader.readMessages({ messageUids: ["sm_unrelated"] }))[0].message.content,
      "unrelated",
    );
    const { contentReference } = await beforeReader.readMessageEntry({ messageUid: "sm_source" });
    const chunks = [];
    let cursor = null;
    let page;
    do {
      page = await afterReader.readContentPage({
        messageUid: "sm_source",
        dialogProcessId: "source",
        turnScopeId: "source",
        contentReference,
        cursor,
        limit: 1,
      });
      chunks.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.equal(chunks.join(""), "source 中文".repeat(20000));
    assert.equal(
      (await beforeReader.readMessageEntry({ messageUid: "sm_source" })).message
        .userMetaParsedResults,
      undefined,
    );
  }));
