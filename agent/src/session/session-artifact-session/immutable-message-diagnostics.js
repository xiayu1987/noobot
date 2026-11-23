/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { prepareMessageDiagnostics, readMessageDiagnosticPage } from "../message-diagnostics.js";
import { immutableStorageError } from "./immutable-object-store.js";

export function prepareImmutableMessageDiagnostics(plan, diagnostics) {
  return prepareMessageDiagnostics(
    {
      get: (...args) => plan.get(...args),
      set: (...args) => plan.set(...args),
      storageError: immutableStorageError,
    },
    diagnostics,
  );
}

export function readImmutableMessageDiagnosticPage(store, snapshot, options, dialogProcessId) {
  return readMessageDiagnosticPage(
    {
      sessionId: store.sessionId,
      get: (collection, key) => store.get(snapshot, collection, key),
      getMany: (collection, keys) => store.getMany(snapshot, collection, keys),
      storageError: immutableStorageError,
    },
    options,
    dialogProcessId,
  );
}
