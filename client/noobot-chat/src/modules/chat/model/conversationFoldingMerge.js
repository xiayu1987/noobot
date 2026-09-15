/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachments } from "./dialogProcessChain.js";
import { getMessageTransferEnvelopes } from "./transferEnvelopes.js";
import { getMessageRole } from "./messageIdentity.js";
import { mergeToolTimelines } from "../runtime/engine/toolTimeline.js";
import { mergeActivityTimelines } from "../runtime/engine/activityTimeline.js";
import { mergeMessagePresentationFacets } from "./messagePresentation.js";
import { getMessageAttachments, normalizeArray } from "./messageAttachmentsProjection.js";
import { resolveMessageTurnScopeMergeKey } from "./conversationFoldingIdentity.js";

function mergeFoldedContent(previousMessage, currentMessage) {
  const previousContent = String(previousMessage?.content || "").trim();
  const currentContent = String(currentMessage?.content || "").trim();
  previousMessage.content =
    previousContent && previousContent === currentContent
      ? previousContent
      : [previousContent, currentContent].filter(Boolean).join("\n\n");
  if (currentMessage?.chatPresentation === true) {
    previousMessage.chatPresentation = true;
  }
  const currentType = String(currentMessage?.type || "").trim();
  if (currentType && currentType !== "tool_call") {
    previousMessage.type = currentType;
  }
}

function mergeFoldedTimelines(previousMessage, currentMessage) {
  previousMessage.tool_calls = [
    ...normalizeArray(previousMessage?.tool_calls),
    ...normalizeArray(currentMessage?.tool_calls),
  ];
  previousMessage.toolTimeline = mergeToolTimelines(
    previousMessage.toolTimeline,
    currentMessage.toolTimeline,
  );
  previousMessage.activityTimeline = mergeActivityTimelines(
    previousMessage.activityTimeline,
    currentMessage.activityTimeline,
  );
  previousMessage.hasThinkingDetails =
    previousMessage.hasThinkingDetails === true || currentMessage.hasThinkingDetails === true;
  previousMessage.thinkingDetailCount = Math.max(
    Number(previousMessage?.thinkingDetailCount || 0),
    Number(currentMessage?.thinkingDetailCount || 0),
  );
  Object.assign(previousMessage, mergeMessagePresentationFacets(previousMessage, currentMessage));
  previousMessage.pending = previousMessage.pending === true || currentMessage.pending === true;
}

function mergeFoldedArtifacts(previousMessage, currentMessage) {
  const currentAttachments = normalizeArray(currentMessage?.attachments);
  if (currentAttachments.length) {
    previousMessage.attachments = mergeAttachments(
      normalizeArray(previousMessage?.attachments),
      currentAttachments,
    );
  }
  const currentTransferEnvelopes = getMessageTransferEnvelopes(currentMessage);
  if (currentTransferEnvelopes.length) {
    previousMessage.transferEnvelopes = [
      ...normalizeArray(previousMessage?.transferEnvelopes),
      ...currentTransferEnvelopes,
    ];
  }
  previousMessage.attachments = getMessageAttachments(previousMessage);
  previousMessage.ts = currentMessage?.ts || previousMessage?.ts;
}

function mergeFoldedModelIdentity(previousMessage, currentMessage) {
  if (String(currentMessage?.modelAlias || "").trim()) {
    previousMessage.modelAlias = String(currentMessage.modelAlias || "").trim();
  }
  if (String(currentMessage?.modelName || "").trim()) {
    previousMessage.modelName = String(currentMessage.modelName || "").trim();
  }
  previousMessage.modelRuns = Array.from(
    new Set(
      [
        ...normalizeArray(previousMessage?.modelRuns),
        ...normalizeArray(currentMessage?.modelRuns),
      ].filter(Boolean),
    ),
  );
}

function mergeFoldedAssistantMessage(previousMessage, currentMessage) {
  mergeFoldedContent(previousMessage, currentMessage);
  mergeFoldedTimelines(previousMessage, currentMessage);
  mergeFoldedArtifacts(previousMessage, currentMessage);
  mergeFoldedModelIdentity(previousMessage, currentMessage);
}

function createEmptyTurnArtifacts() {
  return { envelopes: [], attachments: [], toolTimeline: [] };
}

function collectTurnArtifacts(sourceMessages = []) {
  const turnArtifacts = new Map();
  for (const message of sourceMessages) {
    const key = resolveMessageTurnScopeMergeKey(message);
    if (!key) continue;
    const isAssistant = getMessageRole(message) === "assistant";
    const envelopes = isAssistant ? getMessageTransferEnvelopes(message) : [];
    const attachments = isAssistant ? getMessageAttachments(message) : [];
    const existing = turnArtifacts.get(key) || createEmptyTurnArtifacts();
    turnArtifacts.set(key, {
      envelopes: envelopes.length ? [...existing.envelopes, ...envelopes] : existing.envelopes,
      attachments: attachments.length
        ? mergeAttachments(existing.attachments, attachments)
        : existing.attachments,
      toolTimeline: message.toolTimeline?.length
        ? mergeToolTimelines(existing.toolTimeline, message.toolTimeline)
        : existing.toolTimeline,
    });
  }
  return turnArtifacts;
}

function applyTurnArtifacts(mergedMessages = [], turnArtifacts = new Map()) {
  for (const message of mergedMessages) {
    const key = resolveMessageTurnScopeMergeKey(message);
    const artifacts = turnArtifacts.get(key) || createEmptyTurnArtifacts();
    if (getMessageRole(message) !== "assistant") continue;
    if (artifacts.envelopes.length) {
      message.transferEnvelopes = artifacts.envelopes;
    }
    if (artifacts.attachments.length) {
      message.attachments = mergeAttachments(
        normalizeArray(message.attachments),
        artifacts.attachments,
      );
    }
    if (artifacts.toolTimeline.length) {
      message.toolTimeline = mergeToolTimelines(message.toolTimeline, artifacts.toolTimeline);
    }
    message.attachments = getMessageAttachments(message);
  }
}

export { applyTurnArtifacts, collectTurnArtifacts, mergeFoldedAssistantMessage };
