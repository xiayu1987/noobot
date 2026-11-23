/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  projectStoredSessionMetadata,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import {
  assertCurrentImmutableMigrationPublication,
  bindImmutableMigrationSource,
  captureImmutableMigrationSourceIdentity,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  createImmutableMigrationOperation,
  IMMUTABLE_OPERATION_RETRY_UNAVAILABLE,
} from "@noobot/session-protocol/immutable-operation-receipt";
import { requirePartitionDialogSequence } from "@noobot/session-protocol/partition-session-state";
import { capturePartitionSessionScope } from "@noobot/session-protocol/partition-transaction";
import { createSessionReaderLifecycle } from "@noobot/session-protocol/session-reader";
import { requireTurnLifecycleHeader } from "@noobot/session-protocol/turn-lifecycle";
import {
  readImmutableAuthority,
  withImmutableAuthorityMutation,
} from "../session/session-storage-authority.js";
import { ImmutableSessionStore } from "../session/session-artifact-session/immutable-session-store.js";
import {
  readImmutableMessagePage,
  readImmutableSessionAutoTitle,
} from "../session/session-artifact-session/immutable-message-range.js";
import {
  immutableAttachmentBindingKey,
  immutableLifecycleCommandKey,
} from "../session/session-artifact-session/immutable-command-index.js";
import { readImmutableDialogTurnPage } from "../session/session-artifact-session/immutable-dialog-turn-page.js";
import { immutableOrderKey } from "../session/session-artifact-session/immutable-order-key.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
} from "../session/session-artifact-session/immutable-checkpoint-reader.js";
import {
  acquireImmutableReaderRetention,
  assertImmutableMigrationRetentionsReleased,
} from "../session/session-artifact-session/immutable-reader-retention.js";
import { withImmutableToolPair } from "../session/session-artifact-session/immutable-tool-pairs.js";
import { readImmutablePluginArtifact } from "../session/session-artifact-session/immutable-plugin-artifact.js";
import {
  hasImmutableArtifactEvent,
  visitImmutableArtifactEvents,
} from "../session/session-artifact-session/immutable-artifact-event-index.js";
import {
  readImmutableMigrationOutboxPage,
  readImmutableOutboxCursor,
  readImmutableOutboxEvent,
  readImmutableOutboxTail,
} from "../session/session-artifact-session/immutable-outbox.js";

import { needsCheckpointInputEvidence } from "../session/session-artifact-session/immutable-checkpoint-receipt-migration.js";
import { projectImmutableSessionCommitResult } from "../session/session-artifact-session/immutable-message-receipts.js";
import { migrateSessionActivityTimelineMessage } from "./session-activity-timeline-upgrade.js";

async function migrationEvidence(store, head, operation) {
  const { generation, operationId } = operation.record;
  const evidence = createImmutableMigrationOperation({ generation, operationId }, operation);
  const { receipt } = evidence;
  if (receipt.retryUnavailable || !Object.hasOwn(receipt, "result") || receipt.result === null)
    return evidence;
  if (needsCheckpointInputEvidence(receipt.result))
    return {
      ...evidence,
      receipt: { ...receipt, retryUnavailable: IMMUTABLE_OPERATION_RETRY_UNAVAILABLE },
    };
  const result = await store.objects.withSnapshot(head, () =>
    projectImmutableSessionCommitResult(store, head, operation.record, receipt.result),
  );
  return { ...evidence, receipt: { ...receipt, result } };
}

export async function withImmutableSessionMigrationSource(
  { sessionDir, expectedSource, signal },
  run,
) {
  if (!isFunction(run)) throw new TypeError("Migration source requires a callback");
  signal?.throwIfAborted();
  const expected =
    expectedSource === null ? null : captureImmutableMigrationSourceIdentity(expectedSource);
  await readImmutableAuthority(sessionDir);
  const store = await ImmutableSessionStore.open({ sessionDir });
  let selection;
  const { head, release } = await acquireImmutableReaderRetention(store, async (head) => {
    selection = await captureMigrationSelection(store, head, expected);
  });
  return useMigrationReader({ store, head, release, signal, ...selection }, run);
}

export function withExclusiveImmutableMigrationSource({ sessionDir, expectedSource, signal }, run) {
  if (!isFunction(run)) throw new TypeError("Migration source requires a callback");
  const expected =
    expectedSource === null ? null : captureImmutableMigrationSourceIdentity(expectedSource);
  return withImmutableAuthorityMutation(sessionDir, async () => {
    signal?.throwIfAborted();
    const store = await ImmutableSessionStore.open({ sessionDir });
    const head = await store.snapshot();
    const selection = await captureMigrationSelection(store, head, expected);
    await assertImmutableMigrationRetentionsReleased(store, head, signal);
    return useMigrationReader({ store, head, release: () => {}, signal, ...selection }, run);
  });
}

async function captureMigrationSelection(store, head, expected) {
  const identity = bindImmutableMigrationSource(head, expected);
  const metadata = await store.get(head, "metadata", "session");
  if (!metadata || metadata.sessionId !== head.sessionId)
    throw immutableStorageError("Migration source metadata disagrees with the committed head");
  return { identity, scope: capturePartitionSessionScope(metadata) };
}

async function useMigrationReader({ store, head, release, signal, identity, scope }, run) {
  const activityUpgrade = {
    sessionDir: store.sessionDir,
    details: { sessionId: head.sessionId },
    shared: {},
  };
  await using source = createSessionReaderLifecycle({
    generation: head.generation,
    release,
    methods: {
      withCurrentHead: (operation) =>
        withImmutableAuthorityMutation(store.sessionDir, async () => {
          assertCurrentImmutableMigrationPublication(await store.snapshot(), head);
          return operation();
        }),
      readMetadata: async () => {
        const metadata = await store.get(head, "metadata", "session");
        if (metadata === null) throw immutableStorageError("Migration source metadata is missing");
        return projectStoredSessionMetadata(metadata);
      },
      readAutoTitle: () => readImmutableSessionAutoTitle(store, head),
      readDialogSequence: async () => {
        const facts = await store.get(head, "metadata", "facts");
        return requirePartitionDialogSequence(facts?.dialogSequence);
      },
      readMetadataEntry: (key) => store.get(head, "metadata", key),
      readCommand: (id) => store.get(head, "commands", immutableLifecycleCommandKey(id)),
      readBindingCommandId: (uid) =>
        store.get(head, "commands", immutableAttachmentBindingKey(uid)),
      readBindingMessage: async (uid) => {
        const record = (await store.getManyMetadata(head, "messages", [uid])).get(uid);
        return record === null ? null : record.value.message;
      },
      readLifecycleHead: async () =>
        requireTurnLifecycleHeader(await store.get(head, "metadata", "lifecycle")),
      readScopedMetadata: async () =>
        readScopedSessionMetadataRecord(await store.get(head, "metadata", "scoped")),
      readMessagePage: async (options) => {
        signal?.throwIfAborted();
        const page = await readImmutableMessagePage({ ...options, store, snapshot: head });
        const records = [];
        for (const record of page.records) {
          signal?.throwIfAborted();
          const message = await migrateSessionActivityTimelineMessage(
            record.message,
            activityUpgrade,
          );
          records.push({ ...record, message });
        }
        signal?.throwIfAborted();
        return { ...page, records };
      },
      readDialog: async (dialogProcessId) => {
        const dialog = await store.get(head, "dialogs", dialogProcessId);
        if (dialog === null) return null;
        const id = await store.get(head, "dialogOrder", immutableOrderKey(dialog.dialogOrdinal));
        if (id !== dialogProcessId || dialog.dialogProcessId !== dialogProcessId)
          throw immutableStorageError(`Invalid source dialog order: ${dialogProcessId}`);
        return dialog;
      },
      readCheckpointHead: (turnScopeId) => store.get(head, "checkpointHeads", turnScopeId),
      readCheckpoint: (turnScopeId, checkpointId) =>
        readImmutableCheckpoint(store, head, turnScopeId, checkpointId),
      readCheckpointPage: (options) =>
        readImmutableCheckpointPage({ ...options, store, snapshot: head }),
      readTurnState: (turnScopeId) => store.get(head, "lifecycle", turnScopeId),
      readTurnReplacement: (turnScopeId) => store.get(head, "replacements", turnScopeId),
      readTurnTiming: (turnScopeId) => store.get(head, "timings", turnScopeId),
      readStoredEventSequenceFloor: (key) => store.get(head, "eventSequences", key),
      readOutboxTail: () => readImmutableOutboxTail(store, head),
      readMigrationOutboxPage: (options) =>
        readImmutableMigrationOutboxPage(store, head, scope, options),
      readOutboxEvent: (eventId) => readImmutableOutboxEvent(store, head, eventId),
      readOutboxCursor: (consumerId) => readImmutableOutboxCursor(store, head, consumerId),
      readPluginArtifact: (identity) =>
        readImmutablePluginArtifact(
          (collection, key) => store.get(head, collection, key),
          identity,
        ),
      hasArtifactEvent: (eventId) => hasImmutableArtifactEvent(store, head, eventId),
      visitArtifactEvents: async (visit) => {
        if (!isFunction(visit)) throw new TypeError("Migration artifact events require a visitor");
        signal?.throwIfAborted();
        await visitImmutableArtifactEvents(store, head, async (event) => {
          await visit(event);
          signal?.throwIfAborted();
        });
      },
      withToolPair: (identity, visit) => withImmutableToolPair(store, head, identity, visit),
      readDialogTurnPage: (options) =>
        store.objects.withSnapshot(head, () =>
          readImmutableDialogTurnPage({ ...options, store, snapshot: head }),
        ),
      visitCollection: async (collection, visit) => {
        if (!isFunction(visit)) throw new TypeError("Migration collection requires a visitor");
        signal?.throwIfAborted();
        for await (const [key, value] of store.entries(head, collection)) {
          await visit(key, value);
          signal?.throwIfAborted();
        }
      },
      visitOperations: async (visit) => {
        if (!isFunction(visit)) throw new TypeError("Migration operations require a visitor");
        signal?.throwIfAborted();
        for await (const operation of store.migrationOperations(head, signal)) {
          signal?.throwIfAborted();
          await visit(await migrationEvidence(store, head, operation));
          signal?.throwIfAborted();
        }
      },
      visitCommit: async (generation, { visitOperation, visitChange }) => {
        if (!isFunction(visitOperation) || !isFunction(visitChange))
          throw new TypeError("Migration commit requires operation and change visitors");
        signal?.throwIfAborted();
        await store.visitMigrationCommit(head, generation, {
          visitOperation: async (operation) => {
            signal?.throwIfAborted();
            await visitOperation(await migrationEvidence(store, head, operation));
            signal?.throwIfAborted();
          },
          visitChange: async (change) => {
            signal?.throwIfAborted();
            await visitChange(change);
            signal?.throwIfAborted();
          },
        });
      },
    },
  });
  signal?.throwIfAborted();
  return await run(Object.freeze({ ...source, identity, scope }));
}
