/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalSessionMessages } from "../helpers/canonical-session-messages.js";
import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
  writeSessionArtifact as writeSessionArtifactCanonical,
  SESSION_ARTIFACT_PREDECESSOR,
} from "../../src/session/session-artifact-store.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";

export const TEST_TURN = "turn-1";

export function turnDirOf(root, dialogProcessId) {
  return path.join(buildSessionArtifactFileMap(root).executionEventsDir, "turns", dialogProcessId);
}

export async function readTurnIndex(root, dialogProcessId) {
  return JSON.parse(
    await readFile(path.join(turnDirOf(root, dialogProcessId), "index.json"), "utf8"),
  );
}

export async function withTemp(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-artifact-v2-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function buildPersistedDisplaySummary(sessionPayload) {
  return buildSessionDisplaySummary(await persistSessionManifest(sessionPayload));
}

export function canonicalMessages(messages, sessionId) {
  return canonicalSessionMessages(messages, sessionId);
}

export async function writeSessionArtifact({ sessionPayload, ...options }) {
  return writeSessionArtifactCanonical({
    ...options,
    storageService: TEST_STORAGE_SERVICE,

    atomic: true,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    sessionPayload: applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      ...sessionPayload,
      messages: canonicalMessages(sessionPayload.messages, sessionPayload.sessionId),
    }),
  });
}

export async function persistSessionManifest(sessionPayload) {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-manifest-"));
  try {
    await writeSessionArtifact({ sessionDir: root, sessionPayload });
    return await readSessionArtifact({ storageService: TEST_STORAGE_SERVICE, sessionDir: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
