/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitScopedImmutableSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";

export function commitImmutableSessionChanges(
  store,
  { expectedGeneration, ...command },
  validateSnapshot,
) {
  const request = prepareScopedSessionCommitRequest({ epoch: null, expectedGeneration }, command);
  return commitScopedImmutableSessionChanges(store, request, validateSnapshot);
}

export async function commitSessionChanges({
  sessionDir,
  sessionId,
  validateSnapshot,
  ...command
}) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  return commitImmutableSessionChanges(store, command, validateSnapshot);
}
