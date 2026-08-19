/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeSessionArtifact as writeSessionArtifactCanonical } from "../../src/session/session-artifact-store.js";

export async function withTemp(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-artifact-v2-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function canonicalMessages(messages = []) {
  return messages.map((message, index) => {
    const turnScopeId = String(message?.turnScopeId || `turn-fixture-${index + 1}`);
    return {
      messageUid: String(message?.messageUid || `sm_fixture_${index + 1}`),
      dialogProcessId: String(message?.dialogProcessId || `dialog-${turnScopeId}`),
      turnScopeId,
      ...message,
    };
  });
}

export async function writeSessionArtifact(options = {}) {
  return writeSessionArtifactCanonical({
    ...options,
    sessionPayload: {
      ...options.sessionPayload,
      messages: canonicalMessages(options.sessionPayload?.messages),
    },
  });
}
