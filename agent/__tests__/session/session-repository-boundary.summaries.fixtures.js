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

export function canonicalActivity({
  eventId = "activity-1",
  eventType = "thinking",
  activityKind = "analysis",
  text = "analysis",
  sequence = 1,
  sequenceScopeId = "message-1",
  sessionId = "session-1",
  dialogProcessId = "dialog-1",
  turnScopeId = "turn-1",
  messageId = "message-1",
  presentationMessageId = "presentation-1",
  purpose = "",
  pluginFlow = "",
  chain = "",
} = {}) {
  return {
    eventId,
    eventType,
    text,
    activityKind,
    purpose,
    pluginFlow,
    chain,
    sequence,
    sequenceScopeId,
    sequenceDomain: "message-event",
    authority: "authoritative",
    timestamp: `2026-09-05T03:39:${String(sequence).padStart(2, "0")}.000Z`,
    sessionId,
    dialogProcessId,
    turnScopeId,
    messageId,
    presentationMessageId,
  };
}
