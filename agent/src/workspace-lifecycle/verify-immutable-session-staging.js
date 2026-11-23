/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { requireTurnLifecycleHeader } from "@noobot/session-protocol/turn-lifecycle";
import {
  PARTITION_DIALOG_SEQUENCE,
  requirePartitionDialogSequence,
} from "@noobot/session-protocol/partition-session-state";
import { withCurrentJournalSnapshot } from "../session/partition-storage/journal-snapshots.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionSessionStateReader } from "../session/partition-storage/partition-session-state-reader.js";
import { readPartitionSessionAutoTitle } from "../session/partition-storage/partition-session-title.js";
import { verifyImmutableOperationReceipts } from "./import-immutable-operation-receipts.js";
import { verifyImmutableSessionMessages } from "./verify-immutable-session-messages.js";
import { verifyImmutableSessionDialogs } from "./verify-immutable-session-dialogs.js";
import { verifyImmutableSessionLifecycle } from "./verify-immutable-session-lifecycle.js";
import { verifyImmutableSessionToolPairs } from "./verify-immutable-session-tool-pairs.js";
import { verifyImmutableSessionOutbox } from "./verify-immutable-session-outbox.js";
import { verifyImmutableSessionArtifacts } from "./verify-immutable-session-artifacts.js";
import { verifyImmutableSessionCommands } from "./verify-immutable-session-commands.js";
import { verifyImmutableSessionCheckpoints } from "./verify-immutable-session-checkpoints.js";

async function verifyMetadata({ source, journal, scope, snapshot }) {
  const transactions = new PartitionSessionTransactions(journal, scope);
  const state = new PartitionSessionStateReader(journal, scope);
  const expected = await source.readMetadata();
  const actual = await transactions.readMetadata(snapshot);
  if (!isDeepStrictEqual(expected, actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    const differences = keys.filter(
      (key) =>
        Object.hasOwn(expected, key) !== Object.hasOwn(actual, key) ||
        !isDeepStrictEqual(expected[key], actual[key]),
    );
    throw immutableStorageError(
      `Staged session metadata differs from the migration source: ${differences.join(", ")}`,
    );
  }
  if (
    (await source.readAutoTitle()) !==
    (await readPartitionSessionAutoTitle({ journal, snapshot, scope }))
  )
    throw immutableStorageError("Staged session automatic title differs from the migration source");
  if (
    !isDeepStrictEqual(await source.readScopedMetadata(), await state.readScopedMetadata(snapshot))
  )
    throw immutableStorageError("Staged scoped metadata differs from the migration source");
  const lifecycle = requireTurnLifecycleHeader(await state.readLifecycleHead(snapshot));
  if (!isDeepStrictEqual(await source.readLifecycleHead(), lifecycle))
    throw immutableStorageError("Staged lifecycle head differs from the migration source");
  const { collection, key } = PARTITION_DIALOG_SEQUENCE;
  const sequence = await transactions.read(snapshot, async (read) =>
    requirePartitionDialogSequence((await read({ collection, keys: [key] })).get(key)?.value),
  );
  if ((await source.readDialogSequence()) !== sequence)
    throw immutableStorageError("Staged dialog sequence differs from the migration source");
}

export async function verifyImmutableSessionBusinessState({
  source,
  journal,
  scope,
  snapshot,
  limit,
  maxBytes,
  signal,
}) {
  const pinned = { source, journal, scope, snapshot, signal };
  const messageCount = await verifyImmutableSessionMessages({ ...pinned, limit, maxBytes });
  await verifyMetadata(pinned);
  await verifyImmutableSessionLifecycle(pinned);
  const dialogCount = await verifyImmutableSessionDialogs({ ...pinned, limit, maxBytes });
  await verifyImmutableSessionToolPairs(pinned);
  await verifyImmutableSessionOutbox(pinned);
  await verifyImmutableSessionArtifacts(pinned);
  await verifyImmutableSessionCommands(pinned);
  await verifyImmutableSessionCheckpoints({ ...pinned, limit, maxBytes });
  return { messageCount, dialogCount };
}

function withCurrentStagingHeads({ source, journal, snapshot, signal }, operation) {
  return source.withCurrentHead(() =>
    withCurrentJournalSnapshot(journal, snapshot, () => {
      signal?.throwIfAborted();
      return operation?.();
    }),
  );
}

export { withCurrentStagingHeads };

export async function verifyImmutableSessionStaging(
  { source, journal, scope, limit, maxBytes, signal },
  publish,
) {
  return journal.usingSnapshot(async (snapshot) => {
    const pinned = { source, journal, scope, snapshot, signal };
    const { messageCount, dialogCount } = await verifyImmutableSessionBusinessState({
      ...pinned,
      limit,
      maxBytes,
    });
    const receiptCount = await verifyImmutableOperationReceipts(pinned);
    const report = {
      source: source.identity,
      target: {
        sessionId: snapshot.sessionId,
        epoch: snapshot.epoch,
        generation: snapshot.sequence,
      },
      messageCount,
      receiptCount,
      dialogCount,
    };
    await withCurrentStagingHeads(pinned, publish && (() => publish(report)));
    return report;
  });
}
