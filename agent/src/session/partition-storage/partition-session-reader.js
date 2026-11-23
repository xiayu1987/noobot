/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { createSessionReaderLifecycle } from "@noobot/session-protocol/session-reader";
import {
  requireMessageDiagnosticPageRequest,
  requirePreparedSessionCommitRequest,
} from "@noobot/session-protocol/session-changes";
import { partitionSnapshotFailure } from "@noobot/session-protocol/partition-journal";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";
import { releaseUnclaimedJournalSnapshot } from "./journal-snapshots.js";
import { PartitionSessionMessages } from "./partition-session-messages.js";
import { PartitionSessionStateReader } from "./partition-session-state-reader.js";
import { PartitionMessageRange } from "./partition-message-range.js";
import { PartitionContextReader } from "./partition-context-reader.js";
import { exportPartitionSession } from "./partition-session-export.js";
import { readPartitionExecutionSource } from "./partition-session-source.js";
import { readPartitionDisplayProjection } from "./partition-display-projection.js";
import { readPartitionSessionAutoTitle } from "./partition-session-title.js";

export async function openPartitionSessionReader({ journal, sessionId, parentSessionId }) {
  const messages = new PartitionSessionMessages(journal, { sessionId, parentSessionId });
  const state = new PartitionSessionStateReader(journal, { sessionId, parentSessionId });
  const ranges = new PartitionMessageRange(journal, { sessionId, parentSessionId });
  const context = new PartitionContextReader(journal, { sessionId, parentSessionId });
  let snapshot;
  const release = async (operation) => {
    try {
      await operation(snapshot);
    } catch (cause) {
      throw partitionSnapshotFailure("release", cause, snapshot);
    }
  };
  try {
    snapshot = await journal.snapshot();
    await messages.readMetadata({ snapshot });
    const readMessageDiagnosticPage = (options) => {
      requireMessageDiagnosticPageRequest(options);
      return messages.readMessageDiagnosticPage({
        ...options,
        snapshot,
        limit: Math.min(options.limit, snapshot.limits.pageRecords),
      });
    };
    return createSessionReaderLifecycle({
      generation: snapshot.sequence,
      methods: {
        exportSession: () =>
          exportPartitionSession({
            journal,
            snapshot,
            scope: { sessionId, parentSessionId },
            messages,
            state,
            ranges,
          }),
        prepareRequest: (command) => messages.prepareRequest(snapshot, command),
        readMetadata: async ({ includeAutoTitle = false } = {}) => {
          const facts = await messages.readMetadata({ snapshot });
          if (!includeAutoTitle) return facts;
          const autoTitle = await readPartitionSessionAutoTitle({
            journal,
            snapshot,
            scope: { sessionId, parentSessionId },
          });
          return autoTitle ? { ...facts, autoTitle } : facts;
        },
        readListProjection: () => messages.readListProjection({ snapshot }),
        readDisplaySourceCounts: () => messages.readDisplaySourceCounts({ snapshot }),
        readDisplayPage: (selection) => messages.readDisplayPage({ snapshot, selection }),
        readDisplayProjection: ({ includeThinkingTimeline } = {}) =>
          readPartitionDisplayProjection({
            journal,
            snapshot,
            scope: { sessionId, parentSessionId },
            messages,
            ranges,
            includeThinkingTimeline,
          }),
        readContextSource: (options) => context.readContextSource(snapshot, options),
        readScopedMetadata: () => state.readScopedMetadata(snapshot),
        readLifecycleHead: () => state.readLifecycleHead(snapshot),
        readExecutionSource: () =>
          readPartitionExecutionSource({
            journal,
            snapshot,
            scope: { sessionId, parentSessionId },
          }),
        readLifecycleSource: (options) => state.readLifecycleSource(snapshot, options),
        readTurnState: (turnScopeId) => state.readTurnState(snapshot, turnScopeId),
        readTurnDescriptor: (turnScopeId) => state.readTurnDescriptor(snapshot, turnScopeId),
        readCommand: (commandId) => state.readCommand(snapshot, commandId),
        readMutationProjection: (commandId) => state.readMutationProjection(snapshot, commandId),
        readDialog: (dialogProcessId) => state.readDialog(snapshot, dialogProcessId),
        readDialogTurnPage: (options) => state.readDialogTurnPage(snapshot, options),
        readMessageEntry: (options) => messages.readMessageEntry({ ...options, snapshot }),
        readMessages: (options) => messages.readMessages({ ...options, snapshot }),
        readMessagePage: (options) => ranges.readPage(snapshot, options),
        readDisplaySourcePage: (options) => ranges.readDisplaySourcePage(snapshot, options),
        readMessageTailPage: (options) => ranges.readTailPage(snapshot, options),
        readFirstTurnMessage: (turnScopeId, maxBytes) =>
          messages.readFirstTurnMessage({ snapshot, turnScopeId, maxBytes }),
        readSessionMessageOrderPage: (options) =>
          messages.readSessionMessageOrderPage({ ...options, snapshot }),
        readMessageSuffixPage: (options) =>
          messages.readMessageSuffixPage({ ...options, snapshot }),
        readTurnPage: (options) => messages.readMaterializedTurnPage({ ...options, snapshot }),
        readScopedTurnMessagePage: (options) =>
          messages.readScopedTurnMessagePage({ ...options, snapshot }),
        readDisplayArtifactPage: (options) =>
          messages.readDisplayArtifactPage({ ...options, snapshot }),
        readThinkingDetailPage: (options) =>
          messages.readThinkingDetailPage({ ...options, snapshot }),
        readTurnMessageEntryPage: (options) => messages.readTurnPage({ ...options, snapshot }),
        readContentPage: (options) => messages.readContentPage({ ...options, snapshot }),
        readMessageContentPage: (options) =>
          messages.readMessageContentPage({ ...options, snapshot }),
        readAttachmentBindingTarget: (options) =>
          messages.readAttachmentBindingTarget({ ...options, snapshot }),
        readPluginArtifact: (identity) => messages.readPluginArtifact({ ...identity, snapshot }),
        readOutboxPage: (options) => messages.readOutboxPage({ ...options, snapshot }),
        readOutboxEvent: (eventId) => messages.readOutboxEvent({ snapshot, eventId }),
        readEventSequence: (domain, scopeId) => state.readEventSequence(snapshot, domain, scopeId),
        readMessageDiagnosticPage,
        readTurnMessageDiagnosticPage: readMessageDiagnosticPage,
        readCheckpoint: (turnScopeId, checkpointId) =>
          messages.readCheckpoint({ snapshot, turnScopeId, checkpointId }),
        readCheckpointState: (turnScopeId) =>
          messages.readCheckpointState({ snapshot, turnScopeId }),
        readCheckpointPage: (options) => messages.readCheckpointPage({ ...options, snapshot }),
        readTurnTiming: (turnScopeId) => messages.readTurnTiming({ snapshot, turnScopeId }),
      },
      release: ({ scopeExit }) =>
        release((retained) =>
          scopeExit
            ? releaseUnclaimedJournalSnapshot(journal, retained)
            : journal.releaseSnapshot(retained),
        ),
    });
  } catch (cause) {
    if (cause.code === "SESSION_SNAPSHOT_UNCERTAIN") snapshot = cause.snapshot;
    return withStorageCleanup(
      async () => {
        throw cause;
      },
      async () => {
        if (snapshot)
          await release((retained) => releaseUnclaimedJournalSnapshot(journal, retained));
      },
    );
  }
}

export async function withPartitionSessionReader({ journal, sessionId, parentSessionId }, run) {
  if (!isFunction(run)) throw new TypeError("Scoped reader requires a callback");
  const options = { journal, sessionId, parentSessionId };
  await using reader = await openPartitionSessionReader(options);
  const messages = new PartitionSessionMessages(journal, options);
  await using transaction = createSessionReaderLifecycle({
    generation: reader.generation,
    methods: {
      commitChanges: (request) => messages.commit(requirePreparedSessionCommitRequest(request)),
      readCurrent: async (read) => {
        if (!isFunction(read)) throw new TypeError("Current reader requires a callback");
        await using current = await openPartitionSessionReader(options);
        return await read(current);
      },
    },
    release: async () => {},
  });
  return await run(reader, transaction.commitChanges, transaction.readCurrent);
}
