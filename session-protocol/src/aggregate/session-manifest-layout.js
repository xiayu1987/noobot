/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

function layoutError(reason) {
  const error = new Error(`Session manifest layout is invalid: ${reason}`);
  error.code = SESSION_ERROR_CODE.MANIFEST_LAYOUT_INVALID;
  return error;
}

function assertTurnOrderItem(item, index) {
  if (!isPlainObject(item)) throw layoutError(`turnOrder[${index}] must be an object`);
  for (const key of ["turnId", "turnScopeId", "file"]) {
    if (!isCanonicalText(item[key])) throw layoutError(`turnOrder[${index}].${key} is required`);
  }
  if (!Array.isArray(item.messageOrder) || !item.messageOrder.every(isCanonicalText)) {
    throw layoutError(`turnOrder[${index}].messageOrder must be a messageUid array`);
  }
  if (!Array.isArray(item.summarySnapshots)) {
    throw layoutError(`turnOrder[${index}].summarySnapshots must be an array`);
  }
  if (typeof item.compacted !== "boolean") {
    throw layoutError(`turnOrder[${index}].compacted must be a boolean`);
  }
  if (!isPlainObject(item.messageHashes)) {
    throw layoutError(`turnOrder[${index}].messageHashes must be an object`);
  }
  for (const key of ["committedBytes", "recordCount"]) {
    if (!Number.isSafeInteger(item[key]) || item[key] < 0) {
      throw layoutError(`turnOrder[${index}].${key} must be a non-negative integer`);
    }
  }
}

export function assertSessionManifestLayout(manifest) {
  if (!isPlainObject(manifest)) throw layoutError("manifest must be an object");
  if (!Number.isSafeInteger(manifest.turnArtifactSequence) || manifest.turnArtifactSequence < 0) {
    throw layoutError("turnArtifactSequence must be a non-negative integer");
  }
  if (!Array.isArray(manifest.turnOrder)) throw layoutError("turnOrder must be an array");
  manifest.turnOrder.forEach(assertTurnOrderItem);
  if (
    !Array.isArray(manifest.messageOrder) ||
    !manifest.messageOrder.every(
      (reference) => isPlainObject(reference) && isCanonicalText(reference.messageUid),
    )
  ) {
    throw layoutError("messageOrder must be a {messageUid} array");
  }
  return manifest;
}
