/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeAttachmentRefs,
} from "../transfer-attachment-refs.js";

export function buildActiveTurnPresentation(lifecycle = null, sessionId = "") {
  const activeTurnScopeId = String(lifecycle?.activeTurnScopeId || "").trim();
  if (!activeTurnScopeId) return null;
  const activeTurn = lifecycle?.turns?.[activeTurnScopeId];
  if (!activeTurn || typeof activeTurn !== "object" || Array.isArray(activeTurn)) {
    throw new TypeError("active Turn presentation invariant failed: turn_missing");
  }
  if (String(activeTurn.turnScopeId || "").trim() !== activeTurnScopeId) {
    throw new TypeError("active Turn presentation invariant failed: turn_scope_mismatch");
  }
  const presentationMessageId = String(activeTurn.presentationMessageId || "").trim();
  if (!presentationMessageId) {
    throw new TypeError(
      "active Turn presentation invariant failed: presentation_message_id_missing",
    );
  }
  return {
    id: presentationMessageId,
    messageId: presentationMessageId,
    presentationMessageId,
    role: "assistant",
    type: "message",
    content: "",
    sessionId,
    turnScopeId: activeTurnScopeId,
    dialogProcessId: String(activeTurn.dialogProcessId || "").trim(),
    chatPresentation: true,
    turnPlaceholder: true,
    ts: String(activeTurn.updatedAt || activeTurn.startedAt || activeTurn.createdAt || "").trim(),
  };
}

export function buildToolArtifactTimelineProjection(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const sessionId = String(session?.sessionId || "").trim();
  const toolNameByCallId = new Map();
  const artifactByCallId = new Map();
  let totalCount = 0;
  const routeKeyOf = (message = {}) => {
    const turnScopeId = String(message?.turnScopeId || "").trim();
    return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
  };
  const callKeyOf = (message = {}, toolCallId = "") => {
    const routeKey = routeKeyOf(message);
    const normalizedToolCallId = String(toolCallId || "").trim();
    return routeKey && normalizedToolCallId ? `${routeKey}::${normalizedToolCallId}` : "";
  };
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const type = String(message?.type || "").trim();
    const ts = String(message?.ts || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const parentDialogProcessId = String(message?.parentDialogProcessId || "").trim();
    const turnScopeId = String(message?.turnScopeId || "").trim();
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      const toolCallId = String(item?.toolCallId || "").trim();
      const callKey = callKeyOf(message, toolCallId);
      if (!callKey) continue;
      const resultEvent =
        item?.resultEvent && typeof item.resultEvent === "object" ? item.resultEvent : {};
      const attachments = collectAttachmentRefsFromTransferEnvelopes(
        resultEvent?.transferEnvelopes,
      );
      if (attachments.length) {
        artifactByCallId.set(callKey, {
          toolCallId,
          toolName: String(item?.tool || "").trim(),
          eventId: String(resultEvent?.eventId || "").trim(),
          sequence: Number(resultEvent?.sequence || 0),
          sequenceScopeId: String(resultEvent?.sequenceScopeId || "").trim(),
          authority: String(resultEvent?.authority || "").trim(),
          sequenceDomain: String(resultEvent?.sequenceDomain || "").trim(),
          ts: String(resultEvent?.timestamp || resultEvent?.timelineTimestamp || ts).trim(),
          sessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId,
          attachments,
        });
      }
    }
    if (type === "tool_call" || (role === "assistant" && Array.isArray(message?.tool_calls))) {
      for (const toolCall of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const toolCallId = String(toolCall?.id || "").trim();
        const toolName = String(
          toolCall?.function?.name || toolCall?.name || "unknown_tool",
        ).trim();
        const callKey = callKeyOf(message, toolCallId);
        if (callKey) toolNameByCallId.set(callKey, toolName);
        totalCount += 1;
      }
    }
    if (role === "tool" || type === "tool_result") {
      const toolCallId = String(message?.tool_call_id || "").trim();
      const callKey = callKeyOf(message, toolCallId);
      const canonicalArtifact = callKey ? artifactByCallId.get(callKey) : null;
      const toolName =
        toolNameByCallId.get(callKey) ||
        String(message?.toolName || canonicalArtifact?.toolName || "tool_result");
      totalCount += 1;
      const attachments = dedupeAttachmentRefs([
        ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
        ...(Array.isArray(canonicalArtifact?.attachments) ? canonicalArtifact.attachments : []),
      ]);
      if (!callKey || !attachments.length) continue;
      artifactByCallId.set(callKey, {
        ...canonicalArtifact,
        toolCallId,
        toolName,
        ts: String(canonicalArtifact?.ts || ts).trim(),
        sessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        attachments,
      });
    }
  }
  const timelineByRoute = new Map();
  for (const artifact of artifactByCallId.values()) {
    const routeKey = routeKeyOf(artifact);
    if (!routeKey) continue;
    const resultEvent = {
      ...(artifact.eventId ? { eventId: artifact.eventId } : {}),
      ...(artifact.sequence > 0 ? { sequence: artifact.sequence } : {}),
      ...(artifact.sequenceScopeId ? { sequenceScopeId: artifact.sequenceScopeId } : {}),
      ...(artifact.authority ? { authority: artifact.authority } : {}),
      ...(artifact.sequenceDomain ? { sequenceDomain: artifact.sequenceDomain } : {}),
      ...(artifact.ts ? { timestamp: artifact.ts } : {}),
      ...(artifact.attachments.length ? { attachments: artifact.attachments } : {}),
      sessionId,
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
  return { timelineByRoute, totalCount };
}
