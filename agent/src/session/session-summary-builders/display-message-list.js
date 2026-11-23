/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildDisplayMessageSummary } from "./message-summary-projection.js";
import {
  compactThinkingTimeline,
  selectMessageToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import { selectMessageActivityTimeline } from "@noobot/event-protocol/activity-timeline";
import { projectThinkingEventTimeline } from "@noobot/event-protocol/thinking-detail-projection";
import { buildLifecycleTurnPresentations } from "./turn-artifact-projection.js";
import { planSessionDisplayRows } from "@noobot/session-protocol/session-reader";

function projectPersistedMessages(messages) {
  return messages.map((message) => buildDisplayMessageSummary(message)).filter(Boolean);
}

function planDisplayRows(messages, lifecycle) {
  return planSessionDisplayRows(
    projectPersistedMessages(messages),
    buildLifecycleTurnPresentations(lifecycle),
  );
}

export function contributesDisplayThinkingDetails(message) {
  return (
    selectMessageToolTimeline(message).length > 0 ||
    selectMessageActivityTimeline(message).length > 0
  );
}

function selectThinkingTurns(messages) {
  return new Set(
    messages.filter(contributesDisplayThinkingDetails).map(({ turnScopeId }) => turnScopeId),
  );
}

function buildThinkingByTurn(messages, thinkingTurns, selectToolTimeline) {
  const thinkingByTurn = new Map();
  for (const message of messages) {
    if (!thinkingTurns.has(message.turnScopeId)) continue;
    const members = thinkingByTurn.get(message.turnScopeId);
    if (members) members.push(message);
    else thinkingByTurn.set(message.turnScopeId, [message]);
  }
  for (const [scope, members] of thinkingByTurn) {
    thinkingByTurn.set(scope, projectThinkingEventTimeline(members, selectToolTimeline));
  }
  return thinkingByTurn;
}

function assignDisplaySourceOrdinal(message, selectSourceOrdinal) {
  const ordinal = selectSourceOrdinal(message);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new TypeError("Display row requires a valid source message ordinal");
  message.sessionOrdinal = ordinal;
}

export function buildSessionDisplayEntries({
  messages,
  lifecycle,
  thinkingTurns = selectThinkingTurns(messages),
  selectSourceOrdinal,
  includeThinkingTimeline = false,
  selectToolTimeline = (message) => compactThinkingTimeline(selectMessageToolTimeline(message)),
}) {
  const entries = planDisplayRows(messages, lifecycle);
  const thinkingByTurn = includeThinkingTimeline
    ? buildThinkingByTurn(messages, thinkingTurns, selectToolTimeline)
    : new Map();
  for (const { row: displayMessage } of entries) {
    if (selectSourceOrdinal && displayMessage.turnPlaceholder !== true)
      assignDisplaySourceOrdinal(displayMessage, selectSourceOrdinal);
    if (displayMessage.role !== "assistant" || !thinkingTurns.has(displayMessage.turnScopeId))
      continue;
    displayMessage.hasThinkingDetails = true;
    const timeline = thinkingByTurn.get(displayMessage.turnScopeId);
    if (!timeline) continue;
    if (timeline.toolTimeline.length) displayMessage.toolTimeline = [...timeline.toolTimeline];
    if (timeline.activityTimeline.length)
      displayMessage.activityTimeline = timeline.activityTimeline;
  }
  return entries;
}
