/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { partitionMessageContentVersion } from "@noobot/session-protocol/partition-session-messages";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const identity = { dialogProcessId: "dialog", turnScopeId: "turn" };

function prepare(journal, repository, operationId, changes) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, { operationId, committedAt, changes }),
  );
}

for (const [name, damage] of [
  [
    "embedded content",
    (record) => ({ ...record, message: { ...record.message, content: "body" } }),
  ],
  ["chunk start", (record) => ({ ...record, firstChunk: 0 })],
  ["chunk end", (record) => ({ ...record, lastChunk: 0 })],
  ["chunk integer", (record) => ({ ...record, lastChunk: 1.5 })],
  [
    "content epoch",
    (record) => ({
      ...record,
      contentVersion: partitionMessageContentVersion("f".repeat(32), 1, 0),
    }),
  ],
  [
    "content generation",
    (record) => ({
      ...record,
      contentVersion: partitionMessageContentVersion(
        record.contentVersion.split(":")[1],
        Number.MAX_SAFE_INTEGER,
        0,
      ),
    }),
  ],
  [
    "next unpublished generation",
    (record, snapshot) => ({
      ...record,
      contentVersion: partitionMessageContentVersion(snapshot.epoch, snapshot.sequence + 2, 0),
    }),
  ],
  [
    "message identity",
    (record) => ({ ...record, message: { ...record.message, modelMessageId: "" } }),
  ],
]) {
  for (const replay of [false, true]) {
    test(`cold checkpoint ${replay ? "replay" : "commit"} rejects corrupt ${name} atomically`, async (t) => {
      const { journal, root, sessionId } = await createTransactionCase(t, {
        transactionBytes: 16 * 1024,
      });
      const scope = { sessionId, parentSessionId: "" };
      await initializePartitionSession(journal, scope, committedAt);
      const repository = new PartitionSessionMessages(journal, scope);
      await repository.commit(
        await prepare(journal, repository, "seed", {
          messages: [
            {
              ...scope,
              ...identity,
              messageUid: "message",
              modelMessageId: "model-message",
              presentationMessageId: "presentation-message",
              role: "assistant",
              type: "message",
              content: "body",
              attachments: [],
              ts: committedAt,
            },
          ],
          turnTransition: {
            sessionId,
            ...identity,
            commandId: "seed",
            causationId: "seed",
            eventType: "turn.action_accepted",
            phase: "action",
            action: "send",
            presentationMessageId: "presentation",
            executionId: "agent:turn",
            executionKind: "agent",
            rootExecutionId: "agent:turn",
          },
        }),
      );
      const checkpoint = {
        sessionId,
        ...identity,
        userId: "admin",
        checkpointId: "summary",
        expectedCheckpointRevision: 0,
        messages: [],
        persistedMessageUids: [],
        summarizedMessageUids: ["message"],
        retainedMessageUids: [],
      };
      if (replay)
        await repository.commit(
          await prepare(journal, repository, "summarize", { summaryCheckpoints: [checkpoint] }),
        );
      const transactions = new PartitionTransactions(journal);
      await journal.usingSnapshot(async (snapshot) => {
        const entry = (
          await transactions.lookupLatestMany({
            snapshot,
            collection: "messages",
            keys: ["message"],
          })
        ).get("message");
        const mutation = (
          await transactions.getLatestMany({ snapshot, collection: "messages", keys: ["message"] })
        ).get("message");
        await commitFixtureTransaction(transactions, {
          epoch: snapshot.epoch,
          expectedGeneration: snapshot.sequence,
          sequence: snapshot.sequence + 1,
          operationId: "damage",
          input: {},
          result: null,
          mutations: [
            {
              collection: "messages",
              key: "message",
              owner: entry.owner,
              value: damage(mutation.value, snapshot),
            },
          ],
        });
      });
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      const reader = new PartitionSessionMessages(cold, scope);
      const before = await readFile(`${root}/CURRENT`);
      const request = await prepare(cold, reader, "reject-corruption", {
        sessionMetadata: { customTitle: "must not publish" },
        summaryCheckpoints: [checkpoint],
      });
      const [outcome] = await Promise.allSettled([reader.commit(request)]);
      if (outcome.status === "rejected") await assert.rejects(cold.close(), outcome.reason);
      else await cold.close();
      assert.equal(outcome.status, "rejected");
      assert.equal(outcome.reason.code, "SESSION_STORAGE_CORRUPT");
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
      const recovered = await PartitionJournal.open({ root, sessionId });
      t.after(() => recovered.close());
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    });
  }
}
