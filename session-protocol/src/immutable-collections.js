/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-storage-error.js";
import { SESSION_COLLECTION_NAMES } from "./session-collection-names.js";

const COLLECTIONS = new Set(SESSION_COLLECTION_NAMES);

export function requireImmutableCollection(collection) {
  if (!COLLECTIONS.has(collection)) throw immutableStorageError("Unknown immutable collection");
  return collection;
}
