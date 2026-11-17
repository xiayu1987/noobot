/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_CURRENT_SESSION_FORMAT,
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  immutableStorageError,
  decodeImmutableJsonBytes,
} from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_JSON_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { ImmutableObjectStore } from "./immutable-object-store.js";
import { ImmutableRecordStore } from "./immutable-record-store.js";
import { ImmutableLocatedRecordStore } from "./immutable-located-record-store.js";
import { validateImmutableIndexPage } from "./immutable-radix-index.js";
import { requireImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

class SealedSource extends ImmutableRecordStore {
  static format = IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT;

  async validateSnapshot() {}

  beginCommit() {
    throw new Error("Sealed storage source is read-only");
  }
}

class JsonLocatedSource extends ImmutableLocatedRecordStore {
  static format = IMMUTABLE_JSON_LOCATED_SESSION_FORMAT;

  decodeLocationPage(bytes, reference) {
    return decodeImmutableJsonBytes(bytes, reference);
  }

  requireLocationPagePath(page, prefix) {
    return validateImmutableIndexPage(page, prefix, requireImmutableRecordReference);
  }

  beginCommit() {
    throw new Error("JSON located storage source is read-only");
  }
}

const BACKENDS = new Map(
  [
    ImmutableObjectStore,
    SealedSource,
    ImmutableRecordStore,
    JsonLocatedSource,
    ImmutableLocatedRecordStore,
  ].map((backend) => [backend.format, backend]),
);

export function immutableOfflineBackend(format) {
  const backend = BACKENDS.get(format);
  if (!backend) throw immutableStorageError("Unknown immutable session storage format");
  return backend;
}

export const CurrentImmutableRecordStore = immutableOfflineBackend(
  IMMUTABLE_CURRENT_SESSION_FORMAT,
);
