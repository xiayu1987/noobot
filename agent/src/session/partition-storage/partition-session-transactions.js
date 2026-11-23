/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertPartitionSessionMetadataMutations,
  assertPartitionStoredSessionMetadata,
  capturePartitionSessionScope,
  PARTITION_SESSION_METADATA,
} from "@noobot/session-protocol/partition-transaction";
import {
  assertPartitionInitializationScope,
  capturePartitionSessionInitializationRequest,
  preparePartitionSessionInitialization,
  projectPartitionSessionInitialization,
} from "@noobot/session-protocol/partition-session-initialization";
import { PartitionTransactions } from "./partition-transactions.js";
import { seedPartitionDisplayPublication } from "./partition-display-publication.js";

const address = ({ collection, key }) => JSON.stringify([collection, key]);

function stageInitialization(view, seed) {
  const staged = new Map(seed.map((mutation) => [address(mutation), { mutation, owner: null }]));
  return {
    ...view,
    async getLatestMany(query) {
      const entries = await view.getLatestMany(query);
      for (const [key, entry] of entries) {
        const initial = staged.get(address({ collection: query.collection, key }));
        if (!initial) continue;
        if (entry !== null) throw new Error("Initialization records already exist");
        entries.set(key, initial);
      }
      return entries;
    },
  };
}

const snapshotMetadata = new WeakMap();

export class PartitionSessionTransactions {
  #transactions;
  #scope;

  constructor(journal, scope) {
    this.#scope = capturePartitionSessionScope(scope);
    this.#transactions = new PartitionTransactions(journal);
  }

  prepareRequest(snapshot, request) {
    return this.#transactions.prepareRequest(snapshot, request);
  }

  prepareInitialization(snapshot, input) {
    return this.#transactions.withCollectionReader(snapshot, () =>
      capturePartitionSessionInitializationRequest(snapshot, input),
    );
  }

  initialize(request, prepareTurn, projectTurn) {
    return this.#commit(request, {
      validateScope: async (snapshot, view) => {
        const { collection, key } = PARTITION_SESSION_METADATA;
        const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
        assertPartitionInitializationScope(snapshot, entry?.mutation.value ?? null, this.#scope);
      },
      prepare: async (snapshot, view, input) => {
        const seed = preparePartitionSessionInitialization(
          snapshot,
          view.generation,
          input,
          this.#scope,
        );
        seed.mutations.push(...seedPartitionDisplayPublication());
        if (input.initialTurn === null) return seed;
        const prepared = await prepareTurn(
          snapshot,
          stageInitialization(view, seed.mutations),
          input.initialTurn,
          this.#scope,
        );
        if (prepared.action !== "commit") return prepared;
        const written = new Set(prepared.mutations.map(address));
        return {
          ...prepared,
          mutations: [
            ...prepared.mutations,
            ...seed.mutations.filter((entry) => !written.has(address(entry))),
          ],
          result: { ...seed.result, ...prepared.result },
        };
      },
      projectResult: (outcome, mutations) => ({
        ...projectPartitionSessionInitialization(outcome, mutations),
        ...(request.input.initialTurn === null ? {} : projectTurn(outcome, mutations)),
      }),
    });
  }

  async #validateScope(snapshot, readMetadata) {
    const { collection, key } = PARTITION_SESSION_METADATA;
    const metadata = await readMetadata({ collection, keys: [key] }, key);
    assertPartitionStoredSessionMetadata(snapshot, metadata, this.#scope);
    return metadata;
  }

  commit(request, prepare, projectResult) {
    return this.#commit(request, {
      projectResult,
      validateScope: (snapshot, view) =>
        this.#validateScope(
          snapshot,
          async (query, key) => (await view.getLatestMany(query)).get(key)?.mutation.value,
        ),
      prepare: (snapshot, view, input) => prepare(snapshot, view, input, this.#scope),
    });
  }

  #commit(request, callbacks) {
    return this.#transactions.commit(request, {
      ...callbacks,
      prepare: async (snapshot, view, input) => {
        const prepared = await callbacks.prepare(snapshot, view, input);
        if (prepared.action === "commit")
          assertPartitionSessionMetadataMutations(snapshot, prepared.mutations, this.#scope);
        return prepared;
      },
    });
  }

  readMetadata(snapshot) {
    return this.#transactions.withCollectionReader(snapshot, async (read) =>
      structuredClone(await this.#readSnapshotMetadata(snapshot, read)),
    );
  }

  readCheckpointOrigin(snapshot, key) {
    return this.#transactions.readEntityTransaction({
      snapshot,
      collection: "checkpoints",
      key,
      creation: true,
    });
  }

  async #readSnapshotMetadata(snapshot, read) {
    let pending = snapshotMetadata.get(snapshot);
    if (pending === undefined) {
      const { collection, key } = PARTITION_SESSION_METADATA;
      pending = read({ collection, keys: [key] }).then((records) => records.get(key)?.value);
      snapshotMetadata.set(snapshot, pending);
    }
    let metadata;
    try {
      metadata = await pending;
    } catch (error) {
      if (snapshotMetadata.get(snapshot) === pending) snapshotMetadata.delete(snapshot);
      throw error;
    }
    assertPartitionStoredSessionMetadata(snapshot, metadata, this.#scope);
    return metadata;
  }

  read(snapshot, operation, options) {
    return this.#transactions.withCollectionReader(
      snapshot,
      async (read) => {
        const metadata = await this.#readSnapshotMetadata(snapshot, read);
        return operation(read, this.#scope, {
          generation: snapshot.sequence,
          aggregateVersion: metadata.aggregateVersion,
        });
      },
      options,
    );
  }
}
