/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stat } from "node:fs/promises";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { projectCheckpointIdentity } from "@noobot/session-protocol/summary-checkpoint-storage";

export async function readFileIdentity(file) {
  const info = await stat(file, { bigint: true });
  const changedAtMs = Math.max(Number(info.mtimeMs), Number(info.ctimeMs));
  return {
    key: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
    bytes: Number(info.size),
    reusable: Date.now() - changedAtMs > TIME_THRESHOLDS.agent.snapshotIdentityGuardMs,
  };
}

function requireBudget(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`snapshot cache requires a non-negative integer ${label}`);
  }
}

function createByteLru(byteBudget) {
  const entries = new Map();
  let bytes = 0;
  function remove(file) {
    const entry = entries.get(file);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(file);
  }
  return {
    remove,
    get(file) {
      const entry = entries.get(file);
      if (!entry) return null;
      entries.delete(file);
      entries.set(file, entry);
      return entry;
    },
    set(file, entry) {
      remove(file);
      if (entry.bytes > byteBudget) return;
      entries.set(file, entry);
      bytes += entry.bytes;
      for (const candidate of entries.keys()) {
        if (bytes <= byteBudget) break;
        remove(candidate);
      }
    },
    bytes: () => bytes,
  };
}

export function createVerifiedSnapshotCache({ payloadByteBudget, identityByteBudget }) {
  requireBudget(payloadByteBudget, "payloadByteBudget");
  requireBudget(identityByteBudget, "identityByteBudget");
  const identities = createByteLru(identityByteBudget);
  const payloads = createByteLru(payloadByteBudget);

  function forget(file) {
    identities.remove(file);
    payloads.remove(file);
  }

  function matches(entry, contentHash, identity) {
    return (
      identity.reusable === true &&
      entry.identity.reusable === true &&
      entry.contentHash === contentHash &&
      entry.identity.key === identity.key
    );
  }

  function lookup(tier, file, contentHash, identity) {
    const entry = tier.get(file);
    if (!entry) return null;
    if (matches(entry, contentHash, identity)) return entry.value;
    forget(file);
    return null;
  }

  return Object.freeze({
    checkpoint: (file, contentHash, identity) => lookup(identities, file, contentHash, identity),
    payload: (file, contentHash, identity) => lookup(payloads, file, contentHash, identity),
    forget,
    retain(file, contentHash, identity, payload) {
      forget(file);
      const checkpoint = deepFreeze(structuredClone(projectCheckpointIdentity(payload)));
      const frozenPayload = deepFreeze(structuredClone(payload));
      identities.set(file, {
        contentHash,
        identity,
        value: checkpoint,
        bytes: Buffer.byteLength(JSON.stringify(checkpoint)),
      });
      payloads.set(file, {
        contentHash,
        identity,
        value: frozenPayload,
        bytes: identity.bytes,
      });
      return { checkpoint, payload: frozenPayload };
    },
    cachedBytes: () => ({ identity: identities.bytes(), payload: payloads.bytes() }),
  });
}

let verifiedSnapshotCache = null;

export function getVerifiedSnapshotCache() {
  verifiedSnapshotCache ??= createVerifiedSnapshotCache({
    payloadByteBudget: LENGTH_THRESHOLDS.artifact.verifiedSnapshotCacheBytes,
    identityByteBudget: LENGTH_THRESHOLDS.artifact.verifiedCheckpointIdentityCacheBytes,
  });
  return verifiedSnapshotCache;
}
