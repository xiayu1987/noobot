/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";
import { setImmediate as yieldToMaintenance } from "node:timers/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isFunction } from "@noobot/shared/value";
import {
  PARTITION_JOURNAL_PUBLICATION_LOCK,
  assertPartitionSessionJournalPolicy,
  createPartitionJournalHead,
  encodePartitionJournalFrameRequest,
  partitionJournalBatchBudget,
  partitionJournalError,
  partitionJournalPublicationParticipants,
  partitionEpochOctets,
} from "@noobot/session-protocol/partition-journal";
import { planPartitionTransaction } from "@noobot/session-protocol/partition-transaction";
import { fsStat } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory } from "../../shared/storage/durable-file.js";
import { withJournalPublicationLock } from "./journal-publication-lock.js";
import { withSessionStorageAuthorityLock } from "../session-storage-authority.js";
import { readPartitionSessionAuthority } from "./partition-session-authority.js";
import {
  CommittedJournalDamage,
  encodeJournalFrame,
  discardUnpublishedJournalHead,
  initializeJournalHead,
  prepareJournalDirectory,
  readJournalHead,
} from "./journal-io.js";
import {
  readJournalPage,
  readJournalPartitionPage,
  readJournalSequencePage,
} from "./journal-reader.js";
import { commitJournalBatch } from "./journal-writer.js";
import { projectPartitionEntityUpdates } from "./partition-entity-directory.js";
import { capturePartitionJournalWork } from "../session-storage-observation.js";
import { discardUnpublishedSuffix } from "./journal-recovery.js";
import {
  readJournalRecord,
  readJournalRecordSlots,
  readJournalSequenceRecord,
  withJournalRecordReader,
} from "./journal-record.js";
import {
  acquireJournalSnapshot,
  recoverSnapshotRetentions,
  releaseJournalSnapshot,
  retryUnclaimedSnapshotReleases,
  withJournalSnapshot,
  withLockedJournalSnapshot,
  usingJournalSnapshot,
} from "./journal-snapshots.js";

function createWorkCounters() {
  return {
    readBytes: 0,
    entityDirectoryReadBytesByLevel: [],
    entityDirectoryWriteBytesByLevel: [],
    writeBytes: 0,
    controlWriteBytes: 0,
    dataSyncs: 0,
    publications: 0,
    partitionOpens: 0,
  };
}

function rejectBatch(items, error) {
  for (const item of items) item.reject(error);
}

function errorChainReports(error, matches, seen = new Set()) {
  if (!error || seen.has(error)) return false;
  seen.add(error);
  return (
    matches(error) ||
    errorChainReports(error.cause, matches, seen) ||
    (error instanceof AggregateError &&
      error.errors.some((cause) => errorChainReports(cause, matches, seen)))
  );
}

export class PartitionJournal {
  static async create({ root, durableAncestor, sessionId, limits, publication }) {
    const owner = new PartitionJournal(root);
    owner.head = createPartitionJournalHead({
      sessionId,
      epoch: randomBytes(partitionEpochOctets).toString("hex"),
      limits,
      publication,
    });
    if (typeof durableAncestor !== "string" || !path.isAbsolute(durableAncestor))
      throw new TypeError("Journal creation requires a durable ancestor path");
    const ancestor = path.resolve(durableAncestor);
    if (!(await fsStat(ancestor)).isDirectory())
      throw new TypeError("Journal creation ancestor must be a directory");
    if (ancestor === owner.root)
      throw new TypeError("Journal root must be below its durable ancestor");
    await withSessionStorageAuthorityLock(owner.root, async () => {
      await readPartitionSessionAuthority(owner.root);
      await prepareJournalDirectory(ancestor, owner.root);
      await initializeJournalHead(owner.root, owner.head, owner.work);
    });
    owner.receipts = [];
    return owner;
  }

  static async open({ root, sessionId, expectedSessionLimits }) {
    const owner = new PartitionJournal(root);
    await owner.#recoverPublication({ sessionId, expectedSessionLimits });
    return owner;
  }

  async #recoverPublication({ sessionId, expectedSessionLimits, previous }) {
    await readPartitionSessionAuthority(this.root);
    await withJournalPublicationLock(this.lockPath, async () => {
      const head = await readJournalHead(this.root, this.work);
      if (
        head.sessionId !== sessionId ||
        (previous && (head.epoch !== previous.epoch || head.publication !== previous.publication))
      )
        throw partitionJournalError(
          "SESSION_STORAGE_IDENTITY",
          "Journal publication identity changed",
        );
      if (previous && head.sequence < previous.sequence)
        throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Publication sequence regressed");
      if (expectedSessionLimits !== undefined)
        assertPartitionSessionJournalPolicy(head, expectedSessionLimits);
      await syncStorageDirectory(this.root);
      await discardUnpublishedSuffix(this.root, head);
      await discardUnpublishedJournalHead(this.root);
      await recoverSnapshotRetentions(this, head);
      this.head = head;
    });
  }

  constructor(root) {
    if (typeof root !== "string" || !root) throw new TypeError("Journal root is required");
    this.root = path.resolve(root);
    this.lockPath = path.join(this.root, PARTITION_JOURNAL_PUBLICATION_LOCK);
    this.work = createWorkCounters();
    this.receipts = null;
    this.queue = [];
    this.queuedBytes = 0;
    this.running = null;
    this.timer = null;
    this.closed = false;
    this.failure = null;
    this.publicationParticipants = new Map();
  }

  registerPublicationParticipant(name, { validate, plan, prepare, published }) {
    if (
      typeof name !== "string" ||
      !name ||
      !isFunction(validate) ||
      !isFunction(plan) ||
      !isFunction(prepare) ||
      !isFunction(published)
    )
      throw new TypeError(
        "Publication participant requires validate, plan, prepare and published functions",
      );
    if (!partitionJournalPublicationParticipants(this.head.publication).includes(name))
      throw partitionJournalError(
        "SESSION_PUBLICATION_CONTRACT",
        "Participant is not part of this journal protocol",
      );
    if (this.publicationParticipants.has(name) || this.running || this.queue.length)
      throw new Error("Publication participant must be uniquely registered before writing");
    this.publicationParticipants.set(name, { validate, plan, prepare, published });
  }

  requirePublicationParticipants() {
    for (const name of partitionJournalPublicationParticipants(this.head.publication))
      if (!this.publicationParticipants.has(name))
        throw partitionJournalError(
          "SESSION_PUBLICATION_CONTRACT",
          "Required publication participant is not registered",
        );
  }

  async planPublication(context, states) {
    this.requirePublicationParticipants();
    const planned = new Map();
    for (const [name, participant] of this.publicationParticipants)
      planned.set(name, await participant.plan({ ...context, state: states.get(name) }));
    return planned;
  }

  async preparePublication({ previous, snapshot, records, states }) {
    this.requirePublicationParticipants();
    const collectionRoots = new Map();
    for (const [name, { prepare }] of this.publicationParticipants)
      await prepare({ previous, snapshot, records, state: states.get(name), collectionRoots });
    return collectionRoots;
  }

  cachePublication({ previous, snapshot, records, states }) {
    for (const [name, { published }] of this.publicationParticipants)
      published({ previous, snapshot, records, state: states.get(name) });
  }

  append(request) {
    if (this.head.publication !== "journal")
      return Promise.reject(
        partitionJournalError("SESSION_PUBLICATION_CONTRACT", "Use the transaction entry point"),
      );
    try {
      const encoded = this.encodeRequest(request);
      return this.#enqueue({ ...encoded, reservedBytes: encoded.frame.length });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  appendTransaction(identity, { validateScope, prepare }) {
    if (
      this.head.publication !== "collections" ||
      !isFunction(validateScope) ||
      !isFunction(prepare)
    )
      return Promise.reject(
        partitionJournalError(
          "SESSION_PUBLICATION_CONTRACT",
          "Collection transactions require scope validation and preparation",
        ),
      );
    return this.#enqueue({
      request: identity,
      validateScope,
      reservedBytes: this.head.limits.transactionBytes,
      prepare: async (snapshot, stagedEntities, previousGeneration) => {
        const prepared = await prepare(snapshot, stagedEntities, previousGeneration);
        const plan = planPartitionTransaction(identity, prepared, this.head.limits);
        return Object.hasOwn(plan, "aborted") ? plan : this.encodeRequest(plan.request);
      },
    });
  }

  encodeRequest(request) {
    const { body, ...encoded } = encodePartitionJournalFrameRequest(
      request,
      this.head.limits,
      this.head.publication,
    );
    for (const { validate } of this.publicationParticipants.values()) validate(encoded.request);
    return { ...encoded, ...encodeJournalFrame(body) };
  }

  #enqueue(item) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(partitionJournalError("SESSION_STORAGE_CLOSED", "Journal is closed"));
    try {
      this.requirePublicationParticipants();
      if (this.queuedBytes + item.reservedBytes > this.head.limits.queueBytes)
        throw partitionJournalError("SESSION_QUEUE_BUDGET", "Journal queue is full");
    } catch (error) {
      return Promise.reject(error);
    }
    this.queuedBytes += item.reservedBytes;
    const pending = new Promise((resolve, reject) => {
      this.queue.push({
        ...item,
        resolve,
        reject,
        observeJournalWork: capturePartitionJournalWork(),
      });
    });
    if (!this.running) {
      const { batchWaitMs } = this.head.limits;
      const budget = partitionJournalBatchBudget(this.head.limits);
      if (
        batchWaitMs === 0 ||
        this.queue.length >= budget.records ||
        this.queuedBytes >= budget.bytes
      )
        this.startDrain();
      else if (!this.timer) this.timer = setTimeout(() => this.startDrain(), batchWaitMs);
    }
    return pending;
  }

  startDrain() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running)
      this.running = Promise.resolve().then(async () => {
        try {
          while (this.queue.length) await this.drain();
        } finally {
          this.running = null;
        }
      });
    return this.running;
  }

  failBatch(batch, failure) {
    this.failure ??= failure;
    rejectBatch([...batch, ...this.queue], failure);
    this.queue.length = 0;
    this.queuedBytes = 0;
  }

  async publishBatch(batch, progress) {
    while (progress.settled < batch.length) {
      if (this.failure) throw this.failure;
      const { settled, needsProjection } = await commitJournalBatch(
        this,
        batch.slice(progress.settled),
      );
      progress.settled += settled;
      if (needsProjection) {
        await yieldToMaintenance();
        await projectPartitionEntityUpdates(this);
      }
    }
  }

  async drainBatch(batch) {
    const progress = { settled: 0 };
    try {
      await this.publishBatch(batch, progress);
      return true;
    } catch (failure) {
      this.failBatch(batch.slice(progress.settled), failure);
      return false;
    }
  }

  async drain() {
    const { records } = partitionJournalBatchBudget(this.head.limits);
    while (this.queue.length) {
      const batch = this.queue.splice(0, records);
      if (!(await this.drainBatch(batch))) return;
      for (const item of batch) this.queuedBytes -= item.reservedBytes;
    }
  }

  async snapshot() {
    return this.#readSnapshot(() => acquireJournalSnapshot(this));
  }

  async usingSnapshot(operation) {
    return this.#readSnapshot(() => usingJournalSnapshot(this, operation));
  }

  withPublicationSnapshot(read) {
    return this.#readSnapshot(() =>
      withJournalPublicationLock(this.lockPath, async () => {
        const head = await readJournalHead(this.root, this.work);
        return withLockedJournalSnapshot(this, head, read);
      }),
    );
  }

  async releaseSnapshot(snapshot) {
    return releaseJournalSnapshot(this, snapshot);
  }

  async withSnapshot(snapshot, operation) {
    return this.#readSnapshot(() => withJournalSnapshot(this, snapshot, operation));
  }

  withRecordReader(snapshot, operation) {
    return this.withSnapshot(snapshot, () =>
      withJournalRecordReader(this.root, snapshot, operation),
    );
  }

  async #readSnapshot(operation) {
    try {
      return await operation();
    } catch (error) {
      if (
        errorChainReports(error, (cause) => cause instanceof CommittedJournalDamage) &&
        (this.failure === null ||
          error.cause === this.failure ||
          (error instanceof AggregateError && error.errors.includes(this.failure)))
      )
        this.failure = error;
      throw error;
    }
  }

  async readPage({ snapshot, cursor }) {
    return this.withSnapshot(snapshot, () =>
      readJournalPage(this.root, snapshot, cursor, this.work),
    );
  }

  async readPartitionPage({ snapshot, cursor, readBudget }) {
    return this.withSnapshot(snapshot, () =>
      readJournalPartitionPage({
        root: this.root,
        head: snapshot,
        cursor,
        work: this.work,
        readBudget,
      }),
    );
  }

  async close() {
    this.closed = true;
    await this.startDrain();
    if (this.failure) throw this.failure;
    await retryUnclaimedSnapshotReleases(this);
  }

  async retire() {
    try {
      await this.close();
    } catch (failure) {
      if (
        failure !== this.failure ||
        failure.code !== "SESSION_COMMIT_UNCERTAIN" ||
        errorChainReports(failure, (cause) => cause.code === "SESSION_STORAGE_CORRUPT")
      )
        throw failure;
      try {
        await this.#recoverPublication({ sessionId: this.head.sessionId, previous: this.head });
        await retryUnclaimedSnapshotReleases(this);
      } catch (cause) {
        throw new AggregateError([failure, cause], "Journal retirement recovery failed", { cause });
      }
    }
  }

  async readSequencePage({ snapshot, sequence }) {
    return this.withSnapshot(snapshot, () =>
      readJournalSequencePage(this.root, snapshot, sequence, this.work),
    );
  }

  async readSequenceRecord({ snapshot, sequence }) {
    return this.withSnapshot(snapshot, () =>
      readJournalSequenceRecord({ root: this.root, head: snapshot, sequence, work: this.work }),
    );
  }

  async readRecord({ snapshot, reference, readBudget }) {
    return this.withSnapshot(snapshot, () =>
      readJournalRecord({
        root: this.root,
        head: snapshot,
        reference,
        work: this.work,
        readBudget,
      }),
    );
  }

  async readRecordSlots({ snapshot, reference, slots, readBudget }) {
    return this.withSnapshot(snapshot, () =>
      readJournalRecordSlots({
        root: this.root,
        head: snapshot,
        reference,
        slots,
        work: this.work,
        readBudget,
      }),
    );
  }
}
