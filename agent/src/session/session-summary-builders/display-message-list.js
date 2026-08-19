/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { projectThinkingTimeline } from "../thinking-timeline-projection.js";
import {
  buildDisplayMessageSummary,
  buildThinkingDetailCountByMessage,
  compactThinkingTimeline,
} from "./message-summary-projection.js";
import { buildLifecycleTurnPresentations } from "./turn-artifact-projection.js";

function text(value) {
  return String(value || "").trim();
}

function projectPersistedMessages(messages) {
  const thinkingDetailCountForMessage = buildThinkingDetailCountByMessage(messages);
  return messages
    .map((message) => {
      const summary = buildDisplayMessageSummary(message);
      if (!summary || text(message?.role) !== "assistant") return summary;
      const thinkingDetailCount = thinkingDetailCountForMessage(message);
      if (thinkingDetailCount > 0) {
        summary.thinkingDetailCount = thinkingDetailCount;
        summary.hasThinkingDetails = true;
      } else {
        delete summary.thinkingDetailCount;
        delete summary.hasThinkingDetails;
      }
      return summary;
    })
    .filter(Boolean);
}

function findPresentation(messages, presentationMessageId) {
  return messages.find(
    (message) =>
      text(message?.presentationMessageId || message?.messageId || message?.id) ===
      presentationMessageId,
  );
}

function insertLifecyclePresentation(messages, presentation) {
  const existing = findPresentation(messages, presentation.presentationMessageId);
  if (existing && text(existing.role) !== "assistant") {
    throw new TypeError("active Turn presentation invariant failed: presentation_role_conflict");
  }
  if (existing && text(existing.turnScopeId) !== presentation.turnScopeId) {
    throw new TypeError(
      "active Turn presentation invariant failed: presentation_turn_scope_conflict",
    );
  }
  if (existing) return;
  const owningUserIndex = messages.findLastIndex(
    (message) =>
      text(message?.role) === "user" && text(message?.turnScopeId) === presentation.turnScopeId,
  );
  messages.splice(owningUserIndex >= 0 ? owningUserIndex + 1 : messages.length, 0, presentation);
}

function mergeAssistantPresentation(existing, incoming) {
  const existingIsPlaceholder = Boolean(text(existing?.sourceMessageType));
  const incomingIsPlaceholder = Boolean(text(incoming?.sourceMessageType));
  const presentation = !incomingIsPlaceholder || existingIsPlaceholder ? incoming : existing;
  presentation.thinkingDetailCount = Math.max(
    Number(existing?.thinkingDetailCount || 0),
    Number(incoming?.thinkingDetailCount || 0),
  );
  presentation.hasThinkingDetails = presentation.thinkingDetailCount > 0;
  return presentation;
}

function dedupeDisplayMessages(messages) {
  const byIdentity = new Map();
  for (const message of messages) {
    const identity = text(message?.presentationMessageId || message?.messageId || message?.id);
    if (!identity || message?.role !== "assistant") {
      byIdentity.set(`${identity}:${byIdentity.size}`, message);
      continue;
    }
    const existing = byIdentity.get(identity);
    byIdentity.set(identity, existing ? mergeAssistantPresentation(existing, message) : message);
  }
  return [...byIdentity.values()];
}

function attachThinkingTimeline(messages, displayMessage) {
  if (text(displayMessage?.role) !== "assistant") return;
  const turnScopeId = text(displayMessage?.turnScopeId);
  if (!turnScopeId) return;
  const thinkingTimeline = projectThinkingTimeline(messages, displayMessage, { turnScopeId });
  if (!thinkingTimeline.toolTimeline.length && !thinkingTimeline.activityTimeline.length) return;
  displayMessage.toolTimeline = compactThinkingTimeline(thinkingTimeline.toolTimeline);
  if (thinkingTimeline.activityTimeline.length) {
    displayMessage.activityTimeline = thinkingTimeline.activityTimeline;
  } else {
    delete displayMessage.activityTimeline;
  }
  displayMessage.hasThinkingDetails = true;
  displayMessage.thinkingDetailCount = countCanonicalThinkingDetailEvents(thinkingTimeline);
}

export function buildSessionDisplayMessages({ messages, lifecycle, sessionId }) {
  const projectedMessages = projectPersistedMessages(messages);
  for (const presentation of buildLifecycleTurnPresentations(lifecycle, sessionId)) {
    insertLifecyclePresentation(projectedMessages, presentation);
  }
  const displayMessages = dedupeDisplayMessages(projectedMessages);
  for (const displayMessage of displayMessages) {
    attachThinkingTimeline(messages, displayMessage);
  }
  return displayMessages;
}
