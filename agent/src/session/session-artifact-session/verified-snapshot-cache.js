/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stat } from "node:fs/promises";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export async function readFileIdentity(file) {
  const info = await stat(file, { bigint: true });
  const changedAtMs = Math.max(Number(info.mtimeMs), Number(info.ctimeMs));
  return {
    key: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
    bytes: Number(info.size),
    reusable: Date.now() - changedAtMs > TIME_THRESHOLDS.agent.snapshotIdentityGuardMs,
  };
}

export function createVerifiedSnapshotCache({ byteBudget }) {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) {
    throw new TypeError("snapshot cache requires a non-negative integer byteBudget");
  }
  const entries = new Map();
  let bytes = 0;
  function remove(file) {
    const entry = entries.get(file);
    if (entry) bytes -= entry.identity.bytes;
    entries.delete(file);
  }
  return Object.freeze({
    get(file, contentHash, identity) {
      if (identity.reusable === false) return null;
      const entry = entries.get(file);
      if (!entry) return null;
      if (
        entry.identity.reusable === false ||
        entry.contentHash !== contentHash ||
        entry.identity.key !== identity.key
      ) {
        remove(file);
        return null;
      }
      entries.delete(file);
      entries.set(file, entry);
      return entry.payload;
    },
    retain(file, contentHash, identity, payload) {
      remove(file);
      if (identity.bytes > byteBudget) return;
      entries.set(file, {
        contentHash,
        identity,
        payload: deepFreeze(structuredClone(payload)),
      });
      bytes += identity.bytes;
      for (const candidate of entries.keys()) {
        if (bytes <= byteBudget) break;
        remove(candidate);
      }
    },
    cachedBytes: () => bytes,
  });
}

export const verifiedSnapshotCache = createVerifiedSnapshotCache({
  byteBudget: LENGTH_THRESHOLDS.artifact.verifiedSnapshotCacheBytes,
});
