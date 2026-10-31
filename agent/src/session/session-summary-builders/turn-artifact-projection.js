/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compactTransferEnvelopes } from "../transfer-attachment-refs.js";
import { selectPresentedSessionLifecycleTurns } from "../session-turn-read-model.js";
import { text } from "@noobot/shared/value";
import { TOOL_CALL_MESSAGE_TYPE, TOOL_RESULT_MESSAGE_TYPE } from "@noobot/session-protocol";
import { decodeToolResultText } from "@noobot/event-protocol/tool-result";
import { resolveCanonicalToolTimelineStatus } from "@noobot/event-protocol/tool-timeline";

function toolResultFacts(message, field) {
  const value = message[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`tool result ${field} must be an array`);
  return value;
}

function buildLifecycleTurnPresentation(turn) {
  const turnScopeId = text(turn?.turnScopeId);
  if (!turnScopeId) throw new TypeError("Turn presentation invariant failed: turn_scope_missing");
  const presentationMessageId = text(turn?.presentationMessageId);
  if (!presentationMessageId) {
    throw new TypeError("Turn presentation invariant failed: presentation_message_id_missing");
  }
  return {
    presentationMessageId,
    role: "assistant",
    type: "message",
    content: "",
    attachments: [],
    turnScopeId,
    dialogProcessId: text(turn.dialogProcessId),
    chatPresentation: true,
    turnPlaceholder: true,
    ts: text(turn.updatedAt || turn.startedAt || turn.createdAt),
  };
}

export function buildLifecycleTurnPresentations(lifecycle) {
  return selectPresentedSessionLifecycleTurns(lifecycle).map(buildLifecycleTurnPresentation);
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
  if (message.type !== TOOL_CALL_MESSAGE_TYPE) return;
  context.totalCount += message.tool_calls.length;
}

function collectToolResult(message, context) {
  if (message.type !== TOOL_RESULT_MESSAGE_TYPE) return;
  context.totalCount += 1;
  const toolCallId = text(message?.tool_call_id);
  const callKey = context.callKeyOf(message, toolCallId);
  const transferEnvelopes = compactTransferEnvelopes(toolResultFacts(message, "transferEnvelopes"));
  const resourceRefs = toolResultFacts(message, "resourceRefs");
  const mutationRefs = toolResultFacts(message, "mutationRefs");
  if (!callKey || (!transferEnvelopes.length && !resourceRefs.length && !mutationRefs.length)) {
    return;
  }
  context.artifactByCallId.set(callKey, {
    toolCallId,
    toolName: text(message.toolName),
    timestamp: text(message.ts),
    result: message.content,
    success: decodeToolResultText(message.content).ok,
    ...messageArtifactIdentity(message, context),
    transferEnvelopes,
    resourceRefs,
    mutationRefs,
  });
}

function buildTimelineByRoute(context) {
  const timelineByRoute = new Map();
  for (const artifact of context.artifactByCallId.values()) {
    const routeKey = context.routeKeyOf(artifact);
    if (!routeKey) continue;
    const resultEvent = {
      timestamp: artifact.timestamp,
      ...(artifact.resourceRefs.length ? { resourceRefs: artifact.resourceRefs } : {}),
      ...(artifact.mutationRefs.length ? { mutationRefs: artifact.mutationRefs } : {}),
      sessionId: context.sessionId,
      dialogProcessId: artifact.dialogProcessId,
      turnScopeId: artifact.turnScopeId,
    };
    const timeline = timelineByRoute.get(routeKey) || [];
    const entry = {
      key: `call:${artifact.toolCallId}`,
      toolCallId: artifact.toolCallId,
      tool: artifact.toolName,
      result: artifact.result,
      success: artifact.success,
      resultEvent,
      transferEnvelopes: artifact.transferEnvelopes,
    };
    timeline.push({ ...entry, status: resolveCanonicalToolTimelineStatus(entry) });
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
