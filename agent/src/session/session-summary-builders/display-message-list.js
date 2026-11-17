/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectThinkingEventTimeline } from "../thinking-timeline-projection.js";
import { buildDisplayMessageSummary } from "./message-summary-projection.js";
import {
  compactThinkingTimeline,
  selectMessageToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import { buildLifecycleTurnPresentations } from "./turn-artifact-projection.js";
import { text } from "@noobot/shared/value";

function projectPersistedMessages(messages) {
  return messages.map((message) => buildDisplayMessageSummary(message)).filter(Boolean);
}

function findPresentation(messages, presentationMessageId) {
  return messages.find(
    (message) =>
      text(message?.role) === "assistant" &&
      text(message?.presentationMessageId) === presentationMessageId,
  );
}

function insertLifecyclePresentation(messages, presentation) {
  const existing = findPresentation(messages, presentation.presentationMessageId);
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
  if (!existingIsPlaceholder && !incomingIsPlaceholder) {
    throw new TypeError("session summary contains multiple canonical assistant presentations");
  }
  return !incomingIsPlaceholder || existingIsPlaceholder ? incoming : existing;
}

function dedupeDisplayMessages(messages) {
  const byIdentity = new Map();
  for (const message of messages) {
    if (message?.role !== "assistant") {
      byIdentity.set(`${message.role}:${byIdentity.size}`, message);
      continue;
    }
    const identity = message.presentationMessageId;
    const existing = byIdentity.get(identity);
    byIdentity.set(identity, existing ? mergeAssistantPresentation(existing, message) : message);
  }
  return [...byIdentity.values()];
}

function attachThinkingTimeline(messagesByTurn, displayMessage, selectToolTimeline) {
  if (text(displayMessage?.role) !== "assistant") return;
  const turnScopeId = text(displayMessage?.turnScopeId);
  if (!turnScopeId) return;
  const thinkingTimeline = projectThinkingEventTimeline(
    messagesByTurn.get(turnScopeId) ?? [],
    selectToolTimeline,
  );
  if (!thinkingTimeline.toolTimeline.length && !thinkingTimeline.activityTimeline.length) return;
  displayMessage.toolTimeline = thinkingTimeline.toolTimeline;
  if (thinkingTimeline.activityTimeline.length) {
    displayMessage.activityTimeline = thinkingTimeline.activityTimeline;
  } else {
    delete displayMessage.activityTimeline;
  }
  displayMessage.hasThinkingDetails = true;
}

function selectDisplayToolTimeline(message) {
  return compactThinkingTimeline(selectMessageToolTimeline(message));
}

export function buildSessionDisplayMessages({
  messages,
  lifecycle,
  selectToolTimeline = selectDisplayToolTimeline,
}) {
  const projectedMessages = projectPersistedMessages(messages);
  for (const presentation of buildLifecycleTurnPresentations(lifecycle)) {
    insertLifecyclePresentation(projectedMessages, presentation);
  }
  const displayMessages = dedupeDisplayMessages(projectedMessages);
  const messagesByTurn = new Map();
  for (const message of messages) {
    const scope = message.turnScopeId;
    if (!messagesByTurn.has(scope)) messagesByTurn.set(scope, []);
    messagesByTurn.get(scope).push(message);
  }
  for (const displayMessage of displayMessages) {
    attachThinkingTimeline(messagesByTurn, displayMessage, selectToolTimeline);
  }
  return displayMessages;
}
