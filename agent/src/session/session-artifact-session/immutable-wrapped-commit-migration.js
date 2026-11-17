/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireImmutableWrappedCommitReference,
  immutableMigrationCommitOrigins,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableOrderKey } from "./immutable-order-key.js";

export function wrappedImmutableCommitIndex(version) {
  return Object.freeze({
    origins: immutableMigrationCommitOrigins(version),
    async readReference(store, snapshot, generation) {
      return requireImmutableWrappedCommitReference(
        await store.get(snapshot, "commitOrder", immutableOrderKey(generation)),
        store.requireReference,
      );
    },
    async indexCommit({ index, objects, root, generation, commit }) {
      const order = await index.set(
        await index.get(root, "commitOrder"),
        immutableOrderKey(generation),
        await objects.putValue(commit),
      );
      return index.set(root, "commitOrder", order);
    },
  });
}
