/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageContextDirectory } from "@noobot/session-protocol/immutable-context-directory-adapter";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";

const collection = "contextDialogRanges";
const pageKey = (prefix) => prefix || "root";

export function seedImmutableContextDirectory(plan) {
  plan.set(collection, "root", { ordinals: [] });
}

export async function updateImmutableContextDirectory(plan, ordinal, present) {
  return immutableStorageContextDirectory.update(
    {
      getMany: async (prefixes) => {
        const pages = await plan.getMany(collection, prefixes.map(pageKey));
        return new Map(prefixes.map((prefix) => [prefix, pages.get(pageKey(prefix))]));
      },
      set: (prefix, page) => plan.set(collection, pageKey(prefix), page),
      remove: (prefix) => plan.remove(collection, pageKey(prefix)),
    },
    ordinal,
    present,
  );
}

export async function* readImmutableContextDialogs(store, snapshot, budget) {
  for await (const ordinal of immutableStorageContextDirectory.read((prefix) =>
    store.get(snapshot, collection, pageKey(prefix)),
  )) {
    budget.consume("dialogs");
    const id = await store.get(snapshot, "dialogOrder", immutableOrderKey(ordinal));
    const dialog = typeof id === "string" && id ? await store.get(snapshot, "dialogs", id) : null;
    if (dialog?.dialogProcessId !== id || dialog.dialogOrdinal !== ordinal)
      throw immutableStorageError("Context directory dialog ownership or order mismatch");
    yield id;
  }
}
