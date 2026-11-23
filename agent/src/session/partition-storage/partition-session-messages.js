/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeStoredAuthorityOutboxEvent } from "@noobot/event-protocol/outbox";
import { requiresThinkingDetailMessageContent } from "@noobot/event-protocol/thinking-detail-content";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  PARTITION_MESSAGE_PAGE,
  projectPartitionMessageResult,
  projectPartitionMessageEntry,
  createPartitionMessagePage,
  createPartitionMessageSuffixPage,
  readPartitionMessagePositionVisibility as readMessagePositionVisibility,
  readPartitionSessionMessageCount as readSessionMessageCount,
  requirePartitionMessagePage,
  requirePartitionMessageTurnOwnership,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  createScopedTurnMessagePage,
  messageContentReadError,
  requireFirstTurnMessageRead,
  requireMessagePage,
  requireMessageReadSelection,
  requireMessageContentPage,
  requireScopedDisplayArtifactPage,
  requireScopedThinkingDetailPage,
  requireScopedTurnMessagePage,
  sessionMessagePageLength,
} from "@noobot/session-protocol/message-read-budget";
import { requireAttachmentBindingTarget } from "@noobot/session-protocol";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";
import { attachPartitionCheckpointMessageReceipts } from "./partition-summary-checkpoints.js";
import {
  readPartitionCheckpoint,
  readPartitionCheckpointState,
  readPartitionCheckpointPage,
} from "./partition-checkpoint-reader.js";
import { readPartitionTurnTiming } from "./partition-turn-timings.js";
import { readPartitionOutboxPage, readPartitionOutboxEvent } from "./partition-outbox.js";
import { readPartitionPluginArtifact } from "./partition-artifact-events.js";
import { readPartitionMessageDiagnosticPage } from "./partition-message-diagnostics.js";
import {
  checkMessage,
  materializeMessage,
  readMessageChunks,
  readSessionOrderEntries,
  readVisibleMessagePosition,
  readPartitionSuffixAnchor,
  readTurnPosition,
  readMaterializedTurnWindow,
  readTurnWindow,
} from "./partition-message-reader.js";
import { readPartitionContentBytes } from "./partition-message-content.js";
import { readPartitionListProjection } from "./partition-list-reader.js";
import { partitionDisplaySourceCounts } from "./partition-display-source-counts.js";
import {
  readPartitionDisplayPublicationPage,
  readPartitionDisplayStatistics,
} from "./partition-display-publication.js";
import { readPartitionDisplayArtifactPage } from "./partition-display-artifacts.js";
import { requireRetainedJournalSnapshotId } from "./journal-snapshots.js";

import {
  prepareIndexedMessages,
  prepareLiveMessages,
} from "./partition-message-transaction-plan.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

async function readOwnedTurn(read, turnScopeId) {
  const { turns, lifecycle } = await requirePartitionMessageTurnOwnership(read, [{ turnScopeId }]);
  const stored = turns.get(turnScopeId);
  if (stored === null || stored.mutation.remove) return null;
  return { ...stored.mutation.value, lifecycle: lifecycle.get(turnScopeId) };
}

function projectMessageResult(outcome, mutations) {
  return projectPartitionMessageResult(outcome, mutations, decodeStoredAuthorityOutboxEvent);
}

export class PartitionSessionMessages {
  #transactions;
  #journal;

  constructor(journal, scope) {
    this.#journal = journal;
    this.#transactions = new PartitionSessionTransactions(journal, scope);
  }

  prepareRequest(snapshot, request) {
    return this.#transactions.prepareRequest(snapshot, request);
  }

  prepareInitialization(snapshot, input) {
    return this.#transactions.prepareInitialization(snapshot, input);
  }

  initialize(request) {
    return this.#transactions.initialize(request, prepareLiveMessages, projectMessageResult);
  }

  async commit(request) {
    const outcome = await this.#transactions.commit(
      request,
      prepareLiveMessages,
      projectMessageResult,
    );
    return attachPartitionCheckpointMessageReceipts(
      this.#journal,
      this.#transactions,
      request,
      outcome,
    );
  }

  importMessage({ epoch, expectedGeneration, operationId, committedAt, message, sourceDialog }) {
    return this.#transactions.commit(
      { epoch, expectedGeneration, operationId, input: { committedAt, message, sourceDialog } },
      (snapshot, view, input, scope) =>
        prepareIndexedMessages({
          snapshot,
          view,
          input: { committedAt: input.committedAt, changes: { messages: [input.message] } },
          scope,
          sourceDialog: input.sourceDialog,
        }),
      projectMessageResult,
    );
  }

  readMetadata({ snapshot }) {
    return this.#transactions.readMetadata(snapshot);
  }

  readDisplayPage({ snapshot, selection }) {
    return this.#transactions.read(snapshot, (read, { parentSessionId }, { aggregateVersion }) =>
      readPartitionDisplayPublicationPage(
        read,
        { journal: this.#journal, snapshot, parentSessionId, aggregateVersion },
        selection,
      ),
    );
  }

  readDisplaySourceCounts({ snapshot }) {
    return this.#transactions.read(snapshot, async (read) =>
      partitionDisplaySourceCounts(await readPartitionDisplayStatistics(read)),
    );
  }

  readListProjection({ snapshot }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionListProjection({ read, snapshot, scope }),
    );
  }

  readFirstTurnMessage({ snapshot, turnScopeId, maxBytes }) {
    const budget = requireFirstTurnMessageRead({ turnScopeId, maxBytes });
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const turn = await readOwnedTurn(read, turnScopeId);
      if (turn === null) return null;
      const { dialogProcessId, lifecycle } = turn;
      const record = await readTurnPosition(
        read,
        { snapshot, scope, generation, turnScopeId, dialogProcessId },
        1,
      );
      const count = await readSessionMessageCount(read);
      const [visible] = await readMessagePositionVisibility(read, scope.sessionId, count, {
        records: [record],
      });
      if (!visible) corrupt("Partition turn references a hidden first message");
      return materializeMessage(read, {
        snapshot,
        record,
        lifecycle,
        budget,
      });
    });
  }

  #readVisibleMessage(snapshot, messageUid, project) {
    return this.#transactions.read(snapshot, async (read, scope) => {
      const stored = (
        await read({
          collection: collections.messages,
          keys: [messageUid],
          includeOwner: true,
        })
      ).get(messageUid);
      if (stored === null || stored.mutation.remove) return null;
      const visible = await readVisibleMessagePosition(
        read,
        scope.sessionId,
        checkMessage(stored.mutation.value, {
          snapshot,
          scope,
          messageUid,
          generation: snapshot.sequence,
        }),
      );
      if (visible === null) return null;
      return project(visible, stored.owner);
    });
  }

  readMessages({ snapshot, messageUids, maxBytes }) {
    const budget = requireMessageReadSelection({ messageUids, maxBytes });
    return this.#transactions.read(snapshot, async (read, scope) => {
      const stored = await read({ collection: collections.messages, keys: messageUids });
      const selected = messageUids.map((messageUid) => {
        const entry = stored.get(messageUid);
        return entry === null
          ? null
          : checkMessage(entry.value, {
              snapshot,
              scope,
              messageUid,
              generation: snapshot.sequence,
            });
      });
      const records = selected.filter((record) => record !== null);
      const count = await readSessionMessageCount(read);
      const visible = await readMessagePositionVisibility(read, scope.sessionId, count, {
        records,
      });
      const retained = visible.flatMap((isVisible, index) => (isVisible ? [records[index]] : []));
      const { lifecycle } = await requirePartitionVisibleMessageTurnOwnership(read, retained);
      const messages = new Map();
      for (const record of retained) {
        const { sessionOrdinal: ordinal, turnOrdinal } = record;
        budget.consume("bytes", Buffer.byteLength(JSON.stringify({ ordinal, turnOrdinal })));
        const message = await materializeMessage(read, {
          snapshot,
          record,
          lifecycle: lifecycle.get(record.message.turnScopeId),
          budget,
        });
        messages.set(message.messageUid, { ordinal, turnOrdinal, message });
      }
      return messageUids.map((messageUid) => messages.get(messageUid) ?? null);
    });
  }

  readMessageEntry({ snapshot, messageUid, maxBytes }) {
    const budget = requireMessageReadSelection({ messageUids: [messageUid], maxBytes });
    return this.#readVisibleMessage(snapshot, messageUid, ({ record, lifecycle }, owner) => {
      const entry = projectPartitionMessageEntry(record, lifecycle, owner);
      budget.consume("bytes", Buffer.byteLength(JSON.stringify(entry)));
      return entry;
    });
  }

  readVisibleBindingRecord({ snapshot, messageUid }) {
    return this.#readVisibleMessage(snapshot, messageUid, ({ record }) => record);
  }

  async readAttachmentBindingTarget({ snapshot, messageUid, turnScopeId }) {
    requireMessageReadSelection({ messageUids: [messageUid] });
    const message = await this.#readVisibleMessage(
      snapshot,
      messageUid,
      ({ record }) => record.message,
    );
    requireAttachmentBindingTarget(message, turnScopeId);
    return message.attachments;
  }

  readOutboxEvent({ snapshot, eventId }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionOutboxEvent(read, scope, snapshot, eventId),
    );
  }

  readOutboxPage({ snapshot, ...query }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionOutboxPage(read, scope, snapshot, query),
    );
  }

  readPluginArtifact({ snapshot, ...identity }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionPluginArtifact(read, identity, { snapshot, scope }),
    );
  }

  readMessageDiagnosticPage({ snapshot, dialogProcessId, ...options }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionMessageDiagnosticPage({ read, scope, snapshot, options, dialogProcessId }),
    );
  }

  readCheckpointState({ snapshot, turnScopeId }) {
    return this.#transactions.read(snapshot, (read) =>
      readPartitionCheckpointState(read, turnScopeId),
    );
  }

  readCheckpointPage({ snapshot, ...options }) {
    return this.#transactions.read(snapshot, (read) =>
      readPartitionCheckpointPage(read, snapshot, options),
    );
  }

  readCheckpoint({ snapshot, turnScopeId, checkpointId }) {
    return this.#transactions.read(snapshot, (read) =>
      readPartitionCheckpoint(read, turnScopeId, checkpointId),
    );
  }

  readTurnTiming({ snapshot, turnScopeId }) {
    return this.#transactions.read(snapshot, (read, scope) =>
      readPartitionTurnTiming(read, turnScopeId, snapshot, scope),
    );
  }

  readSessionMessageOrderPage({ snapshot, cursor, limit }) {
    return this.#transactions.read(snapshot, async (read, scope) => {
      const page = requirePartitionMessagePage(snapshot, PARTITION_MESSAGE_PAGE.sessionOrder, [], {
        cursor,
        limit,
      });
      const count = await readSessionMessageCount(read);
      const entries = await readSessionOrderEntries({ read, snapshot, scope, page, limit, count });
      return createPartitionMessagePage(
        snapshot,
        entries,
        page,
        page.after + entries.length < count,
      );
    });
  }

  readMessageSuffixPage({ snapshot, turnScopeId, cursor, limit }) {
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const page = requirePartitionMessagePage(
        snapshot,
        PARTITION_MESSAGE_PAGE.suffix,
        [turnScopeId],
        { cursor, limit },
      );
      const suffix = await readPartitionSuffixAnchor({
        read,
        snapshot,
        scope,
        turnScopeId,
        generation,
      });
      if (suffix === null) return null;
      const entries = await readSessionOrderEntries({
        read,
        snapshot,
        scope,
        page,
        limit,
        count: suffix.deletedCount,
        firstOrdinal: suffix.messageSuffix.firstOrdinal,
      });
      return createPartitionMessageSuffixPage(snapshot, entries, page, suffix);
    });
  }

  readTurnPage({ snapshot, dialogProcessId, turnScopeId, cursor, limit }) {
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const page = requirePartitionMessagePage(
        snapshot,
        PARTITION_MESSAGE_PAGE.turn,
        [dialogProcessId, turnScopeId],
        { cursor, limit },
      );
      const { turns, lifecycle } = await requirePartitionMessageTurnOwnership(read, [
        { turnScopeId, dialogProcessId },
      ]);
      const turn = turns.get(turnScopeId);
      if (turn === null || turn.mutation.remove) {
        sessionMessagePageLength(page.after, 0, limit);
        return createPartitionMessagePage(snapshot, [], page, false);
      }
      const total = turn.mutation.value.messageCount;
      const { records, owners } = await readTurnWindow(
        read,
        { snapshot, scope, generation, dialogProcessId, turnScopeId },
        page.after,
        sessionMessagePageLength(page.after, total, limit),
      );
      const turnLifecycle = lifecycle.get(turnScopeId);
      const entries = records.map((record) =>
        projectPartitionMessageEntry(
          record,
          turnLifecycle,
          owners.get(record.message.messageUid).owner,
        ),
      );
      return createPartitionMessagePage(
        snapshot,
        entries,
        page,
        page.after + entries.length < total,
      );
    });
  }

  readMaterializedTurnPage({
    snapshot,
    turnScopeId,
    after = 0,
    limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
    maxBytes,
  }) {
    const budget = requireMessagePage({ turnScopeId, after, limit, maxBytes });
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const turn = await readOwnedTurn(read, turnScopeId);
      if (turn === null) return null;
      const { dialogProcessId, messageCount: total, lifecycle } = turn;
      const length = Math.min(limit, snapshot.limits.pageRecords, Math.max(0, total - after));
      const records = await readMaterializedTurnWindow({
        read,
        identity: { snapshot, scope, generation, dialogProcessId, turnScopeId },
        after,
        length,
        lifecycle,
        budget,
      });
      const cursor = after + records.length;
      return { generation, records, cursor, hasMore: cursor < total };
    });
  }

  readScopedTurnMessagePage(options) {
    return this.#readScopedTurnPage(options, requireScopedTurnMessagePage);
  }

  readDisplayArtifactPage({ snapshot, ...options }) {
    const snapshotId = requireRetainedJournalSnapshotId(this.#journal, snapshot);
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const { key, position, budget } = requireScopedDisplayArtifactPage(
        { ...scope, snapshotId, generation },
        options,
      );
      const limit = Math.min(options.limit, snapshot.limits.pageRecords);
      const turn = await readOwnedTurn(read, key.turnScopeId);
      if (turn === null || turn.dialogProcessId !== key.dialogProcessId) {
        sessionMessagePageLength(position.after, 0, limit);
        return null;
      }
      return readPartitionDisplayArtifactPage(read, { snapshot, scope, generation, ...key }, turn, {
        position,
        budget,
        limit,
      });
    });
  }

  readThinkingDetailPage(options) {
    return this.#readScopedTurnPage(
      options,
      requireScopedThinkingDetailPage,
      requiresThinkingDetailMessageContent,
    );
  }

  #readScopedTurnPage(
    { snapshot, lookupKey, cursor, limit, maxBytes },
    requirePage,
    selectContent,
  ) {
    const { key, position, budget } = requirePage(
      [snapshot.sessionId, snapshot.epoch, snapshot.sequence],
      { lookupKey, cursor, limit, maxBytes },
    );
    const { turnScopeId, dialogProcessId } = key;
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const turn = await readOwnedTurn(read, turnScopeId);
      if (turn === null || turn.dialogProcessId !== dialogProcessId) {
        sessionMessagePageLength(position.after, 0, limit);
        return null;
      }
      const { messageCount, lifecycle } = turn;
      const length = sessionMessagePageLength(
        position.after,
        messageCount,
        Math.min(limit, snapshot.limits.pageRecords),
      );
      const records = await readMaterializedTurnWindow({
        read,
        identity: { snapshot, scope, generation, dialogProcessId, turnScopeId },
        after: position.after,
        length,
        lifecycle,
        budget,
        selectContent,
      });
      return createScopedTurnMessagePage({ generation, messageCount, records, position });
    });
  }

  readMessageContentPage({ snapshot, ...input }) {
    const selection = requireMessageContentPage(input);
    const { messageUid, expectedContentReference } = selection;
    return this.#transactions.read(snapshot, async (read, scope) => {
      const stored = (await read({ collection: collections.messages, keys: [messageUid] })).get(
        messageUid,
      );
      if (stored === null) return null;
      const record = checkMessage(stored.value, {
        snapshot,
        scope,
        messageUid,
        generation: snapshot.sequence,
      });
      if ((await readVisibleMessagePosition(read, scope.sessionId, record)) === null) return null;
      if (expectedContentReference !== null && record.contentVersion !== expectedContentReference)
        throw messageContentReadError("version", "Message content changed between pages");
      return readPartitionContentBytes(read, record, selection, snapshot.sequence);
    });
  }

  readContentPage({
    snapshot,
    dialogProcessId,
    turnScopeId,
    messageUid,
    contentReference,
    cursor,
    limit,
  }) {
    return this.#transactions.read(snapshot, async (read, scope) => {
      const page = requirePartitionMessagePage(
        snapshot,
        PARTITION_MESSAGE_PAGE.content,
        [dialogProcessId, turnScopeId, messageUid, contentReference],
        { cursor, limit },
      );
      const records = await read({ collection: collections.messages, keys: [messageUid] });
      const stored = records.get(messageUid);
      if (stored === null)
        throw messageContentReadError("missing", "Content message does not exist");
      const visible = await readVisibleMessagePosition(
        read,
        scope.sessionId,
        checkMessage(stored.value, {
          snapshot,
          scope,
          messageUid,
          dialogProcessId,
          turnScopeId,
          generation: snapshot.sequence,
        }),
      );
      if (visible === null)
        throw messageContentReadError("missing", "Content message does not exist");
      const { record } = visible;
      if (record.contentVersion !== contentReference)
        throw messageContentReadError("version", "Message content version conflict");
      const { entries, hasMore } = await readMessageChunks(read, record, page.after, limit);
      return createPartitionMessagePage(snapshot, entries, page, hasMore);
    });
  }
}
