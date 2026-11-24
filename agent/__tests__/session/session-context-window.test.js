/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageEntryKey,
} from "@noobot/session-protocol/partition-session-messages";
import { createContextScope, projectContextSource } from "@noobot/context-protocol";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

test("context window reads selected partition messages without full-history dependencies", async (t) => {
  await withProvisionedSessions(
    { userId: "u1", sessionIds: ["s1"] },
    async ({ runtime, session }) => {
      const repo = runtime.repositories.sessionRepository;
      const persistenceContext = repo.treePersistenceContext("u1", "s1");
      const historyLimit = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
      const messages = Array.from({ length: historyLimit + 3 }, (_, index) => ({
        messageUid: `message-${index}`,
        ts: "2026-11-12T00:00:00.000Z",
        sessionId: "s1",
        parentSessionId: "",
        parentDialogProcessId: "",
        userMessageId: `message-${index}`,
        role: "user",
        messageOrigin: "natural",
        content: `message ${index}`,
        dialogProcessId: `dialog-${index}`,
        turnScopeId: `turn-${index}`,
        attachments: [],
      }));
      await commitTestSessionChanges(runtime, {
        userId: "u1",
        sessionId: "s1",
        changes: { messages },
      });
      const full = await repo.requireById("u1", "s1", { persistenceContext });
      const scope = createContextScope(full.messages.at(-1));
      const expected = projectContextSource({ source: full, scope, historyLimit });
      const original = PartitionTransactions.prototype.withCollectionReader;
      const guard = (read) =>
        Object.assign((query) => {
          if (query.collection === PARTITION_MESSAGE_COLLECTIONS.content)
            assert.ok(
              !query.keys.some((key) => JSON.parse(key)[0] === "message-0"),
              "unselected historical body must not be read",
            );
          return read(query);
        }, read);
      t.mock.method(
        PartitionTransactions.prototype,
        "withCollectionReader",
        function (snapshot, operation, options) {
          return original.call(this, snapshot, (read) => operation(guard(read)), options);
        },
      );
      t.mock.method(repo, "findById", () => {
        throw new Error("full history read is forbidden");
      });
      const actual = await session.getContextProjection({
        userId: "u1",
        sessionId: "s1",
        persistenceScope: null,
        currentTurnScopeId: scope.turnScopeId,
        currentDialogProcessId: scope.dialogProcessId,
      });
      assert.deepEqual(actual, expected);
      assert.equal(actual.messages.length, historyLimit);
      await assert.rejects(
        repo.withSessionReader(
          "u1",
          "s1",
          ({ reader }) =>
            reader.readMessageContentPage({
              messageUid: "message-0",
              byteOffset: 0,
              maxBytes: 64,
              expectedContentReference: null,
            }),
          { persistenceContext },
        ),
        /unselected historical body/,
      );
      assert.throws(
        () =>
          guard(() => {})({
            collection: PARTITION_MESSAGE_COLLECTIONS.content,
            keys: [partitionMessageEntryKey(PARTITION_MESSAGE_COLLECTIONS.content, "message-0", 1)],
          }),
        /unselected historical body/,
      );
    },
  );
});
