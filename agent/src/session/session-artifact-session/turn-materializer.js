/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveScopedArtifactPath, filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ERROR_CODE,
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  createSessionStorageJournalProjection,
  applySessionStorageJournalRecords,
  materializeSessionStorageJournal,
  assertSessionStorageMessageIndex,
} from "@noobot/session-protocol";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { isPlainObject } from "@noobot/shared/value";
import { memoizeArtifactRead, recordStorageWork } from "./storage-transaction.js";
import { assertStorageBatchSucceeded } from "./storage-batch-results.js";
import {
  committedProjection,
  retainedBytes,
  invalidateProjectionSize,
} from "./projection-accounting.js";
import {
  createByteLru,
  getVerifiedSnapshotCache,
  readFileIdentity,
} from "./verified-snapshot-cache.js";
import { isMissingPersistencePathError } from "../../shared/storage/json-file-reader.js";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { readJsonWithStorage } from "./artifact-json-io.js";
import {
  assertIncrementalJournalRecords,
  resolveTurnJournalPath,
  readJournalRecordRange,
  summarySnapshotContentHash,
} from "./turn-journal-store.js";

function resolveSummarySnapshotPath(sessionDir, file) {
  return getVerifiedSnapshotCache().resolvePath(
    JSON.stringify([
      "snapshotPath",
      path.isAbsolute(sessionDir) ? "" : process.cwd(),
      sessionDir,
      file,
    ]),
    () =>
      resolveScopedArtifactPath({
        baseDir: sessionDir,
        reference: file,
        scopeDir: SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
        extensions: [".json"],
        errorCode: SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_PATH_INVALID,
        errorLabel: "session summary snapshot reference",
      }),
  );
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
  const cache = getVerifiedSnapshotCache();
  const payload = await readJsonWithStorage({
    storageService,
    artifactPath,
    immutable: true,
    previousValue: cache.previousPayload(artifactPath, index.contentHash),
  });
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
  recordStorageWork("snapshotReadBytes", identity.bytes);
  const identityAfterRead = await readFileIdentity(artifactPath, { fresh: true });
  if (identity.key !== identityAfterRead.key) {
    throw snapshotError(
      `summary snapshot changed during verification: ${index.file}`,
      SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_HASH_MISMATCH,
    );
  }
  const checkpoint = cache.revalidate("checkpoint", artifactPath, index.contentHash, identity);
  const verifiedPayload = cache.revalidate("payload", artifactPath, index.contentHash, identity);
  if (checkpoint) return { checkpoint, payload: verifiedPayload || payload };
  assertIncrementalJournalRecords(payload.records, artifactPath);
  return cache.retain(artifactPath, index.contentHash, identity, payload);
}

async function readVerifiedTier(
  tier,
  { storageService, sessionDir, index, previousCheckpointHash },
) {
  const artifactPath = resolveSummarySnapshotPath(sessionDir, index.file);
  const identity = await readRegisteredSnapshotIdentity(artifactPath, index.file);
  const verified =
    getVerifiedSnapshotCache()[tier](artifactPath, index.contentHash, identity) ||
    (await memoizeArtifactRead(
      JSON.stringify([tier, index.contentHash, identity.key]),
      artifactPath,
      async () =>
        (
          await memoizeArtifactRead(
            JSON.stringify(["verifiedSnapshot", index.contentHash, identity.key]),
            artifactPath,
            () => verifySnapshotFromDisk({ storageService, artifactPath, index, identity }),
          )
        )[tier],
    ));
  assertSnapshotLinksIndex(verified, index, previousCheckpointHash);
  return { [tier]: verified, identity };
}

export async function readVerifiedCheckpointIdentity(options) {
  return (await readVerifiedTier("checkpoint", options)).checkpoint;
}

export async function readVerifiedSnapshot(options) {
  return readVerifiedTier("payload", options);
}

async function readVerifiedSnapshotBatch({ storageService, sessionDir, indexes, offset }) {
  const batch = indexes.slice(
    offset,
    offset + QUANTITY_THRESHOLDS.artifact.checkpointVerificationConcurrency,
  );
  const results = await Promise.allSettled(
    batch.map((index, position) =>
      readVerifiedSnapshot({
        storageService,
        sessionDir,
        index,
        previousCheckpointHash: indexes[offset + position - 1]?.contentHash || "",
      }),
    ),
  );
  assertStorageBatchSucceeded(results);
  return results.map((result, position) => ({ index: batch[position], ...result.value }));
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
  recordStorageWork("foldedRecords", records.length);
  invalidateProjectionSize(state);
  applySessionStorageJournalRecords(state, records);
  for (const record of records) {
    if (record.op === "upsert") deepFreeze(record.message);
  }
  return state;
}

function cloneProjection(projection) {
  if (!projection) return createSessionStorageJournalProjection();
  return {
    messages: new Map(projection.messages),
    hashes: new Map(projection.hashes),
    positions: [...projection.positions],
  };
}

async function projectionIdentity({ sessionDir, item }) {
  const journal = await readFileIdentity(resolveTurnJournalPath(sessionDir, item.file)).catch(
    (error) => {
      if (isMissingPersistencePathError(error)) return null;
      throw error;
    },
  );
  const snapshots = await Promise.all(
    item.summarySnapshots.map((index) =>
      readRegisteredSnapshotIdentity(
        resolveSummarySnapshotPath(sessionDir, index.file),
        index.file,
      ),
    ),
  );
  const identities = [journal, ...snapshots];
  if (identities.some((identity) => identity?.reusable !== true)) return null;
  return JSON.stringify([item, identities.map((identity) => identity.key)]);
}

async function verifyReusableLink(options, link, index, previousCheckpointHash) {
  if (!sameLink(link, index)) return false;
  const { sessionDir } = options;
  const identity = await readFileIdentity(resolveSummarySnapshotPath(sessionDir, link.file)).catch(
    (error) => {
      if (isMissingPersistencePathError(error)) return null;
      throw error;
    },
  );
  if (link.reusable !== false && identity?.key === link.identityKey && identity?.reusable !== false)
    return link;
  const verified = await readVerifiedTier("checkpoint", {
    ...options,
    index,
    previousCheckpointHash,
  });
  return { ...link, identityKey: verified.identity.key, reusable: verified.identity.reusable };
}

function allLinksReusable(results) {
  assertStorageBatchSucceeded(results);
  return results.every((result) => Boolean(result.value));
}

async function reusableLinks(options, cached, indexes) {
  if (!cached || cached.links.length > indexes.length) return null;
  const concurrency = QUANTITY_THRESHOLDS.artifact.checkpointVerificationConcurrency;
  const links = [];
  for (let offset = 0; offset < cached.links.length; offset += concurrency) {
    const results = await Promise.allSettled(
      cached.links
        .slice(offset, offset + concurrency)
        .map((link, position) =>
          verifyReusableLink(
            options,
            link,
            indexes[offset + position],
            indexes[offset + position - 1]?.contentHash || "",
          ),
        ),
    );
    if (!allLinksReusable(results)) return null;
    links.push(...results.map((result) => result.value));
  }
  return { ...cached, links };
}

function checkpointLink(index, identity) {
  return {
    file: index.file,
    checkpointId: index.checkpointId,
    checkpointRevision: index.checkpointRevision,
    contentHash: index.contentHash,
    identityKey: identity.key,
    reusable: identity.reusable,
  };
}

async function verifyCheckpointChain({ storageService, sessionDir, cached, indexes }) {
  const reusable = await reusableLinks({ storageService, sessionDir }, cached, indexes);
  if (reusable && reusable.links.length === indexes.length) return reusable;
  const links = reusable ? [...reusable.links] : [];
  const state = cloneProjection(reusable?.checkpointState);
  const concurrency = QUANTITY_THRESHOLDS.artifact.checkpointVerificationConcurrency;
  for (let offset = links.length; offset < indexes.length; offset += concurrency) {
    const batch = await readVerifiedSnapshotBatch({
      storageService,
      sessionDir,
      indexes,
      offset,
    });
    for (const { index, payload, identity } of batch) {
      foldRecordsIntoOrderedMessageMap(state, payload.records);
      links.push(checkpointLink(index, identity));
    }
  }
  return { links, checkpointState: state };
}

export function createTurnMaterializer({ payloadByteBudget, identityByteBudget }) {
  for (const [name, value] of Object.entries({ payloadByteBudget, identityByteBudget })) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`turn materializer requires a non-negative integer ${name}`);
  }
  const identities = createByteLru(identityByteBudget);
  const entries = createByteLru(payloadByteBudget);

  function retain(key, entry) {
    entries.set(key, entry);
  }

  async function materializeEntries({ storageService, sessionDir, item }) {
    const file = resolveTurnJournalPath(sessionDir, item.file);
    const key = JSON.stringify([sessionDir, item.turnId]);
    const cached = entries.get(key);
    const chain = await verifyCheckpointChain({
      storageService,
      sessionDir,
      cached,
      indexes: item.summarySnapshots,
    });
    const chainReused =
      cached !== null &&
      cached.journalFile === file &&
      chain.checkpointState === cached.checkpointState;
    const resume = chainReused
      ? {
          identity: cached.journalIdentity,
          sourceKey: cached.journalSourceKey,
          committedBytes: cached.committedBytes,
        }
      : null;
    const journal = await readJournalRecordRange(file, item.committedBytes, resume);
    if (
      journal.resumed &&
      journal.records.length === 0 &&
      cached.messageRevision === item.messageRevision &&
      cached.messageCount === item.messageCount &&
      cached.firstMessageOrdinal === item.firstMessageOrdinal &&
      cached.lastMessageOrdinal === item.lastMessageOrdinal
    ) {
      retain(key, { ...cached, links: chain.links });
      return cached.materializedEntries;
    }
    const state = foldRecordsIntoOrderedMessageMap(
      cloneProjection(journal.resumed ? cached.state : chain.checkpointState),
      journal.records,
    );
    const messages = deepFreeze(
      assertSessionStorageMessageIndex(materializeSessionStorageJournal(state), item),
    );
    recordStorageWork("materializedMessages", messages.length);
    retain(key, {
      ...chain,
      journalFile: file,
      journalIdentity: journal.identity,
      journalSourceKey: journal.sourceKey,
      committedBytes: item.committedBytes,
      state,
      materializedEntries: messages,
      messageRevision: item.messageRevision,
      messageCount: item.messageCount,
      firstMessageOrdinal: item.firstMessageOrdinal,
      lastMessageOrdinal: item.lastMessageOrdinal,
      bytes: retainedBytes(chain, state),
    });
    return messages;
  }

  async function materializeMessageUids(options) {
    const key = JSON.stringify([options.sessionDir, options.item.turnId, "messageUids"]);
    const identity = await projectionIdentity(options);
    const cached = identities.get(key);
    if (identity !== null && cached?.identity === identity) {
      return cached.messageUids;
    }
    if (cached) identities.remove(key);
    const messageUids = Object.freeze(
      (await materializeEntries(options)).map(({ message }) => message.messageUid),
    );
    if (identity !== null && identity === (await projectionIdentity(options))) {
      const bytes = Buffer.byteLength(JSON.stringify([key, identity, messageUids]));
      identities.set(key, { identity, messageUids, bytes });
    }
    return messageUids;
  }

  async function prepareCommittedEntries({
    sessionDir,
    item,
    materializedEntries,
    checkpointed,
    changes,
  }) {
    const key = JSON.stringify([sessionDir, item.turnId]);
    const cached = entries.get(key);
    if (!payloadByteBudget || (!checkpointed && item.summarySnapshots.length && !cached))
      return () => {};
    const state = committedProjection(materializedEntries, cached, changes);
    const checkpointState = checkpointed
      ? state
      : cached?.checkpointState || createSessionStorageJournalProjection();
    const links = [];
    for (const index of item.summarySnapshots) {
      const identity = await readFileIdentity(resolveSummarySnapshotPath(sessionDir, index.file));
      links.push(checkpointLink(index, identity));
    }
    const journalFile = resolveTurnJournalPath(sessionDir, item.file);
    const identity = await readFileIdentity(journalFile);
    const chain = { links, checkpointState };
    const entry = {
      ...chain,
      journalFile,
      journalIdentity: identity.journalKey,
      journalSourceKey: identity.key,
      committedBytes: item.committedBytes,
      state,
      materializedEntries,
      messageRevision: item.messageRevision,
      messageCount: item.messageCount,
      firstMessageOrdinal: item.firstMessageOrdinal,
      lastMessageOrdinal: item.lastMessageOrdinal,
      bytes: retainedBytes(chain, state),
    };
    return () => retain(key, entry);
  }

  function reconciliationKey(sessionDir) {
    return JSON.stringify([sessionDir, "reconciliation"]);
  }

  return Object.freeze({
    materialize: async (options) =>
      (await materializeEntries(options)).map(({ message }) => message),
    materializeEntries,
    materializeMessageUids,
    prepareCommittedEntries,
    isSessionReconciled: (sessionDir, identity) =>
      identities.get(reconciliationKey(sessionDir))?.identity === identity,
    forgetSessionReconciliation: (sessionDir) => identities.remove(reconciliationKey(sessionDir)),
    rememberSessionReconciliation(sessionDir, identity) {
      const key = reconciliationKey(sessionDir);
      identities.set(key, { identity, bytes: Buffer.byteLength(JSON.stringify([key, identity])) });
    },
    cachedBytes: () => entries.bytes() + identities.bytes(),
  });
}

let turnMaterializer = null;

export function getTurnMaterializer() {
  turnMaterializer ??= createTurnMaterializer({
    payloadByteBudget: LENGTH_THRESHOLDS.artifact.turnMaterializerPayloadCacheBytes,
    identityByteBudget: LENGTH_THRESHOLDS.artifact.turnMaterializerIdentityCacheBytes,
  });
  return turnMaterializer;
}
