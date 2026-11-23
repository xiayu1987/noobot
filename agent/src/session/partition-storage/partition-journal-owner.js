/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { createSessionJournalLease } from "@noobot/session-protocol/session-reader";
import {
  createSessionJournalRetirementError,
  PARTITION_SESSION_PUBLICATION,
  requirePartitionSessionStorageBudget,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "./partition-journal.js";
import { readPartitionStorageRoot } from "../session-storage-authority.js";
import { syncStorageDirectory } from "../../shared/storage/durable-file.js";
import { withUnretainedJournal } from "./journal-snapshots.js";

export class PartitionJournalOwner {
  constructor({ durableAncestor, limits, maxJournals, allowNewJournals = true }) {
    if (typeof durableAncestor !== "string" || !path.isAbsolute(durableAncestor))
      throw new TypeError("Journal owner requires an absolute durable ancestor");
    if (!Number.isSafeInteger(maxJournals) || maxJournals < 1)
      throw new TypeError("Invalid maxJournals");
    this.durableAncestor = path.resolve(durableAncestor);
    this.limits = allowNewJournals
      ? requirePartitionSessionStorageBudget({ journalLimits: limits, maxJournals }).journalLimits
      : null;
    this.maxJournals = maxJournals;
    this.entries = new Map();
    this.pending = Promise.resolve();
    this.closing = false;
    this.closePromise = null;
  }

  serialize(operation) {
    const pending = this.pending.then(operation);
    this.pending = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async acquire(scope, { create = false } = {}) {
    while (!this.closing) {
      const admission = await this.serialize(() => this.#admit(scope, create));
      if (admission.lease) return admission.lease;
      try {
        await admission.retirement;
      } catch (cause) {
        throw createSessionJournalRetirementError(cause);
      }
    }
    throw partitionJournalError("SESSION_STORAGE_CLOSED", "Journal owner is closing");
  }

  #requireSessionDirectory(scope) {
    const sessionDir = path.resolve(scope.sessionDir);
    const relative = path.relative(this.durableAncestor, sessionDir);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new TypeError("Journal scope must be below its durable ancestor");
    return sessionDir;
  }

  async #openDurableJournal({ root, sessionDir, sessionId }) {
    if (root !== sessionDir) await syncStorageDirectory(sessionDir);
    return PartitionJournal.open({ root, sessionId });
  }

  #retireIdleJournal() {
    for (const entry of this.entries.values()) {
      if (entry.users === 0) return this.#retire(entry);
    }
    throw partitionJournalError("SESSION_MUTATION_BUSY", "Resident journal budget is exhausted");
  }

  async #admit(scope, create) {
    if (this.closing)
      throw partitionJournalError("SESSION_STORAGE_CLOSED", "Journal owner is closing");
    const sessionDir = this.#requireSessionDirectory(scope);
    const storageRoot = await readPartitionStorageRoot(sessionDir);
    const root = storageRoot ?? sessionDir;
    let entry = this.entries.get(root);
    if (entry && entry.sessionId !== scope.sessionId)
      throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Journal belongs to another session");
    if (entry?.journal.failure) throw entry.journal.failure;
    if (entry?.retiring) return { retirement: this.#retire(entry) };
    if (!storageRoot && !create)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Session scope has no partition authority",
      );
    if (!storageRoot && this.limits === null)
      throw partitionJournalError(
        "SESSION_STORAGE_AUTHORITY_MISMATCH",
        "New partition sessions are disabled",
      );
    if (!entry) {
      if (this.entries.size === this.maxJournals) return { retirement: this.#retireIdleJournal() };
      const journal = storageRoot
        ? await this.#openDurableJournal({ root, sessionDir, sessionId: scope.sessionId })
        : await PartitionJournal.create({
            root,
            sessionId: scope.sessionId,
            durableAncestor: this.durableAncestor,
            limits: this.limits,
            publication: PARTITION_SESSION_PUBLICATION,
          });
      entry = {
        journal,
        sessionId: scope.sessionId,
        users: 0,
        drained: null,
        retiring: false,
        retirement: null,
      };
      this.entries.set(root, entry);
    }
    entry.users += 1;
    const release = async () => {
      entry.users -= 1;
      if (!entry.users) entry.drained?.();
    };
    return { lease: createSessionJournalLease({ journal: entry.journal, release }) };
  }

  withRemoval({ sessionDir, root }, remove) {
    return this.serialize(() => {
      this.#requireSessionDirectory({ sessionDir });
      const entry = this.entries.get(root);
      if (
        entry &&
        (entry.users || entry.retirement || entry.journal.running || entry.journal.queue.length)
      )
        throw partitionJournalError(
          "SESSION_MUTATION_BUSY",
          "Session deletion requires journal users and writers to drain",
        );
      return withUnretainedJournal(
        root,
        () => {
          if (entry) {
            entry.journal.closed = true;
            this.entries.delete(root);
          }
          return remove();
        },
        { residentJournal: entry?.journal },
      );
    });
  }

  #retire(entry) {
    entry.retiring = true;
    entry.retirement ??= Promise.resolve()
      .then(async () => {
        if (entry.users) await new Promise((resolve) => (entry.drained = resolve));
        await entry.journal.retire();
        this.entries.delete(entry.journal.root);
      })
      .finally(() => {
        entry.retirement = null;
      });
    return entry.retirement;
  }

  async #retireAll(entries, message) {
    const results = await Promise.allSettled(entries.map((entry) => this.#retire(entry)));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        message,
      );
  }

  async releaseWorkspace(workspacePath) {
    const { retirement } = await this.serialize(() => {
      const entries = [...this.entries.values()].filter((entry) =>
        entry.journal.root.startsWith(`${workspacePath}${path.sep}`),
      );
      if (entries.some((entry) => entry.users !== 0))
        throw new Error("Workspace journal still has active leases after draining");
      return { retirement: this.#retireAll(entries, "Workspace journal release failed") };
    });
    await retirement;
  }

  stopAdmissions() {
    this.closing = true;
  }

  close() {
    this.stopAdmissions();
    if (!this.closePromise)
      this.closePromise = this.serialize(() => ({
        retirement: this.#retireAll([...this.entries.values()], "Journal owner shutdown failed"),
      }))
        .then(({ retirement }) => retirement)
        .catch((cause) => {
          this.closePromise = null;
          throw cause;
        });
    return this.closePromise;
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }
}
