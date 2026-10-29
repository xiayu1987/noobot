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
  if (!Array.isArray(snapshot.messageUids) || !snapshot.messageUids.every(isCanonicalText)) {
    throw layoutError(`${path}.messageUids must be a messageUid array`);
  }
}

const MESSAGE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function assertTurnMessageHashes(item, index) {
  if (!isPlainObject(item.messageHashes)) {
    throw layoutError(`turnOrder[${index}].messageHashes must be an object`);
  }
  const keys = Object.keys(item.messageHashes);
  const order = new Set(item.messageOrder);
  if (keys.length !== order.size || !keys.every((uid) => order.has(uid))) {
    throw layoutError(`turnOrder[${index}].messageHashes keys must equal messageOrder`);
  }
  for (const uid of keys) {
    if (!MESSAGE_HASH_PATTERN.test(item.messageHashes[uid])) {
      throw layoutError(`turnOrder[${index}].messageHashes.${uid} must be a sha256 digest`);
    }
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
  if (!Array.isArray(item.messageOrder) || !item.messageOrder.every(isCanonicalText)) {
    throw layoutError(`turnOrder[${index}].messageOrder must be a messageUid array`);
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
  assertTurnMessageHashes(item, index);
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

function assertMessageOrderCoverage(manifest) {
  const owner = new Map();
  manifest.turnOrder.forEach((item, index) => {
    for (const uid of item.messageOrder) {
      if (owner.has(uid))
        throw layoutError(`turnOrder[${index}].messageOrder.${uid} is duplicated`);
      owner.set(uid, index);
    }
  });
  const seen = new Set();
  manifest.messageOrder.forEach(({ messageUid }, index) => {
    if (seen.has(messageUid)) throw layoutError(`messageOrder[${index}] is duplicated`);
    if (!owner.has(messageUid)) throw layoutError(`messageOrder[${index}] has no owning turn`);
    seen.add(messageUid);
  });
  if (seen.size !== owner.size) {
    throw layoutError("messageOrder must cover every turnOrder message");
  }
}

export function assertSessionManifestLayout(manifest) {
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
  if (
    !Array.isArray(manifest.messageOrder) ||
    !manifest.messageOrder.every(
      (reference) => isPlainObject(reference) && isCanonicalText(reference.messageUid),
    )
  ) {
    throw layoutError("messageOrder must be a {messageUid} array");
  }
  assertMessageOrderCoverage(manifest);
  return manifest;
}
