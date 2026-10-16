/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { collectAttachmentRefsFromTransferEnvelopes } from "../transfer-attachment-refs.js";
import { selectPresentedSessionLifecycleTurns } from "../session-turn-read-model.js";
import { text } from "@noobot/shared/value";

const items = (value) => (Array.isArray(value) ? value : []);

function buildLifecycleTurnPresentation(turn = {}, sessionId = "") {
  const turnScopeId = text(turn?.turnScopeId);
  if (!turnScopeId) throw new TypeError("Turn presentation invariant failed: turn_scope_missing");
  const presentationMessageId = text(turn?.presentationMessageId);
  if (!presentationMessageId) {
    throw new TypeError("Turn presentation invariant failed: presentation_message_id_missing");
  }
  return {
    messageId: presentationMessageId,
    presentationMessageId,
    role: "assistant",
    type: "message",
    content: "",
    sessionId,
    turnScopeId,
    dialogProcessId: text(turn.dialogProcessId),
    chatPresentation: true,
    turnPlaceholder: true,
    ts: text(turn.updatedAt || turn.startedAt || turn.createdAt),
  };
}

export function buildLifecycleTurnPresentations(lifecycle = null, sessionId = "") {
  return selectPresentedSessionLifecycleTurns(lifecycle).map((turn) =>
    buildLifecycleTurnPresentation(turn, sessionId),
  );
}

function createArtifactProjectionContext(sessionId) {
  const routeKeyOf = (message = {}) => {
    const turnScopeId = text(message?.turnScopeId);
    return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
  };
  return {
    sessionId,
    artifactByCallId: new Map(),
    totalCount: 0,
    routeKeyOf,
    callKeyOf(message = {}, toolCallId = "") {
      const routeKey = routeKeyOf(message);
      const normalizedToolCallId = text(toolCallId);
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

function collectToolCalls(message, context) {
  const role = text(message?.role);
  const type = text(message?.type);
  if (type !== "tool_call" && (role !== "assistant" || !Array.isArray(message?.tool_calls))) return;
  context.totalCount += items(message?.tool_calls).length;
}

function collectToolResult(message, context) {
  const role = text(message?.role);
  const type = text(message?.type);
  if (role !== "tool" && type !== "tool_result") return;
  context.totalCount += 1;
  const toolCallId = text(message?.tool_call_id);
  const callKey = context.callKeyOf(message, toolCallId);
  const attachments = collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes);
  if (!callKey || !attachments.length) return;
  context.artifactByCallId.set(callKey, {
    toolCallId,
    toolName: text(message.toolName),
    timestamp: text(message.ts),
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
      timestamp: artifact.timestamp,
      attachments: artifact.attachments,
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
  const context = createArtifactProjectionContext(text(session?.sessionId));
  for (const message of session.messages) {
    collectToolCalls(message, context);
    collectToolResult(message, context);
  }
  return {
    timelineByRoute: buildTimelineByRoute(context),
    totalCount: context.totalCount,
  };
}
