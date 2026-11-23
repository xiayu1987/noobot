/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPartitionMutationReader } from "@noobot/session-protocol/partition-transaction";

const address = (collection, key) => JSON.stringify([collection, key]);

export function createPartitionIndexMutations(view, mutations) {
  const slots = new Map(
    mutations.map(({ collection, key }, slot) => [address(collection, key), slot]),
  );
  const originals = new Map();
  const owners = new Map();
  const writes = new Map();
  async function loadOriginals(collection, keys) {
    const missing = keys.filter((key) => !originals.has(address(collection, key)));
    for (let offset = 0; offset < missing.length; offset += view.pageRecords) {
      const entries = await view.getLatestMany({
        collection,
        keys: missing.slice(offset, offset + view.pageRecords),
      });
      for (const [key, entry] of entries) originals.set(address(collection, key), entry);
    }
  }
  async function original(collection, key) {
    const id = address(collection, key);
    if (!originals.has(id)) await loadOriginals(collection, [key]);
    return originals.get(id);
  }
  const staged = (collection, key) => {
    const id = address(collection, key);
    return writes.get(id) ?? mutations[slots.get(id)];
  };
  async function loadOwners(collection, keys) {
    const missing = keys.filter((key) => {
      const id = address(collection, key);
      return !slots.has(id) && !originals.has(id) && !owners.has(id);
    });
    for (let offset = 0; offset < missing.length; offset += view.pageRecords) {
      const entries = await view.getCreationOwners({
        collection,
        keys: missing.slice(offset, offset + view.pageRecords),
      });
      for (const [key, owner] of entries) owners.set(address(collection, key), owner);
    }
  }
  function originalOwner(collection, key) {
    const id = address(collection, key);
    const slot = slots.get(id);
    if (slot !== undefined) return mutations[slot].owner;
    if (originals.has(id)) {
      const entry = originals.get(id);
      return entry === null ? null : entry.owner;
    }
    if (!owners.has(id)) throw new TypeError("Missing projection mutation owner lookup");
    return owners.get(id);
  }
  const readOriginal = createPartitionMutationReader(async ({ collection, keys }) => {
    await loadOriginals(collection, keys);
    return new Map(keys.map((key) => [key, originals.get(address(collection, key))]));
  });
  const readStaged = createPartitionMutationReader(async ({ collection, keys }) => {
    await loadOriginals(
      collection,
      keys.filter((key) => staged(collection, key) === undefined),
    );
    await loadOwners(
      collection,
      keys.filter((key) => writes.has(address(collection, key))),
    );
    return new Map(
      keys.map((key) => {
        const mutation = staged(collection, key);
        if (mutation === undefined) return [key, originals.get(address(collection, key))];
        const owner = writes.has(address(collection, key))
          ? originalOwner(collection, key)
          : mutation.owner;
        return [key, { mutation: { ...mutation, owner }, owner }];
      }),
    );
  });
  async function read(collection, key) {
    const entry = await original(collection, key);
    return isAbsentEntry(entry) ? null : entry.mutation.value;
  }

  function isAbsentEntry(entry) {
    return entry === null || entry.mutation.remove;
  }
  async function getMany(collection, keys) {
    await loadOriginals(
      collection,
      keys.filter((key) => staged(collection, key) === undefined),
    );
    return new Map(
      keys.map((key) => {
        let mutation = staged(collection, key);
        if (mutation === undefined) {
          const entry = originals.get(address(collection, key));
          mutation = entry === null ? null : entry.mutation;
        }
        return [key, mutation === null || mutation.remove ? null : mutation.value];
      }),
    );
  }
  async function loadWriteBases() {
    const groups = new Map();
    for (const { collection, key, remove } of writes.values()) {
      if (!groups.has(collection)) groups.set(collection, { retirements: [], updates: [] });
      const { retirements, updates } = groups.get(collection);
      (remove ? retirements : updates).push(key);
    }
    for (const [collection, { retirements, updates }] of groups) {
      await loadOriginals(collection, retirements);
      await loadOwners(collection, updates);
    }
  }

  function writeMutation(slot, mutation) {
    if (slot === undefined) mutations.push(mutation);
    else mutations[slot] = mutation;
  }

  function mergeIndexWrites() {
    const canceled = new Set();
    for (const [id, mutation] of writes) {
      const slot = slots.get(id);
      const { collection, key, remove } = mutation;
      if (!remove || !isAbsentEntry(originals.get(id))) {
        const next = { ...mutation, owner: originalOwner(collection, key) };
        writeMutation(slot, next);
      } else if (slot !== undefined) canceled.add(slot);
    }
    for (const slot of [...canceled].sort((a, b) => b - a)) mutations.splice(slot, 1);
  }

  return {
    changes: () => mutations,
    read,
    readOriginal,
    readStaged,
    getMany,
    hasStaged: (collection, key) => staged(collection, key) !== undefined,
    get(collection, key) {
      const mutation = staged(collection, key);
      if (mutation === undefined) return read(collection, key);
      return mutation.remove ? null : mutation.value;
    },
    set(collection, key, value) {
      writes.set(address(collection, key), { collection, key, value });
    },
    remove(collection, key) {
      writes.set(address(collection, key), { collection, key, remove: true });
    },
    async apply() {
      await loadWriteBases();
      mergeIndexWrites();
    },
  };
}
