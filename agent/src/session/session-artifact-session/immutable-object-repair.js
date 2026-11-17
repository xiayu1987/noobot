/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { contentDigest } from "./immutable-storage-io.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import {
  requireImmutableStoredContent,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { auditLockedImmutableSession } from "./immutable-session-audit.js";
import { readImmutableReaderRetentions } from "./immutable-reader-retention.js";

export function captureImmutableObjectRepairs(replacements) {
  if (!Array.isArray(replacements))
    throw new TypeError("Object repairs require a replacements array");
  const captured = new Map();
  for (const replacement of replacements) {
    const reference = replacement.reference;
    if (
      typeof reference !== "string" ||
      captured.has(reference) ||
      !Buffer.isBuffer(replacement.bytes) ||
      replacement.bytes.length > LENGTH_THRESHOLDS.immutableStorage.blockBytes
    )
      throw immutableStorageError(
        "Object repair requires unique references and bounded byte buffers",
      );
    captured.set(reference, Buffer.from(replacement.bytes));
  }
  return captured;
}

export async function restoreImmutableObjects({
  sessionDir,
  sessionId,
  replacements,
  signal,
  objectStore,
}) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId, objectStore });
  for (const [reference, bytes] of replacements)
    requireImmutableStoredContent(
      reference,
      {
        digest: contentDigest(bytes),
        length: bytes.length,
      },
      store.format,
    );
  const preflight = await auditLockedImmutableSession({
    sessionDir,
    sessionId: store.sessionId,
    objectStore: store.objects.constructor,
    objectOverrides: replacements,
    signal,
  });
  if (!preflight.ok) {
    throw Object.assign(
      immutableStorageError("Object repair cannot restore the complete committed graph"),
      { report: preflight },
    );
  }
  const snapshot = await store.snapshot();
  return store.objects.withPhysicalRepairOverlay(
    { replacements, used: new Set(), signal },
    async () => {
      const retained = await readImmutableReaderRetentions(store, snapshot, signal);
      return store.objects.restoreRecords(replacements, {
        signal,
        snapshots: [snapshot, ...retained],
      });
    },
  );
}
