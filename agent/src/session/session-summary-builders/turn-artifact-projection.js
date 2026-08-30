/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeAttachmentRefs,
} from "../transfer-attachment-refs.js";
import { selectPresentedSessionLifecycleTurns } from "../session-turn-read-model.js";

const text = (value) => String(value || "").trim();
const items = (value) => (Array.isArray(value) ? value : []);

function buildLifecycleTurnPresentation(turn = {}, sessionId = "") {
  const turnScopeId = String(turn?.turnScopeId || "").trim();
  if (!turnScopeId) throw new TypeError("Turn presentation invariant failed: turn_scope_missing");
  const presentationMessageId = String(turn?.presentationMessageId || "").trim();
  if (!presentationMessageId) {
    throw new TypeError("Turn presentation invariant failed: presentation_message_id_missing");
  }
  return {
    id: presentationMessageId,
    messageId: presentationMessageId,
    presentationMessageId,
    role: "assistant",
    type: "message",
    content: "",
    sessionId,
    turnScopeId,
    dialogProcessId: String(turn.dialogProcessId || "").trim(),
    chatPresentation: true,
    turnPlaceholder: true,
    ts: String(turn.updatedAt || turn.startedAt || turn.createdAt || "").trim(),
  };
}

export function buildLifecycleTurnPresentations(lifecycle = null, sessionId = "") {
  return selectPresentedSessionLifecycleTurns(lifecycle).map((turn) =>
    buildLifecycleTurnPresentation(turn, sessionId),
  );
}

function createArtifactProjectionContext(sessionId) {
  const routeKeyOf = (message = {}) => {
    const turnScopeId = String(message?.turnScopeId || "").trim();
    return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
  };
  return {
    sessionId,
    toolNameByCallId: new Map(),
    artifactByCallId: new Map(),
    totalCount: 0,
    routeKeyOf,
    callKeyOf(message = {}, toolCallId = "") {
      const routeKey = routeKeyOf(message);
      const normalizedToolCallId = String(toolCallId || "").trim();
      return routeKey && normalizedToolCallId ? `${routeKey}::${normalizedToolCallId}` : "";
    },
  };
}

function messageArtifactIdentity(message = {}, context) {
  return {
    sessionId: context.sessionId,
    dialogProcessId: text(message.dialogProcessId),
    parentDialogProcessId: text(message.parentDialogProcessId),
    turnScopeId: text(message.turnScopeId),
  };
}

function collectTimelineArtifacts(message, context) {
  const identity = messageArtifactIdentity(message, context);
  const messageTimestamp = text(message.ts);
  for (const item of items(message.toolTimeline)) {
    const toolCallId = text(item?.toolCallId);
    const callKey = context.callKeyOf(message, toolCallId);
    if (!callKey) continue;
    const resultEvent =
      item?.resultEvent && typeof item.resultEvent === "object" ? item.resultEvent : {};
    const attachments = collectAttachmentRefsFromTransferEnvelopes(resultEvent.transferEnvelopes);
    if (!attachments.length) continue;
    context.artifactByCallId.set(callKey, {
      toolCallId,
      toolName: text(item?.tool),
      eventId: text(resultEvent.eventId),
      sequence: Number(resultEvent.sequence) || 0,
      sequenceScopeId: text(resultEvent.sequenceScopeId),
      authority: text(resultEvent.authority),
      sequenceDomain: text(resultEvent.sequenceDomain),
      ts: text(resultEvent.timestamp || resultEvent.timelineTimestamp || messageTimestamp),
      ...identity,
      attachments,
    });
  }
}

function collectToolCalls(message, context) {
  const role = text(message?.role);
  const type = text(message?.type);
  if (type !== "tool_call" && (role !== "assistant" || !Array.isArray(message?.tool_calls))) return;
  for (const toolCall of items(message?.tool_calls)) {
    const toolCallId = text(toolCall?.id);
    const toolName = text(toolCall?.function?.name || toolCall?.name || "unknown_tool");
    const callKey = context.callKeyOf(message, toolCallId);
    if (callKey) context.toolNameByCallId.set(callKey, toolName);
    context.totalCount += 1;
  }
}

function resolveToolResultName(callKey, message, canonicalArtifact, context) {
  return (
    context.toolNameByCallId.get(callKey) ||
    String(message?.toolName || canonicalArtifact?.toolName || "tool_result")
  );
}

function collectToolResult(message, context) {
  const role = text(message?.role);
  const type = text(message?.type);
  if (role !== "tool" && type !== "tool_result") return;
  const toolCallId = text(message?.tool_call_id);
  const callKey = context.callKeyOf(message, toolCallId);
  const canonicalArtifact = callKey ? context.artifactByCallId.get(callKey) : null;
  const toolName = resolveToolResultName(callKey, message, canonicalArtifact, context);
  context.totalCount += 1;
  const attachments = dedupeAttachmentRefs([
    ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
    ...items(canonicalArtifact?.attachments),
  ]);
  if (!callKey || !attachments.length) return;
  context.artifactByCallId.set(callKey, {
    ...canonicalArtifact,
    toolCallId,
    toolName,
    ts: text(canonicalArtifact?.ts || message?.ts),
    ...messageArtifactIdentity(message, context),
    attachments,
  });
}

function buildTimelineByRoute(context) {
  const timelineByRoute = new Map();
  for (const artifact of context.artifactByCallId.values()) {
    const routeKey = context.routeKeyOf(artifact);
    if (!routeKey) continue;
    const resultEvent = {
      ...(artifact.eventId ? { eventId: artifact.eventId } : {}),
      ...(artifact.sequence > 0 ? { sequence: artifact.sequence } : {}),
      ...(artifact.sequenceScopeId ? { sequenceScopeId: artifact.sequenceScopeId } : {}),
      ...(artifact.authority ? { authority: artifact.authority } : {}),
      ...(artifact.sequenceDomain ? { sequenceDomain: artifact.sequenceDomain } : {}),
      ...(artifact.ts ? { timestamp: artifact.ts } : {}),
      ...(artifact.attachments.length ? { attachments: artifact.attachments } : {}),
      sessionId: context.sessionId,
      dialogProcessId: artifact.dialogProcessId,
      turnScopeId: artifact.turnScopeId,
    };
    const timeline = timelineByRoute.get(routeKey) || [];
    timeline.push({
      key: `call:${artifact.toolCallId}`,
      toolCallId: artifact.toolCallId,
      tool: artifact.toolName,
      status: "completed",
      resultEvent,
    });
    timelineByRoute.set(routeKey, timeline);
  }
  return timelineByRoute;
}

export function buildToolArtifactTimelineProjection(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const context = createArtifactProjectionContext(String(session?.sessionId || "").trim());
  for (const message of messages) {
    collectTimelineArtifacts(message, context);
    collectToolCalls(message, context);
    collectToolResult(message, context);
  }
  return {
    timelineByRoute: buildTimelineByRoute(context),
    totalCount: context.totalCount,
  };
}
