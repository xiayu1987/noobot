/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-19T00:00:00.000Z";

const scope = { dialogProcessId: "dialog-1", turnScopeId: "turn-1" };

function message(sessionId, messageUid) {
  return {
    ...scope,
    sessionId,
    messageUid,
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    role: "assistant",
    type: "message",
    content: messageUid,
    attachments: [],
    ts: committedAt,
  };
}

function prepare(journal, repository, operationId, changes) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, {
      operationId,
      committedAt,
      changes,
    }),
  );
}

function openTestMessages(journal, sessionId) {
  return new PartitionSessionMessages(journal, { sessionId, parentSessionId: "" });
}

function bootstrap(journal, sessionId, parentSessionId) {
  return initializePartitionSession(journal, { sessionId, parentSessionId }, committedAt);
}

async function createMessageCase(t, limits, options) {
  const fixture = await createTransactionCase(t, limits, options);
  await bootstrap(fixture.journal, fixture.sessionId, "");
  return fixture;
}

async function publishInvalidMessageHeader(t, fields) {
  const { journal, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  const first = message(sessionId, "m1");
  const created = await repository.commit(
    await prepare(journal, repository, "create", { messages: [first] }),
  );
  const collection = PARTITION_MESSAGE_COLLECTIONS.messages;
  const [entry, value] = await journal.usingSnapshot(async (snapshot) => {
    const query = { snapshot, collection, keys: [first.messageUid] };
    const entries = await transactions.lookupLatestMany(query);
    const values = await transactions.getLatestMany(query);
    return [entries.get(first.messageUid), values.get(first.messageUid).value];
  });
  await commitFixtureTransaction(transactions, {
    epoch: created.reference.epoch,
    expectedGeneration: created.generation,
    sequence: created.generation + 1,
    operationId: "persist-invalid-header",
    input: {},
    mutations: [
      {
        collection,
        key: first.messageUid,
        owner: entry.owner,
        value: { ...value, message: { ...value.message, ...fields } },
      },
    ],
    result: null,
  });
  return {
    journal,
    repository,
    messageUid: first.messageUid,
    owner: entry.owner,
    contentReference: value.contentVersion,
  };
}

export {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
  bootstrap,
  publishInvalidMessageHeader,
};
