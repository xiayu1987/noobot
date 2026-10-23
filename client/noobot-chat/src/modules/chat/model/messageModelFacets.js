/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageContentIdentity } from "./messageIdentity.js";
import { normalizeStatusStepDisplayState } from "./messagePresentation.js";
import { normalizeArray } from "./messageAttachmentsProjection.js";
import { text } from "@noobot/shared/value";

function normalizeMessageType(messageItem = {}) {
  const rawType = text(messageItem?.type);
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
    modelName: canonicalMessage.modelName || "",
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
    thinkingDetailCount: Number(canonicalMessage?.thinkingDetailCount ?? 0),
  };
}

function buildMessageStatusFacet(canonicalMessage = {}) {
  return {
    error: canonicalMessage.error || "",
    pending: Boolean(canonicalMessage.pending),
    synthetic: canonicalMessage.synthetic === true,
    placeholder: canonicalMessage.placeholder === true,
    turnPlaceholder: canonicalMessage.turnPlaceholder === true,
    channelState: canonicalMessage.channelState || "",
    terminalOutcome: canonicalMessage.terminalOutcome || "",
    statusTurnScopeId: text(canonicalMessage.statusTurnScopeId),
    projectedStatusStepState: normalizeStatusStepDisplayState(
      canonicalMessage.projectedStatusStepState,
    ),
    hasFirstStreamEvent: canonicalMessage.hasFirstStreamEvent === true,
    taskId: canonicalMessage.taskId || "",
  };
}

function resolveNoobotInternalMessageType(canonicalMessage = {}) {
  return text(
    canonicalMessage?.noobotInternalMessageType ||
      canonicalMessage?.additional_kwargs?.noobotInternalMessageType ||
      canonicalMessage?.metadata?.noobotInternalMessageType,
  );
}

function buildMessageOriginFacet(canonicalMessage = {}, { workflowMeta = null } = {}) {
  return {
    noobotInternalMessageType: resolveNoobotInternalMessageType(canonicalMessage),
    messageOrigin: canonicalMessage.messageOrigin,
    injectedMessage: canonicalMessage.injectedMessage === true,
    injectedBy: text(canonicalMessage.injectedBy),
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
};
