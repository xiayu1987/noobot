/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const SESSION_PROTOCOL_VERSION = 1;
export const SESSION_ARTIFACT_SCHEMA_VERSION = 9;
export const SESSION_ARTIFACT_AGGREGATE_VERSION_CONTRACT_SCHEMA_VERSION = 9;
export const SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION = 6;
export const SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION = 6;

export function resolveSessionArtifactSchemaVersion(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new TypeError("invalid Session artifact schema version");
    error.code = "SESSION_ARTIFACT_SCHEMA_VERSION_INVALID";
    throw error;
  }
  return value;
}
