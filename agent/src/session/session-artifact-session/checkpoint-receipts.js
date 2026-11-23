/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createCheckpointIdentitySource,
  hydrateCheckpointReceiptReferences,
  hydrateCheckpointReceipts,
  storeCheckpointReceipts,
} from "@noobot/session-protocol/summary-checkpoint-storage";
import { readVerifiedCheckpointIdentity } from "./turn-materializer.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { sessionReadToken, memoizeSessionRead } from "../session-read-cache.js";
import { recordStorageWork } from "../session-storage-observation.js";
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { assertStorageBatchSucceeded } from "./storage-batch-results.js";

function readCheckpointIdentity(options, index, previousCheckpointHash) {
  return memoizeSessionRead(
    JSON.stringify([
      "checkpointIdentity",
      options.session.sessionId,
      index,
      previousCheckpointHash,
    ]),
    path.join(options.sessionDir, index.file),
    () => {
      recordStorageWork("checkpointIdentityVerifications");
      return readVerifiedCheckpointIdentity({ ...options, index, previousCheckpointHash });
    },
  );
}

function collectVerifiedIdentities(entries, batch, results) {
  assertStorageBatchSucceeded(results);
  for (const [position, result] of results.entries()) {
    const { turn, index } = batch[position];
    entries.push({
      turn,
      index,
      payload: result.value,
      owner: [turn.turnId, turn.turnScopeId, turn.dialogProcessId],
      checkpoint: [index.checkpointId, index.checkpointRevision, index.committedAt],
    });
  }
}

function sameIdentityEntries(previous, entries) {
  return (
    previous?.length === entries.length &&
    entries.every((entry, position) => {
      const cached = previous[position];
      return (
        entry.payload === cached.payload &&
        entry.owner.every((value, index) => value === cached.owner[index]) &&
        entry.checkpoint.every((value, index) => value === cached.checkpoint[index])
      );
    })
  );
}

function identitySourceSignature(session) {
  return JSON.stringify(
    session.turnOrder
      .filter((turn) => turn.summarySnapshots.length)
      .map((turn) => [turn.turnId, turn.turnScopeId, turn.dialogProcessId, turn.summarySnapshots]),
  );
}

async function readCheckpointIdentitySource(options) {
  const { session } = options;
  const cached = await memoizeSessionRead(
    JSON.stringify(["checkpointIdentitySource", session.sessionId]),
    path.join(options.sessionDir, SESSION_ARTIFACT_FILE_NAMES.session),
    () => ({}),
  );
  const signature = identitySourceSignature(session);
  const token = sessionReadToken();
  if (token !== undefined && cached.token === token && cached.signature === signature) {
    recordStorageWork("checkpointIdentitySourceReuses");
    const resolve = cached.resolve;
    return (scope, receipt) => resolve(scope, receipt, session);
  }
  const entries = [];
  const requests = [];
  for (const turn of session.turnOrder) {
    let previousCheckpointHash = "";
    for (const index of turn.summarySnapshots) {
      requests.push({ turn, index, previousCheckpointHash });
      recordStorageWork("checkpointIdentityVisits");
      previousCheckpointHash = index.contentHash;
    }
  }
  const concurrency = QUANTITY_THRESHOLDS.artifact.checkpointVerificationConcurrency;
  for (let offset = 0; offset < requests.length; offset += concurrency) {
    const batch = requests.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(
      batch.map((request) =>
        readCheckpointIdentity(options, request.index, request.previousCheckpointHash),
      ),
    );
    collectVerifiedIdentities(entries, batch, results);
  }
  if (!sameIdentityEntries(cached.entries, entries)) {
    const source = createCheckpointIdentitySource(session);
    for (const { turn, index, payload } of entries) source.collect(turn, index, payload);
    recordStorageWork("checkpointIdentityCollections");
    cached.resolve = source.resolve;
  }
  cached.entries = entries;
  cached.signature = signature;
  cached.token = token;
  const resolve = cached.resolve;
  return (scope, receipt) => resolve(scope, receipt, session);
}

export async function readCheckpointReceiptProjection(options) {
  return hydrateCheckpointReceipts(options.session, await readCheckpointIdentitySource(options));
}

export async function readCheckpointReceiptReferences(options) {
  return hydrateCheckpointReceiptReferences(
    options.session,
    await readCheckpointIdentitySource(options),
  );
}

export async function buildStoredCheckpointReceipts(options) {
  return storeCheckpointReceipts(options.session, await readCheckpointIdentitySource(options), {
    immutable: true,
  });
}
