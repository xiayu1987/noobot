/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageContentIdentity } from "./messageIdentity.js";
import { normalizeStatusStepDisplayState } from "./messagePresentation.js";
import { normalizeArray } from "./messageAttachmentsProjection.js";

function normalizeMessageType(messageItem = {}) {
  const rawType = String(messageItem?.type || "").trim();
  const normalizedType = rawType.toLowerCase();
  if (!rawType || ["constructor", "human", "ai", "assistant", "user"].includes(normalizedType)) {
    return "message";
  }
  if (normalizedType === "tool") return "tool_result";
  return rawType;
}

function buildMessageContentFacet(canonicalMessage = {}) {
  return {
    chatPresentation: canonicalMessage.chatPresentation,
    content:
      canonicalMessage?.chatPresentation === false
        ? ""
        : getMessageContentIdentity(canonicalMessage),
    type: normalizeMessageType(canonicalMessage),
    tool_calls: normalizeArray(canonicalMessage.tool_calls),
    toolCalls: normalizeArray(canonicalMessage.toolCalls),
    tool_call_id: canonicalMessage.tool_call_id || "",
    thinking: canonicalMessage.thinking,
    toolCall: canonicalMessage.toolCall,
    toolResult: canonicalMessage.toolResult,
    rawEvents: normalizeArray(canonicalMessage.rawEvents),
  };
}

function buildMessageModelRunFacet(canonicalMessage = {}) {
  return {
    modelAlias: canonicalMessage.modelAlias || "",
    modelName: canonicalMessage.modelName || canonicalMessage.model || "",
    modelRuns: normalizeArray(canonicalMessage.modelRuns),
  };
}

function buildMessageTimelineFacet(canonicalMessage = {}) {
  return {
    toolTimeline: normalizeArray(canonicalMessage.toolTimeline),
    activityTimeline: normalizeArray(canonicalMessage.activityTimeline),
    thinkingContentTimeline: normalizeArray(canonicalMessage.thinkingContentTimeline),
    messageEventState: canonicalMessage.messageEventState,
    hasThinkingDetails: canonicalMessage.hasThinkingDetails === true,
    thinkingDetailCount: Number(
      canonicalMessage?.thinkingDetailCount ?? canonicalMessage?.thinking_detail_count ?? 0,
    ),
  };
}

function buildMessageStatusFacet(canonicalMessage = {}) {
  return {
    error: canonicalMessage.error || "",
    pending: Boolean(canonicalMessage.pending),
    synthetic: canonicalMessage.synthetic === true,
    placeholder: canonicalMessage.placeholder === true,
    turnPlaceholder: canonicalMessage.turnPlaceholder === true,
    state: canonicalMessage.state || "",
    status: canonicalMessage.status || "",
    channelState: canonicalMessage.channelState || "",
    terminalOutcome: canonicalMessage.terminalOutcome || "",
    statusTurnScopeId: String(canonicalMessage.statusTurnScopeId || "").trim(),
    projectedStatusStepState: normalizeStatusStepDisplayState(
      canonicalMessage.projectedStatusStepState,
    ),
    hasFirstStreamEvent: canonicalMessage.hasFirstStreamEvent === true,
    taskId: canonicalMessage.taskId || "",
  };
}

function resolveNoobotInternalMessageType(canonicalMessage = {}) {
  return String(
    canonicalMessage?.noobotInternalMessageType ||
      canonicalMessage?.additional_kwargs?.noobotInternalMessageType ||
      canonicalMessage?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
}

function buildMessageOriginFacet(canonicalMessage = {}, { workflowMeta = null } = {}) {
  return {
    noobotInternalMessageType: resolveNoobotInternalMessageType(canonicalMessage),
    injectedMessage: canonicalMessage.injectedMessage === true,
    injectedBy: String(canonicalMessage.injectedBy || "").trim(),
    pluginMessage: canonicalMessage.pluginMessage === true,
    pluginMeta: workflowMeta,
    workflowMeta,
  };
}

export {
  buildMessageContentFacet,
  buildMessageModelRunFacet,
  buildMessageOriginFacet,
  buildMessageStatusFacet,
  buildMessageTimelineFacet,
  normalizeMessageType,
};
