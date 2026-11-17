/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-storage-error.js";

export const IMMUTABLE_SESSION_COLLECTIONS = Object.freeze([
  "metadata",
  "messages",
  "messageDiagnostics",
  "messageOrder",
  "turns",
  "turnOrder",
  "lifecycle",
  "lifecycleOrder",
  "replacements",
  "timings",
  "checkpoints",
  "checkpointHeads",
  "checkpointOrder",
  "turnCheckpoints",
  "messageCheckpoints",
  "events",
  "eventOrder",
  "eventSequences",
  "pluginArtifacts",
  "outbox",
  "turnOutbox",
  "outboxConsumers",
  "commands",
  "turnCommands",
  "dialogs",
  "dialogOrder",
  "dialogTurns",
  "contextSources",
  "dialogTails",
  "messagePredecessors",
  "turnMessages",
  "toolPairs",
  "commitOrder",
  "commandCommits",
  "checkpointCommits",
]);
const COLLECTIONS = new Set(IMMUTABLE_SESSION_COLLECTIONS);

export function requireImmutableCollection(collection) {
  if (!COLLECTIONS.has(collection)) throw immutableStorageError("Unknown immutable collection");
  return collection;
}
