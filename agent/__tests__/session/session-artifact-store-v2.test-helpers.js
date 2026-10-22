/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildSessionArtifactFileMap,
  writeSessionArtifact as writeSessionArtifactCanonical,
} from "../../src/session/session-artifact-store.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";

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

function roleIdentityOf(message = {}, index = 0, turnScopeId = "") {
  if (message?.role === "assistant") {
    return {
      modelMessageId: `mm_fixture_${index + 1}`,
      presentationMessageId: `pm_${turnScopeId}`,
    };
  }
  if (message?.role === "tool") return { presentationMessageId: `pm_${turnScopeId}` };
  if (message?.role === "user" && !message?.injectedMessage) {
    return { userMessageId: `um_fixture_${index + 1}` };
  }
  return {};
}

export function canonicalMessages(messages = []) {
  return messages.map((message, index) => {
    const turnScopeId = String(message?.turnScopeId || `turn-fixture-${index + 1}`);
    return {
      messageUid: String(message?.messageUid || `sm_fixture_${index + 1}`),
      ...roleIdentityOf(message, index, turnScopeId),
      dialogProcessId: String(message?.dialogProcessId || `dialog-${turnScopeId}`),
      turnScopeId,
      ...message,
    };
  });
}

export async function writeSessionArtifact(options = {}) {
  return writeSessionArtifactCanonical({
    ...options,
    sessionPayload: applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      ...options.sessionPayload,
      messages: canonicalMessages(options.sessionPayload?.messages),
    }),
  });
}
