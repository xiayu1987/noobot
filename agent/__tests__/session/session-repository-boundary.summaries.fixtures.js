/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";

export async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function canonicalMessages(messages = [], namespace = "summary") {
  return messages.map((message, index) => {
    const turnScopeId = String(message?.turnScopeId || `turn-${namespace}-${index + 1}`);
    return {
      messageUid: String(message?.messageUid || `sm_${namespace}_${index + 1}`),
      dialogProcessId: String(message?.dialogProcessId || `dialog-${turnScopeId}`),
      turnScopeId,
      ...message,
    };
  });
}
