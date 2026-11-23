/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";
import { SessionCommitInputError } from "../session-changes.js";
import { isSessionAggregateVersion } from "../command/session-command.js";
import { isCanonicalMessageTimestamp } from "../message-entity-contract.js";

const validators = {
  modelAlias: (value) => typeof value === "string",
  customTitle: isCanonicalText,
  selectedConnectorIds: (value) =>
    Array.isArray(value) && value.every(isCanonicalText) && new Set(value).size === value.length,
};

export function applySessionMetadataCommit(
  metadata,
  { committedAt, aggregateVersion = metadata.aggregateVersion },
) {
  if (!isCanonicalMessageTimestamp(committedAt))
    throw new SessionCommitInputError("Session metadata requires a canonical committedAt");
  if (
    !isSessionAggregateVersion(metadata.aggregateVersion) ||
    !isSessionAggregateVersion(aggregateVersion) ||
    (aggregateVersion !== metadata.aggregateVersion &&
      aggregateVersion !== metadata.aggregateVersion + 1)
  )
    throw new SessionCommitInputError(
      "Session metadata requires an unchanged or next aggregate version",
    );
  return { ...metadata, aggregateVersion, updatedAt: committedAt };
}

export function applySessionSettings(manifest, settings, updatedAt) {
  if (!isPlainObject(settings) || Object.keys(settings).length === 0)
    throw new SessionCommitInputError("Session settings require a non-empty patch");
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.hasOwn(validators, key) || !validators[key](value))
      throw new SessionCommitInputError(`Invalid session setting: ${key}`);
  }
  return applySessionMetadataCommit(
    { ...manifest, ...structuredClone(settings) },
    { committedAt: updatedAt },
  );
}
