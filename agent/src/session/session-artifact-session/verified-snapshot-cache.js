/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stat } from "node:fs/promises";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { fileIdentityKey } from "@noobot/shared/file-identity";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { projectCheckpointIdentity } from "@noobot/session-protocol/summary-checkpoint-storage";
import { memoizeArtifactRead, recordStorageWork } from "./storage-transaction.js";

export async function readFileIdentity(file, { fresh = false } = {}) {
  const read = async () => {
    recordStorageWork("fileIdentityReads");
    return fileIdentityOf(await stat(file, { bigint: true }));
  };
  return fresh ? read() : memoizeArtifactRead("identity", file, read);
}

export function fileIdentityOf(info) {
  const changedAtMs = Math.max(Number(info.mtimeMs), Number(info.ctimeMs));
  return {
    key: fileIdentityKey(info),
    journalKey: `${info.dev}:${info.ino}`,
    bytes: Number(info.size),
    reusable: Date.now() - changedAtMs > TIME_THRESHOLDS.agent.snapshotIdentityGuardMs,
  };
}

function requireBudget(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`snapshot cache requires a non-negative integer ${label}`);
  }
}

export function createByteLru(byteBudget) {
  const probation = new Map();
  const protectedEntries = new Map();
  let bytes = 0;
  let protectedBytes = 0;
  function remove(file) {
    const protectedEntry = protectedEntries.get(file);
    const entry = protectedEntry || probation.get(file);
    if (!entry) return;
    bytes -= entry.bytes;
    if (protectedEntry) protectedBytes -= entry.bytes;
    protectedEntries.delete(file);
    probation.delete(file);
  }
  function balance() {
    for (const [file, entry] of protectedEntries) {
      if (protectedBytes <= byteBudget / 2) break;
      protectedEntries.delete(file);
      protectedBytes -= entry.bytes;
      probation.set(file, entry);
    }
    for (const file of probation.keys()) {
      if (bytes <= byteBudget) break;
      remove(file);
    }
  }
  return {
    remove,
    get(file) {
      const protectedEntry = protectedEntries.get(file);
      const entry = protectedEntry || probation.get(file);
      if (!entry) return null;
      probation.delete(file);
      protectedEntries.delete(file);
      protectedEntries.set(file, entry);
      if (!protectedEntry) protectedBytes += entry.bytes;
      balance();
      return entry;
    },
    set(file, entry) {
      const wasProtected = protectedEntries.has(file);
      remove(file);
      if (entry.bytes > byteBudget) return;
      if (wasProtected) {
        protectedEntries.set(file, entry);
        protectedBytes += entry.bytes;
      } else probation.set(file, entry);
      bytes += entry.bytes;
      balance();
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
    return null;
  }

  return Object.freeze({
    resolvePath(key, resolve) {
      const cached = identities.get(key);
      if (cached) return cached.path;
      const path = resolve();
      identities.set(key, { path, bytes: Buffer.byteLength(JSON.stringify([key, path])) });
      return path;
    },
    checkpoint: (file, contentHash, identity) => lookup(identities, file, contentHash, identity),
    payload: (file, contentHash, identity) => lookup(payloads, file, contentHash, identity),
    previousPayload(file, contentHash) {
      const entry = payloads.get(file);
      return entry?.contentHash === contentHash ? entry.value : undefined;
    },
    forget,
    revalidate(tier, file, contentHash, identity) {
      let verified = null;
      for (const [name, cache] of [
        ["checkpoint", identities],
        ["payload", payloads],
      ]) {
        const entry = cache.get(file);
        if (!entry || entry.contentHash !== contentHash) continue;
        cache.set(file, { ...entry, identity });
        if (name === tier) verified = entry.value;
      }
      return verified;
    },
    retain(file, contentHash, identity, payload) {
      forget(file);
      const checkpoint = projectCheckpointIdentity(payload);
      const frozenPayload = deepFreeze(payload);
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
