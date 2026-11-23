/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionReaderAccess,
  createSessionReaderLifecycle,
  planSessionOutboxMutation,
  requirePartitionSessionAuthority,
} from "@noobot/session-protocol/session-reader";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";
import { isFunction } from "@noobot/shared/value";
import { createSessionNotFoundError } from "@noobot/session-protocol";
import { readJournalHead } from "./journal-io.js";
import {
  PARTITION_SESSION_METADATA,
  assertPartitionStoredSessionMetadata,
  preparePartitionSessionCommitRequest,
} from "@noobot/session-protocol/partition-transaction";
import { requirePreparedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { isUnpublishedPartitionSession } from "@noobot/session-protocol/partition-session-initialization";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { PartitionTransactions } from "./partition-transactions.js";
import { PartitionSessionMessages } from "./partition-session-messages.js";
import { PartitionSessionStateReader } from "./partition-session-state-reader.js";
import {
  partitionMigrationRoot,
  readPartitionStorageRoot,
  readSessionStorageAuthority,
} from "../session-storage-authority.js";
import {
  openPartitionSessionReader,
  withPartitionSessionReader,
} from "./partition-session-reader.js";

export function createPartitionSessionReaderAccess({ acquireJournal, withJournalRemoval }) {
  if (!isFunction(acquireJournal) || !isFunction(withJournalRemoval))
    throw new TypeError("Partition access requires journal acquisition and removal");
  const access = createSessionReaderAccess({
    async withRemoval({ sessionDir }, remove) {
      const facts = await readSessionStorageAuthority(sessionDir);
      if (!requirePartitionSessionAuthority(facts))
        throw partitionJournalError(
          "SESSION_STORAGE_CORRUPT",
          "Deletion target has no partition authority",
        );
      const root = facts.migration === undefined ? sessionDir : partitionMigrationRoot(sessionDir);
      return withJournalRemoval({ sessionDir, root }, remove);
    },
    async create(scope, initialization) {
      await using lease = await acquireJournal(scope, { create: true });
      const { journal } = lease;
      const messages = new PartitionSessionMessages(journal, scope);
      const request = await journal.usingSnapshot((snapshot) =>
        messages.prepareInitialization(snapshot, initialization),
      );
      return await messages.initialize(request);
    },
    async recover(scope) {
      if ((await access.readPlacement(scope)) === null) return null;
      return access.open(scope);
    },
    async readPlacement(scope) {
      const { sessionDir } = scope;
      const root = await readPartitionStorageRoot(sessionDir);
      if (root === null) return null;
      const sessionId =
        scope.sessionId ?? (await readJournalHead(root, { readBytes: 0 })).sessionId;
      await using lease = await acquireJournal({ ...scope, sessionId });
      const { journal } = lease;
      return await journal.withPublicationSnapshot(async (snapshot) => {
        const { collection, key } = PARTITION_SESSION_METADATA;
        const entry = (
          await new PartitionTransactions(journal).getLatestMany({
            snapshot,
            collection,
            keys: [key],
          })
        ).get(key);
        const metadata = entry === null || entry.remove ? null : entry.value;
        if (isUnpublishedPartitionSession(snapshot, metadata, sessionId)) return null;
        assertPartitionStoredSessionMetadata(snapshot, metadata, {
          sessionId,
          parentSessionId: metadata?.parentSessionId,
        });
        return metadata;
      });
    },
    async openArtifact({ sessionDir }) {
      const placement = await access.readPlacement({ sessionDir });
      if (placement === null) throw createSessionNotFoundError();
      return access.open({ sessionDir, ...placement });
    },
    async open(scope) {
      const lease = await acquireJournal(scope);
      try {
        const reader = await openPartitionSessionReader({ ...scope, journal: lease.journal });
        const methods = Object.fromEntries(
          Object.entries(reader).filter(([name]) => name !== "close" && name !== "generation"),
        );
        return createSessionReaderLifecycle({
          generation: reader.generation,
          methods,
          async release({ scopeExit }) {
            if (scopeExit) {
              await withStorageCleanup(reader[Symbol.asyncDispose], lease.release);
              return;
            }
            await reader.close();
            await lease.release();
          },
        });
      } catch (cause) {
        return withStorageCleanup(
          async () => {
            throw cause;
          },
          () => lease.release(),
        );
      }
    },
    async withCommit(scope, run) {
      await using lease = await acquireJournal(scope);
      const { journal } = lease;
      const messages = new PartitionSessionMessages(journal, scope);
      const position = await journal.withPublicationSnapshot(({ epoch, sequence, limits }) => ({
        epoch,
        sequence,
        limits,
      }));
      await using transaction = createSessionReaderLifecycle({
        generation: position.sequence,
        methods: {
          prepareRequest: (command) => preparePartitionSessionCommitRequest(position, command),
          commitChanges: (request) => messages.commit(requirePreparedSessionCommitRequest(request)),
        },
        release: async () => {},
      });
      return await run({
        prepareRequest: transaction.prepareRequest,
        commitChanges: transaction.commitChanges,
      });
    },
    async withOutboxMutation(scope, plan) {
      await using lease = await acquireJournal(scope);
      const { journal } = lease;
      const messages = new PartitionSessionMessages(journal, scope);
      const state = new PartitionSessionStateReader(journal, scope);
      const complete = await journal.withPublicationSnapshot((snapshot) =>
        journal.withRecordReader(snapshot, () =>
          planSessionOutboxMutation(
            {
              generation: snapshot.sequence,
              methods: {
                readMetadata: () => messages.readMetadata({ snapshot }),
                readEventSequence: (domain, scopeId) =>
                  state.readEventSequence(snapshot, domain, scopeId),
                readPluginArtifact: (identity) =>
                  messages.readPluginArtifact({ ...identity, snapshot }),
                readOutboxPage: (query) => messages.readOutboxPage({ ...query, snapshot }),
                readOutboxEvent: (eventId) => messages.readOutboxEvent({ snapshot, eventId }),
                prepareRequest: (command) => messages.prepareRequest(snapshot, command),
              },
            },
            plan,
          ),
        ),
      );
      return await complete((request) =>
        messages.commit(requirePreparedSessionCommitRequest(request)),
      );
    },
    async withMutation(scope, run) {
      await using lease = await acquireJournal(scope);
      return await withPartitionSessionReader({ ...scope, journal: lease.journal }, run);
    },
  });
  return access;
}
