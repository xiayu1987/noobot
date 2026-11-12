/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { isCanonicalDialogProcessKey } from "../identity.js";
import { isTurnLifecycleShape } from "./session-invariants.js";

function layoutError(reason) {
  const error = new Error(`Session manifest layout is invalid: ${reason}`);
  error.code = SESSION_ERROR_CODE.MANIFEST_LAYOUT_INVALID;
  return error;
}

function assertSummarySnapshotIndex(snapshot, path) {
  if (!isPlainObject(snapshot)) throw layoutError(`${path} must be an object`);
  for (const key of ["checkpointId", "committedAt", "contentHash", "file"]) {
    if (!isCanonicalText(snapshot[key])) throw layoutError(`${path}.${key} is required`);
  }
  if (!Number.isSafeInteger(snapshot.checkpointRevision) || snapshot.checkpointRevision < 1) {
    throw layoutError(`${path}.checkpointRevision must be a positive integer`);
  }
  if (Object.hasOwn(snapshot, "messageUids")) throw layoutError(`${path}.messageUids is retired`);
}

const MESSAGE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function assertTurnMessageIndex(item, index) {
  for (const field of ["messageOrder", "messageHashes"]) {
    if (Object.hasOwn(item, field)) throw layoutError(`turnOrder[${index}].${field} is retired`);
  }
  for (const field of ["messageCount", "firstMessageOrdinal", "lastMessageOrdinal"]) {
    if (!Number.isSafeInteger(item[field]) || item[field] < 0) {
      throw layoutError(`turnOrder[${index}].${field} must be a non-negative integer`);
    }
  }
  const empty = item.messageCount === 0;
  if (
    empty
      ? item.firstMessageOrdinal !== 0 || item.lastMessageOrdinal !== 0
      : item.firstMessageOrdinal < 1 ||
        item.lastMessageOrdinal < item.firstMessageOrdinal ||
        item.lastMessageOrdinal - item.firstMessageOrdinal + 1 < item.messageCount
  ) {
    throw layoutError(`turnOrder[${index}] has invalid message ordinal bounds`);
  }
  if (!MESSAGE_HASH_PATTERN.test(item.messageRevision)) {
    throw layoutError(`turnOrder[${index}].messageRevision must be a sha256 digest`);
  }
}

function assertTurnOrderItem(item, index) {
  if (!isPlainObject(item)) throw layoutError(`turnOrder[${index}] must be an object`);
  for (const key of ["turnId", "turnScopeId", "file"]) {
    if (!isCanonicalText(item[key])) throw layoutError(`turnOrder[${index}].${key} is required`);
  }
  if (!isCanonicalDialogProcessKey(item.dialogProcessId)) {
    throw layoutError(`turnOrder[${index}].dialogProcessId must be a dialog process key`);
  }
  if (!Array.isArray(item.summarySnapshots)) {
    throw layoutError(`turnOrder[${index}].summarySnapshots must be an array`);
  }
  item.summarySnapshots.forEach((snapshot, position) =>
    assertSummarySnapshotIndex(snapshot, `turnOrder[${index}].summarySnapshots[${position}]`),
  );
  if (typeof item.compacted !== "boolean") {
    throw layoutError(`turnOrder[${index}].compacted must be a boolean`);
  }
  for (const key of ["committedBytes", "recordCount"]) {
    if (!Number.isSafeInteger(item[key]) || item[key] < 0) {
      throw layoutError(`turnOrder[${index}].${key} must be a non-negative integer`);
    }
  }
}

function assertUniqueTurnOrderIdentities(turnOrder) {
  for (const key of ["turnId", "turnScopeId", "file"]) {
    const seen = new Set();
    turnOrder.forEach((item, index) => {
      if (seen.has(item[key])) throw layoutError(`turnOrder[${index}].${key} is duplicated`);
      seen.add(item[key]);
    });
  }
}

function assertManifestStructure(manifest) {
  if (!isPlainObject(manifest)) throw layoutError("manifest must be an object");
  if (!Number.isSafeInteger(manifest.turnArtifactSequence) || manifest.turnArtifactSequence < 0) {
    throw layoutError("turnArtifactSequence must be a non-negative integer");
  }
  if (!Array.isArray(manifest.turnOrder)) throw layoutError("turnOrder must be an array");
  manifest.turnOrder.forEach(assertTurnOrderItem);
  assertUniqueTurnOrderIdentities(manifest.turnOrder);
  if (!isTurnLifecycleShape(manifest.turnLifecycle)) {
    throw layoutError("turnLifecycle must be a turn lifecycle object");
  }
  return manifest;
}

export function assertSessionManifestLayout(manifest) {
  assertManifestStructure(manifest);
  manifest.turnOrder.forEach(assertTurnMessageIndex);
  if (Object.hasOwn(manifest, "messageOrder")) throw layoutError("messageOrder is retired");
  return manifest;
}

export function assertLegacyCheckpointManifestLayout(manifest) {
  assertManifestStructure(manifest);
  if (manifest.schemaVersion !== 19)
    throw layoutError("checkpoint migration output requires schema 19");
  const owners = new Set();
  for (const [index, turn] of manifest.turnOrder.entries()) {
    if (
      !Array.isArray(turn.messageOrder) ||
      !turn.messageOrder.every(isCanonicalText) ||
      !isPlainObject(turn.messageHashes)
    )
      throw layoutError(`turnOrder[${index}] requires legacy message order and hashes`);
    const hashes = Object.keys(turn.messageHashes);
    if (
      hashes.length !== turn.messageOrder.length ||
      !hashes.every(
        (uid) =>
          turn.messageOrder.includes(uid) && MESSAGE_HASH_PATTERN.test(turn.messageHashes[uid]),
      )
    )
      throw layoutError(`turnOrder[${index}] has invalid legacy message hashes`);
    for (const uid of turn.messageOrder) {
      if (owners.has(uid)) throw layoutError(`duplicate legacy message identity: ${uid}`);
      owners.add(uid);
    }
  }
  if (
    !Array.isArray(manifest.messageOrder) ||
    !manifest.messageOrder.every(
      (reference) => isPlainObject(reference) && isCanonicalText(reference.messageUid),
    )
  )
    throw layoutError("legacy messageOrder must be a {messageUid} array");
  const order = new Set(manifest.messageOrder.map(({ messageUid }) => messageUid));
  if (
    order.size !== manifest.messageOrder.length ||
    order.size !== owners.size ||
    [...order].some((uid) => !owners.has(uid))
  )
    throw layoutError("legacy messageOrder must cover every turn message exactly once");
  return manifest;
}
