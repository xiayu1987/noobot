/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionEntityKey } from "@noobot/session-protocol/partition-transaction";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  partitionCollectionResultBytes,
  requirePartitionCollectionPageLimit,
} from "@noobot/session-protocol/partition-collection-query";
import { prepareMessageDiagnostics, readMessageDiagnosticPage } from "../message-diagnostics.js";

const storageError = (message) => partitionJournalError("SESSION_STORAGE_CORRUPT", message);

export function preparePartitionMessageDiagnostics(view, mutations, diagnostics) {
  if (!diagnostics.length) return;
  const pending = new Map(
    mutations.map((mutation, slot) => [
      partitionEntityKey(mutation.collection, mutation.key),
      slot,
    ]),
  );
  const loaded = new Map();
  return prepareMessageDiagnostics(
    {
      storageError,
      async get(collection, key) {
        const identity = partitionEntityKey(collection, key);
        const slot = pending.get(identity);
        if (slot !== undefined) return mutations[slot].value;
        if (!loaded.has(identity)) {
          const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
          loaded.set(identity, entry);
        }
        const entry = loaded.get(identity);
        return entry?.mutation.remove ? null : (entry?.mutation.value ?? null);
      },
      set(collection, key, value) {
        const identity = partitionEntityKey(collection, key);
        const slot = pending.get(identity);
        const owner = slot === undefined ? loaded.get(identity)?.owner : mutations[slot].owner;
        const index = slot ?? mutations.length;
        mutations[index] = { collection, key, value, owner: owner ?? null };
        pending.set(identity, index);
      },
    },
    diagnostics,
  );
}

export async function readPartitionMessageDiagnosticPage({
  read,
  scope,
  snapshot,
  options,
  dialogProcessId,
}) {
  requirePartitionCollectionPageLimit(snapshot, options.limit);
  const getMany = async (collection, keys) =>
    new Map(
      [...(await read({ collection, keys }))].map(([key, mutation]) => [
        key,
        mutation?.value ?? null,
      ]),
    );
  const page = await readMessageDiagnosticPage(
    {
      sessionId: scope.sessionId,
      getMany,
      get: async (collection, key) => (await getMany(collection, [key])).get(key),
      storageError,
    },
    options,
    dialogProcessId,
  );
  partitionCollectionResultBytes(page, snapshot.limits.pageBytes);
  return page;
}
