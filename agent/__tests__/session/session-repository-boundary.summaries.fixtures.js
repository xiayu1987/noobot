/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { resolveCanonicalToolTimelineStatus } from "@noobot/event-protocol/tool-timeline";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

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

export function canonicalMessages(messages, sessionId, namespace = "summary") {
  return messages.map((message, index) => {
    const turnScopeId = String(message?.turnScopeId || `turn-${namespace}-${index + 1}`);

    const roleIdentity = {
      ...(message?.role === "assistant" ? { modelMessageId: `mm_${namespace}_${index + 1}` } : {}),
      ...(["assistant", "tool"].includes(message?.role)
        ? { presentationMessageId: `pm_${turnScopeId}` }
        : {}),
    };
    return {
      sessionId,
      messageUid: String(message?.messageUid || `sm_${namespace}_${index + 1}`),
      ts: TEST_MESSAGE_TS,
      dialogProcessId: String(message?.dialogProcessId || `dialog-${turnScopeId}`),
      turnScopeId,
      ...roleIdentity,
      ...message,
    };
  });
}

export function fileToolResultText(filePath, extra) {
  return JSON.stringify({
    ok: true,
    path: { view: "workspace", path: filePath },
    fileName: path.basename(filePath),
    ...extra,
  });
}

export function canonicalToolTimelineItem(fields) {
  const { toolCallId, tool, args, call } = fields;
  const base = { key: `call:${toolCallId}`, toolCallId, tool, args, call, riskLevel: "" };
  if (!Object.hasOwn(fields, "resultEvent")) return { ...base, status: "running" };
  const entry = {
    ...base,
    result: fields.result,
    success: fields.success,
    resultEvent: fields.resultEvent,
  };
  return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
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
    presentationMessageId,
  };
}
