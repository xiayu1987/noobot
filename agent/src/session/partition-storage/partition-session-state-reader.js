/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readPartitionCommandReceipt,
  readPartitionDialog,
  readPartitionEventSequence,
  readPartitionLifecycleHeader,
  readPartitionScopedMetadata,
  readPartitionTurnDescriptor,
  readPartitionTurnState,
} from "@noobot/session-protocol/partition-session-state";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { capturePartitionSessionScope } from "@noobot/session-protocol/partition-transaction";
import { readPartitionDialogTurnPage } from "@noobot/session-protocol/partition-session-dialogs";
import { readPartitionReplacement } from "@noobot/session-protocol/partition-turn-visibility";
import {
  readTurnLifecycleReplacements,
  requireTurnLifecycleSourceSelection,
} from "@noobot/session-protocol/turn-lifecycle";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { PartitionTransactions } from "./partition-transactions.js";
import { readPartitionMutationProjection } from "./partition-mutation-projection.js";
import { partitionLifecycleIndex } from "./partition-lifecycle-index.js";
import { readPartitionTurnTiming } from "./partition-turn-timings.js";
import { readTurnPosition } from "./partition-message-reader.js";

export class PartitionSessionStateReader {
  #transactions;
  #collections;

  constructor(journal, scope) {
    this.#transactions = new PartitionSessionTransactions(journal, scope);
    this.#collections = new PartitionTransactions(journal);
  }

  readScopedMetadata(snapshot) {
    return this.#transactions.read(snapshot, readPartitionScopedMetadata);
  }

  async readLifecycleSource(snapshot, options) {
    const { terminalLimit, reconcileTurnScopeIds } = requireTurnLifecycleSourceSelection(options);
    return this.#transactions.read(
      snapshot,
      async (read, scope, { generation, aggregateVersion }) => {
        const get = async (collection, key) =>
          (await read({ collection, keys: [key] })).get(key)?.value ?? null;
        const header = await readPartitionLifecycleHeader(read);
        const selected = await partitionLifecycleIndex.read(get, { terminalLimit });
        const scopes = new Set(selected.map(({ turnScopeId }) => turnScopeId));
        if (header.activeTurnScopeId) scopes.add(header.activeTurnScopeId);
        const turns = {};
        const messageTurns = [];
        const turnTimings = [];
        const checkMessage = (record, messageUid) =>
          checkPartitionMessageStorage(record, {
            snapshot,
            scope,
            messageUid,
            generation: snapshot.sequence,
          });
        for (const turnScopeId of scopes) {
          const turn = await readPartitionTurnState(read, turnScopeId, header, checkMessage);
          if (turn === null)
            throw partitionJournalError(
              "SESSION_STORAGE_CORRUPT",
              "Lifecycle window references a missing turn",
            );
          Object.defineProperty(turns, turnScopeId, { value: turn, enumerable: true });
          const timing = await readPartitionTurnTiming(read, turnScopeId, snapshot, scope);
          if (timing !== null) turnTimings.push(timing);
          const descriptor = await readPartitionTurnDescriptor(read, turnScopeId, checkMessage);
          if (descriptor === null) continue;
          const first = await readTurnPosition(
            read,
            {
              snapshot,
              scope,
              generation: snapshot.sequence,
              turnScopeId,
              dialogProcessId: descriptor.dialogProcessId,
            },
            1,
          );
          messageTurns.push([turnScopeId, first.sessionOrdinal]);
        }
        messageTurns.sort((left, right) => left[1] - right[1]);
        const replacedTurns = await readTurnLifecycleReplacements({
          sequence: header.sequence,
          turnScopeIds: reconcileTurnScopeIds,
          read: (turnScopeId) =>
            readPartitionReplacement(get, {
              sessionId: scope.sessionId,
              turnScopeId,
              lifecycleSequence: header.sequence,
            }),
          invalid: (message) => partitionJournalError("SESSION_STORAGE_CORRUPT", message),
        });
        return {
          sessionId: scope.sessionId,
          generation,
          aggregateVersion,
          messageTurnScopeIds: messageTurns.map(([turnScopeId]) => turnScopeId),
          turnLifecycle: {
            sequence: header.sequence,
            activeTurnScopeId: header.activeTurnScopeId,
            turns,
            replacedTurns,
            commandReceipts: [],
          },
          turnTimings,
        };
      },
    );
  }

  readLifecycleHead(snapshot) {
    return this.#transactions.read(snapshot, async (read, scope) => {
      const header = await readPartitionLifecycleHeader(read);
      if (header.activeTurnScopeId) {
        const active = await readPartitionTurnState(
          read,
          header.activeTurnScopeId,
          header,
          (record, messageUid) =>
            checkPartitionMessageStorage(record, {
              snapshot,
              scope,
              messageUid,
              generation: snapshot.sequence,
            }),
        );
        if (active === null)
          throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing active lifecycle turn");
      }
      return header;
    });
  }

  readTurnState(snapshot, turnScopeId) {
    return this.#transactions.read(snapshot, async (read, scope) =>
      readPartitionTurnState(
        read,
        turnScopeId,
        await readPartitionLifecycleHeader(read),
        (record, messageUid) =>
          checkPartitionMessageStorage(record, {
            snapshot,
            scope,
            messageUid,
            generation: snapshot.sequence,
          }),
      ),
    );
  }

  readTurnReplacement(snapshot, turnScopeId) {
    return this.#transactions.read(snapshot, async (read, { sessionId }) => {
      const { sequence: lifecycleSequence } = await readPartitionLifecycleHeader(read);
      return readPartitionReplacement(
        async (collection, key) =>
          (await read({ collection, keys: [key] })).get(key)?.value ?? null,
        { sessionId, turnScopeId, lifecycleSequence },
      );
    });
  }

  readTurnDescriptor(snapshot, turnScopeId) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionTurnDescriptor(read, turnScopeId, (record, messageUid) =>
        checkPartitionMessageStorage(record, {
          snapshot,
          scope,
          messageUid,
          generation: snapshot.sequence,
        }),
      ),
    );
  }

  readEventSequence(snapshot, domain, scopeId) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionEventSequence(read, { sessionId: scope.sessionId, domain, scopeId }),
    );
  }

  readCommand(snapshot, commandId) {
    return this.#transactions.read(snapshot, (read) =>
      readPartitionCommandReceipt(read, commandId),
    );
  }

  async readMutationProjection(snapshot, commandId) {
    const metadata = await this.#transactions.readMetadata(snapshot);
    const scope = capturePartitionSessionScope(metadata);
    return readPartitionMutationProjection(this.#collections, snapshot, scope, commandId);
  }

  readDialog(snapshot, dialogProcessId) {
    return this.#transactions.read(snapshot, (read) => readPartitionDialog(read, dialogProcessId));
  }

  readDialogTurnPage(snapshot, options) {
    return this.#transactions.read(snapshot, (read) =>
      readPartitionDialogTurnPage(read, snapshot, options),
    );
  }
}
