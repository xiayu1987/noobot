/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveScopedArtifactPath } from "@noobot/path-resolver";
import {
  SESSION_ERROR_CODE,
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isPlainObject } from "@noobot/shared/value";
import { getVerifiedSnapshotCache, readFileIdentity } from "./verified-snapshot-cache.js";
import { isMissingPersistencePathError } from "../../shared/storage/json-file-reader.js";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { readJsonWithStorage } from "./artifact-json-io.js";
import {
  assertIncrementalJournalRecords,
  journalPath,
  readJournalRecordRange,
  summarySnapshotContentHash,
} from "./turn-journal-store.js";

function resolveSummarySnapshotPath(sessionDir, file) {
  return resolveScopedArtifactPath({
    baseDir: sessionDir,
    reference: file,
    scopeDir: SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
    extensions: [".json"],
    errorCode: SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_PATH_INVALID,
    errorLabel: "session summary snapshot reference",
  });
}

function snapshotError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readRegisteredSnapshotIdentity(artifactPath, file) {
  return readFileIdentity(artifactPath).catch((error) => {
    if (!isMissingPersistencePathError(error)) throw error;

    const failure = snapshotError(
      `summary snapshot registered in manifest is missing: ${file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_INDEX_MISMATCH,
    );
    failure.cause = error;
    throw failure;
  });
}

function assertSnapshotLinksIndex(snapshot, index, previousCheckpointHash) {
  if (
    snapshot.previousCheckpointHash !== previousCheckpointHash ||
    snapshot.checkpointId !== index.checkpointId ||
    snapshot.checkpointRevision !== index.checkpointRevision
  ) {
    throw snapshotError(
      `summary snapshot does not match its manifest index: ${index.file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_INDEX_MISMATCH,
    );
  }
}

async function verifySnapshotFromDisk({ storageService, artifactPath, index, identity }) {
  const payload = await readJsonWithStorage({ storageService, artifactPath });
  if (
    !isPlainObject(payload) ||
    payload.schemaVersion !== SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION ||
    !Array.isArray(payload.records) ||
    Object.hasOwn(payload, "messages")
  ) {
    throw snapshotError(
      `summary snapshot does not match its manifest index: ${index.file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_INDEX_MISMATCH,
    );
  }
  if (summarySnapshotContentHash(payload) !== index.contentHash) {
    throw snapshotError(
      `summary snapshot hash mismatch: ${index.file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_HASH_MISMATCH,
    );
  }
  assertIncrementalJournalRecords(payload.records, artifactPath);
  const identityAfterRead = await readFileIdentity(artifactPath);
  if (identity.key !== identityAfterRead.key) {
    throw snapshotError(
      `summary snapshot changed during verification: ${index.file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_HASH_MISMATCH,
    );
  }
  return getVerifiedSnapshotCache().retain(artifactPath, index.contentHash, identity, payload);
}

async function readVerifiedTier(
  tier,
  { storageService, sessionDir, index, previousCheckpointHash },
) {
  const artifactPath = resolveSummarySnapshotPath(sessionDir, index.file);
  const identity = await readRegisteredSnapshotIdentity(artifactPath, index.file);
  const verified =
    getVerifiedSnapshotCache()[tier](artifactPath, index.contentHash, identity) ||
    (await verifySnapshotFromDisk({ storageService, artifactPath, index, identity }))[tier];
  assertSnapshotLinksIndex(verified, index, previousCheckpointHash);
  return { [tier]: verified, identity };
}

export async function readVerifiedCheckpointIdentity(options) {
  return (await readVerifiedTier("checkpoint", options)).checkpoint;
}

export async function readVerifiedSnapshot(options) {
  return readVerifiedTier("payload", options);
}

export function forgetVerifiedSnapshot(sessionDir, file) {
  getVerifiedSnapshotCache().forget(resolveSummarySnapshotPath(sessionDir, file));
}

function sameLink(link, index) {
  return (
    link.file === index.file &&
    link.checkpointId === index.checkpointId &&
    link.checkpointRevision === index.checkpointRevision &&
    link.contentHash === index.contentHash
  );
}

function foldRecordsIntoOrderedMessageMap(state, records) {
  for (const record of records) {
    if (record.op === "remove") state.delete(record.messageUid);
    else state.set(record.messageUid, deepFreeze(record.message));
  }
  return state;
}

function orderMaterializedMessages(state, order) {
  const ordered = order.map((uid) => {
    const message = state.get(uid);
    if (message) return message;
    throw snapshotError(
      `turn journal is missing an ordered message: ${uid}`,
      SESSION_ERROR_CODE.TURN_JOURNAL_MESSAGE_MISSING,
    );
  });
  const orderedUids = new Set(order);
  const remaining = [...state.entries()]
    .filter(([uid]) => !orderedUids.has(uid))
    .map(([, message]) => message);
  return [...ordered, ...remaining];
}

export function createTurnMaterializer({ byteBudget }) {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0)
    throw new TypeError("turn materializer requires a non-negative integer byteBudget");
  const entries = new Map();
  let cachedBytes = 0;

  function release(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    cachedBytes -= entry.bytes;
  }

  function retain(key, entry) {
    release(key);
    if (entry.bytes > byteBudget) return;
    entries.set(key, entry);
    cachedBytes += entry.bytes;
    for (const [candidate, cached] of entries) {
      if (cachedBytes <= byteBudget) break;
      entries.delete(candidate);
      cachedBytes -= cached.bytes;
    }
  }

  async function reusableLinks(sessionDir, cached, indexes) {
    if (!cached || cached.links.length > indexes.length) return null;
    for (const [position, link] of cached.links.entries()) {
      if (!sameLink(link, indexes[position])) return null;
      const identity = await readFileIdentity(
        resolveSummarySnapshotPath(sessionDir, link.file),
      ).catch((error) => {
        if (isMissingPersistencePathError(error)) return null;
        throw error;
      });
      if (
        link.reusable === false ||
        identity?.key !== link.identityKey ||
        identity?.reusable === false
      )
        return null;
    }
    return cached;
  }

  async function verifyCheckpointChain({ storageService, sessionDir, cached, indexes }) {
    const reusable = await reusableLinks(sessionDir, cached, indexes);
    if (reusable && reusable.links.length === indexes.length) return reusable;
    const links = reusable ? [...reusable.links] : [];
    const state = new Map(reusable ? reusable.checkpointState : []);
    let bytes = reusable ? reusable.checkpointBytes : 0;
    let previousCheckpointHash = links.at(-1)?.contentHash || "";
    for (const index of indexes.slice(links.length)) {
      const { payload, identity } = await readVerifiedSnapshot({
        storageService,
        sessionDir,
        index,
        previousCheckpointHash,
      });
      foldRecordsIntoOrderedMessageMap(state, payload.records);
      links.push({
        file: index.file,
        checkpointId: index.checkpointId,
        checkpointRevision: index.checkpointRevision,
        contentHash: index.contentHash,
        identityKey: identity.key,
        reusable: identity.reusable,
      });
      bytes += identity.bytes;
      previousCheckpointHash = index.contentHash;
    }
    return { links, checkpointState: state, checkpointBytes: bytes };
  }

  async function materialize({ storageService, sessionDir, item }) {
    const key = journalPath(sessionDir, item.turnId);
    const cached = entries.get(key);
    const chain = await verifyCheckpointChain({
      storageService,
      sessionDir,
      cached,
      indexes: item.summarySnapshots,
    });
    const chainReused = cached !== undefined && chain.links === cached.links;
    const resume = chainReused
      ? { identity: cached.journalIdentity, committedBytes: cached.committedBytes }
      : null;
    const journal = await readJournalRecordRange(key, item.committedBytes, resume);
    const state = foldRecordsIntoOrderedMessageMap(
      new Map(journal.resumed ? cached.state : chain.checkpointState),
      journal.records,
    );
    const messages = orderMaterializedMessages(state, item.messageOrder);
    retain(key, {
      ...chain,
      journalIdentity: journal.identity,
      committedBytes: item.committedBytes,
      state,
      bytes: chain.checkpointBytes + item.committedBytes,
    });
    return messages;
  }

  return Object.freeze({
    materialize,
    cachedBytes: () => cachedBytes,
  });
}

let turnMaterializer = null;

export function getTurnMaterializer() {
  turnMaterializer ??= createTurnMaterializer({
    byteBudget: LENGTH_THRESHOLDS.artifact.turnMaterializerCacheBytes,
  });
  return turnMaterializer;
}
