/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { after } from "node:test";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { journalTestLimits } from "./partition-journal-cases.js";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";

const owner = new PartitionJournalOwner({
  durableAncestor: tmpdir(),
  limits: journalTestLimits({
    transactionBytes: 1024 * 1024,
    batchBytes: 1024 * 1024,
    queueBytes: 2 * 1024 * 1024,
    partitionBytes: 4 * 1024 * 1024,
    receiptBytes: 1024 * 1024,
    pageBytes: 1024 * 1024,
    entityProjectionBytes: 2 * 1024 * 1024,
  }),
  maxJournals: 64,
});
after(() => owner.close());
export const partitionReaderAccess = createPartitionSessionReaderAccess({
  acquireJournal: owner.acquire.bind(owner),
  withJournalRemoval: owner.withRemoval.bind(owner),
});

export async function initializePartitionReaderFixture({
  sessionDir,
  session,
  operationId = randomUUID(),
  fixtureChanges = [],
  ...input
}) {
  const normalized = normalizeSessionEntity(session);
  const scope = {
    sessionDir,
    sessionId: normalized.sessionId,
    parentSessionId: normalized.parentSessionId,
  };
  const {
    messages,
    turnTimings,
    sessionArtifactEvents,
    turnLifecycle,
    turnSummaryCheckpoints,
    autoTitle: _autoTitle,
    dialogOrder: _dialogOrder,
    ...metadata
  } = normalized;
  if (
    turnLifecycle.sequence !== 0 ||
    sessionArtifactEvents.length ||
    Object.keys(turnSummaryCheckpoints ?? {}).length
  )
    throw new TypeError("Seed lifecycle and artifact facts through partition commands");
  await partitionReaderAccess.create(scope, {
    ...input,
    session: {
      ...metadata,
      aggregateVersion: 0,
      updatedAt: metadata.createdAt,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
    },
    operationId,
    scopedMetadata: input.scopedMetadata ?? null,
  });
  await using lease = await owner.acquire(scope);
  const { journal } = lease;
  await new PartitionSessionTransactions(journal, scope).commit(
    {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      operationId: `${operationId}:seed-metadata`,
      input: metadata,
    },
    async (_snapshot, view, value) => {
      const { collection, key } = PARTITION_SESSION_METADATA;
      const current = (await view.getLatestMany({ collection, keys: [key] })).get(key);
      return {
        action: "commit",
        mutations: [{ collection, key, owner: current.owner, value }],
        result: null,
      };
    },
  );
  for (const [index, message] of messages.entries()) {
    await partitionReaderAccess.withMutation(scope, async (reader, commit) =>
      commit(
        await reader.prepareRequest({
          operationId: `${operationId}:message:${index}`,
          committedAt: metadata.updatedAt,
          changes: { messages: [message] },
        }),
      ),
    );
  }
  for (const [index, changes] of fixtureChanges.entries()) {
    const committed = await partitionReaderAccess.withMutation(scope, async (reader, commit) =>
      commit(
        await reader.prepareRequest({
          operationId: `${operationId}:command:${index}`,
          committedAt: metadata.updatedAt,
          changes,
        }),
      ),
    );
    if (changes.turnTransition && !committed.result.turnTransition.applied)
      throw new Error(`Fixture transition rejected: ${committed.result.turnTransition.reason}`);
  }
  if (turnTimings.length) {
    await partitionReaderAccess.withMutation(scope, async (reader, commit) =>
      commit(
        await reader.prepareRequest({
          operationId: `${operationId}:timings`,
          committedAt: metadata.updatedAt,
          changes: { timings: turnTimings },
        }),
      ),
    );
  }
  await using reader = await partitionReaderAccess.open(scope);
  return { session: await reader.exportSession() };
}

export const openPartitionReaderFixture = (scope) => partitionReaderAccess.open(scope);
export const withPartitionReaderFixture = (scope, run) =>
  partitionReaderAccess.withMutation(scope, run);
export const createPartitionReaderFixture = ({ scope, ...input }) =>
  partitionReaderAccess.create(scope, input);
