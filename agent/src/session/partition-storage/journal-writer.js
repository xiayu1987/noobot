/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  EMPTY_SEALED_COLLECTION,
  PARTITION_CHECKPOINT_JOURNAL_WORK,
  PartitionAdmissionRejection,
  PartitionProjectionBackpressure,
  partitionJournalAdmission,
  partitionJournalBatchBudget,
  partitionJournalError,
  requirePartitionPublicationCapacity,
  createPartitionJournalReference,
} from "@noobot/session-protocol/partition-journal";
import {
  matchesPartitionTransactionRequest,
  partitionEntityKey,
  partitionHistoricalOperationAddress,
  partitionMutationOwner,
  rejectPartitionHistoricalOperation,
  replayPartitionHistoricalOperation,
  requirePartitionEntityReference,
} from "@noobot/session-protocol/partition-transaction";
import { createPartitionCollectionReadBudget } from "@noobot/session-protocol/partition-collection-query";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { withJournalPublicationLock } from "./journal-publication-lock.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  clampJournalTail,
  prepareJournalDirectory,
  journalPartitionPath,
  openCommittedJournalFile,
  publishJournalHead,
  readJournalHead,
  writeJournalBytes,
} from "./journal-io.js";
import { readJournalReceipt, recoverJournalReceiptLocations } from "./journal-reader.js";
import { restorePublishedPartitionTail } from "./journal-recovery.js";
import { publishPartitionDirectory } from "./journal-directory.js";
import { writeJournalOffsets } from "./journal-offsets.js";
import { groupPartitionWrites } from "./journal-write-groups.js";
import { withLockedJournalSnapshot } from "./journal-snapshots.js";
import { withJournalRecordReader } from "./journal-record.js";
import { lookupPartitionHistoricalOperation } from "./partition-entity-directory.js";
import { withEntityDirectoryPublicationPages } from "./entity-directory-io.js";
import {
  startPartitionCommitPhase,
  finishPartitionCommitPhase,
} from "./partition-commit-observation.js";

function planAppend(head, frameBytes) {
  const next = structuredClone(head);
  const limits = head.limits;
  if (
    next.tail.offset + frameBytes > limits.partitionBytes ||
    next.partitionRecords === limits.partitionRecords
  ) {
    next.tail.partition += 1;
    next.tail.offset = 0;
    next.partitionRecords = 0;
  }
  const cursor = { ...next.tail };
  next.tail.offset += frameBytes;
  next.tail.sequence += 1;
  next.sequence += 1;
  next.partitionRecords += 1;
  next.dataBytes += frameBytes;
  return { next, cursor };
}

function retainReceipt(plan, receipt) {
  const {
    receipts,
    head: { limits },
  } = plan;
  receipts.push(receipt);
  plan.receiptBytes += receipt.bytes;
  while (
    receipts.length - plan.receiptOffset > limits.receiptRecords ||
    plan.receiptBytes > limits.receiptBytes
  )
    plan.receiptBytes -= receipts[plan.receiptOffset++].bytes;
}

function lookupReceipt(receipts, sequence, offset) {
  if (!receipts.length) return undefined;
  const index = sequence - receipts[0].sequence;
  return index < offset ? undefined : receipts[index];
}

function admitItem(owner, plan, item) {
  return partitionJournalAdmission(
    plan.head,
    item.request,
    async (sequence) => {
      const location = lookupReceipt(plan.receipts, sequence, plan.receiptOffset);
      if (location === undefined) return undefined;
      const batchReceipt = plan.batchReceipts.get(sequence);
      if (batchReceipt !== undefined) return batchReceipt;
      const receipt = await readJournalReceipt(
        owner.root,
        plan.committedSnapshot,
        location,
        owner.work,
      );
      plan.batchReceipts.set(sequence, receipt);
      return receipt;
    },
    plan.head.publication === "collections"
      ? (receipt) => matchesPartitionTransactionRequest(receipt, item.request)
      : (receipt) => receipt.digest === item.digest,
  );
}

async function readHistoricalOperation(owner, snapshot, plan, operationId) {
  const { collection, key } = partitionHistoricalOperationAddress(operationId);
  const pending = plan.stagedEntities.get(partitionEntityKey(collection, key));
  if (pending !== undefined) return pending.mutation;
  const readBudget = createPartitionCollectionReadBudget(snapshot);
  const entry = await lookupPartitionHistoricalOperation(owner, snapshot, key, readBudget);
  if (entry === null) return null;
  const { reference } = entry;
  requirePartitionEntityReference(reference, snapshot);
  const slots = await owner.readRecordSlots({
    snapshot,
    reference: reference.record,
    slots: [reference.slot],
    readBudget,
  });
  const mutation = slots.get(reference.slot)?.mutation;
  if (mutation?.collection !== collection || mutation.key !== key)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Historical operation reference mismatch",
    );
  return mutation;
}

async function prepareItem(owner, plan, item) {
  const snapshot = plan.committedSnapshot;
  await item.validateScope(snapshot);
  const { request } = item;
  if (request.epoch === null) {
    const mutation = await readHistoricalOperation(owner, snapshot, plan, request.operationId);
    return { historical: replayPartitionHistoricalOperation(mutation, request) };
  }
  const replay = await admitItem(owner, plan, item);
  if (replay) return { replay };
  const historicalStarted = startPartitionCommitPhase();
  try {
    const mutation = await readHistoricalOperation(owner, snapshot, plan, request.operationId);
    rejectPartitionHistoricalOperation(mutation, request.operationId);
  } finally {
    finishPartitionCommitPhase("historicalOperation", historicalStarted);
  }
  const prepareStarted = startPartitionCommitPhase();
  try {
    return { prepared: await item.prepare(snapshot, plan.stagedEntities, plan.head.sequence) };
  } finally {
    finishPartitionCommitPhase("prepareTransaction", prepareStarted);
  }
}

function stageEntities(plan, { request, encodedSlotBytes }, receipt) {
  const record = createPartitionJournalReference(plan.head, receipt);
  for (const [slot, mutation] of request.payload.mutations.entries()) {
    const reference = { record, slot };
    plan.stagedEntities.set(partitionEntityKey(mutation.collection, mutation.key), {
      owner: partitionMutationOwner(mutation.owner, reference),
      reference,
      mutation,
      encodedBytes: encodedSlotBytes[slot],
    });
  }
}

async function planItem(owner, plan, item) {
  const admission = item.prepare
    ? await prepareItem(owner, plan, item)
    : { replay: await admitItem(owner, plan, item) };
  if (admission.replay) return { item, receipt: admission.replay, replayed: true };
  if (Object.hasOwn(admission, "historical"))
    return { item, historical: admission.historical, replayed: true };
  if (admission.prepared && Object.hasOwn(admission.prepared, "aborted"))
    return { item, aborted: admission.prepared.aborted };
  item = { ...item, ...admission.prepared };
  if (plan.publishedBytes + item.frame.length > plan.byteBudget) return null;
  const appended = planAppend(plan.head, item.frame.length);
  if (plan.head.publication === "journal") requirePartitionPublicationCapacity(appended.next);
  const receipt = {
    sequence: appended.next.sequence,
    digest: item.digest,
    payload: item.request.payload,
    bytes: item.frame.length,
    cursor: appended.cursor,
    end: { ...appended.next.tail },
  };
  const states = await owner.planPublication(
    {
      previous: plan.committedSnapshot,
      accepted: plan.head,
      snapshot: appended.next,
      record: { request: item.request, cursor: receipt.cursor, end: receipt.end },
    },
    plan.publicationStates,
  );
  plan.publicationStates = states;
  plan.head = appended.next;
  plan.publishedBytes += receipt.bytes;
  const { sequence, bytes, cursor, end } = receipt;
  retainReceipt(plan, { sequence, bytes, cursor, end });
  plan.batchReceipts.set(sequence, receipt);
  plan.writes.push({ item, receipt });
  if (plan.head.publication === "collections") stageEntities(plan, item, receipt);
  return { item, receipt, replayed: false };
}

async function admitBatchItem(owner, plan, item) {
  try {
    return await planItem(owner, plan, item);
  } catch (error) {
    if (error instanceof PartitionProjectionBackpressure) {
      plan.needsProjection = true;
      return null;
    }
    if (!(error instanceof PartitionAdmissionRejection)) throw error;
    return { item, error };
  }
}

async function planBatch(owner, { head, committedSnapshot, previousReceipts, batch }) {
  const plan = {
    head,
    committedSnapshot,
    receipts: [...previousReceipts],
    batchReceipts: new Map(),
    byteBudget: partitionJournalBatchBudget(head.limits).bytes,
    publishedBytes: 0,
    needsProjection: false,
    receiptBytes: previousReceipts.reduce((sum, receipt) => sum + receipt.bytes, 0),
    receiptOffset: 0,
    writes: [],
    stagedEntities: new Map(),
    outcomes: [],
    publicationStates: new Map(),
  };
  for (const item of batch) {
    const outcome = await admitBatchItem(owner, plan, item);
    if (outcome === null) break;
    plan.outcomes.push(outcome);
  }
  if (plan.receiptOffset) plan.receipts.splice(0, plan.receiptOffset);
  if (plan.writes.length) plan.head.receiptStart = { ...plan.receipts[0].cursor };
  return plan;
}

async function writePartitionFrames(root, { previous, partition, writes, work }) {
  const file = journalPartitionPath(root, partition);
  const extending = partition === previous.tail.partition && previous.tail.offset > 0;
  const handle = extending
    ? await openCommittedJournalFile(file, "body", "r+")
    : await fsOpen(file, "w+");
  work.partitionOpens += 1;
  return withStorageCleanup(
    async () => {
      if (extending) await clampJournalTail(handle, previous.tail.offset);
      for (const { item, receipt } of writes) {
        await writeJournalBytes(handle, item.frame, receipt.cursor.offset, work);
      }
      await handle.sync();
      work.dataSyncs += 1;
    },
    () => handle.close(),
  );
}

async function publishPlan(owner, previous, plan) {
  if (!plan.writes.length) {
    if (plan.outcomes.some((outcome) => outcome.replayed)) await syncStorageDirectory(owner.root);
    return;
  }

  if (plan.writes[0].receipt.cursor.partition > previous.tail.partition)
    await restorePublishedPartitionTail(owner.root, previous);
  const groups = groupPartitionWrites(plan.writes);
  for (const [partition] of groups) {
    if (partition !== previous.tail.partition || previous.tail.offset === 0)
      await prepareJournalDirectory(
        owner.root,
        path.dirname(journalPartitionPath(owner.root, partition)),
      );
  }
  const publication = {
    previous,
    snapshot: plan.head,
    states: plan.publicationStates,
    records: plan.writes.map(({ item, receipt }) => ({
      request: item.request,
      cursor: receipt.cursor,
      end: receipt.end,
    })),
  };

  const [frames, offsets, collections] = await Promise.allSettled([
    (async () => {
      for (const [partition, writes] of groups)
        await writePartitionFrames(owner.root, { previous, partition, writes, work: owner.work });
    })(),
    writeJournalOffsets(owner.root, previous, plan.writes, owner.work),
    owner.preparePublication(publication),
  ]);
  const failures = [frames, offsets, collections]
    .filter(({ status }) => status === "rejected")
    .map(({ reason }) => reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Journal extent preparation failed");
  const collectionRoots = collections.value;

  let partition = previous.tail.partition;
  let firstSequence = previous.sequence - previous.partitionRecords + 1;
  let committedBytes = previous.tail.offset;
  const publish = (lastSequence, bytes, collectionRoot) =>
    publishPartitionDirectory({
      root: owner.root,
      head: plan.head,
      partition,
      firstSequence,
      lastSequence,
      committedBytes: bytes,
      collectionRoot,
      work: owner.work,
    });
  for (const { receipt } of plan.writes) {
    if (receipt.cursor.partition !== partition) {
      const root = previous.publication === "collections" ? collectionRoots.get(partition) : null;
      const collectionRoot =
        previous.publication === "collections" && root === null ? EMPTY_SEALED_COLLECTION : root;
      await publish(receipt.sequence - 1, committedBytes, collectionRoot);
      partition = receipt.cursor.partition;
      firstSequence = receipt.sequence;
    }
    committedBytes = receipt.end.offset;
  }

  if (partition !== previous.tail.partition || previous.sequence === 0)
    await publish(null, null, null);
  await publishJournalHead(owner, plan.head);
  owner.cachePublication(publication);
}

function withCurrentJournalReceipts(owner, operation) {
  return withJournalPublicationLock(owner.lockPath, async () => {
    const previous = await readJournalHead(owner.root, owner.work);
    if (
      previous.sessionId !== owner.head.sessionId ||
      previous.epoch !== owner.head.epoch ||
      previous.publication !== owner.head.publication
    )
      throw partitionJournalError("SESSION_REQUEST_EPOCH", "Journal identity changed");
    let receipts = owner.receipts;
    if (previous.sequence < owner.head.sequence)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Publication sequence regressed");
    if (receipts === null || previous.sequence > owner.head.sequence)
      receipts = await recoverJournalReceiptLocations(
        owner.root,
        previous,
        owner.work,
        receipts ?? [],
      );
    return operation(previous, receipts);
  });
}

function receiptOutcome(head, receipt, replayed) {
  return {
    sequence: receipt.sequence,
    payload: structuredClone(receipt.payload),
    reference: createPartitionJournalReference(head, receipt),
    cursor: { ...receipt.cursor },
    end: { ...receipt.end },
    replayed,
  };
}

function uncertainCommit(cause) {
  return Object.assign(
    partitionJournalError("SESSION_COMMIT_UNCERTAIN", "Reopen and retry the identical requests"),
    { cause },
  );
}

function reportBatchWork(owner, outcomes, before) {
  if (before === undefined) return;
  const batchWork = Object.fromEntries(
    PARTITION_CHECKPOINT_JOURNAL_WORK.map((name, index) => [
      name,
      owner.work[name] - before[index],
    ]),
  );

  for (const { item, receipt } of outcomes) if (receipt) item.observeJournalWork?.(batchWork);
}

export async function commitJournalBatch(owner, batch) {
  let committed;
  const before = batch.some((item) => item.observeJournalWork !== undefined)
    ? PARTITION_CHECKPOINT_JOURNAL_WORK.map((name) => owner.work[name])
    : undefined;
  try {
    await withCurrentJournalReceipts(owner, async (head, previousReceipts) => {
      committed = await withEntityDirectoryPublicationPages(owner, () =>
        withLockedJournalSnapshot(owner, head, (committedSnapshot) =>
          withJournalRecordReader(owner.root, committedSnapshot, () =>
            planBatch(owner, { head, committedSnapshot, previousReceipts, batch }),
          ),
        ),
      );
      const started = startPartitionCommitPhase();
      try {
        await publishPlan(owner, head, committed);
      } finally {
        finishPartitionCommitPhase("publishDurably", started);
      }
    });
  } catch (cause) {
    if (cause === owner.failure) throw cause;
    if (committed?.outcomes.some(({ receipt, historical }) => receipt || historical))
      throw uncertainCommit(cause);
    throw cause;
  }
  owner.head = committed.head;
  owner.receipts = committed.receipts;
  reportBatchWork(owner, committed.outcomes, before);
  for (const outcome of committed.outcomes) {
    if (Object.hasOwn(outcome, "error")) outcome.item.reject(outcome.error);
    else if (Object.hasOwn(outcome, "aborted")) outcome.item.resolve({ aborted: outcome.aborted });
    else if (Object.hasOwn(outcome, "historical"))
      outcome.item.resolve({ historical: outcome.historical });
    else outcome.item.resolve(receiptOutcome(committed.head, outcome.receipt, outcome.replayed));
  }
  return { settled: committed.outcomes.length, needsProjection: committed.needsProjection };
}
