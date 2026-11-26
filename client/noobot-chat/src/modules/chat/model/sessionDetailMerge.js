/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import {
  requireSessionContentProjection,
  selectSessionContentMessages,
} from "@noobot/session-protocol/session-detail";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import { mergeCanonicalActivityTimelines } from "@noobot/event-protocol/activity-timeline";
import { reduceThinkingDetailContentTimelines } from "@noobot/event-protocol/thinking-detail-content";
import { mergeToolTimelines } from "../runtime/engine/toolTimeline.js";

function messageRole(item = {}) {
  return text(item?.role).toLowerCase();
}

function isPersistedFinalAssistant(item = {}) {
  return (
    messageRole(item) === "assistant" &&
    Boolean(resolveMessageViewKey(item)) &&
    text(item?.type).toLowerCase() === "message" &&
    Boolean(text(item?.content)) &&
    item?.pending !== true
  );
}

function messageKey(item = {}) {
  if (Object.hasOwn(item, "rawEvents")) {
    throw new TypeError("[session-detail] rawEvents is retired; use canonical timelines");
  }
  const viewKey = resolveMessageViewKey(item);
  if (!viewKey) {
    throw new TypeError(
      `[session-detail] message without view identity: role=${messageRole(item)}`,
    );
  }
  return `message:${viewKey}`;
}

function selectMessageFacts(previous, incoming) {
  if (isPersistedFinalAssistant(incoming)) return { ...incoming };
  if (isPersistedFinalAssistant(previous)) return { ...previous };
  return { ...previous, ...incoming };
}

function mergeThinkingContent(merged, previous, incoming) {
  const observed =
    previous.turnScopeId === incoming.turnScopeId &&
    previous.dialogProcessId === incoming.dialogProcessId
      ? previous.thinkingContentTimeline
      : undefined;
  const snapshot = incoming.thinkingContentTimeline;
  if (observed === undefined && snapshot === undefined) {
    delete merged.thinkingContentTimeline;
    return merged;
  }
  const timeline = reduceThinkingDetailContentTimelines(observed ?? [], snapshot ?? []);
  merged.thinkingContentTimeline = timeline;
  if (timeline.length > 0) merged.hasThinkingDetails = true;
  return merged;
}

function mergeMessage(previous = {}, incoming = {}) {
  const merged = selectMessageFacts(previous, incoming);
  if (previous.toolTimeline !== undefined || incoming.toolTimeline !== undefined) {
    merged.toolTimeline = mergeToolTimelines(
      previous.toolTimeline ?? [],
      incoming.toolTimeline ?? [],
    );
  }
  if (previous.activityTimeline !== undefined || incoming.activityTimeline !== undefined) {
    merged.activityTimeline = mergeCanonicalActivityTimelines(
      previous.activityTimeline ?? [],
      incoming.activityTimeline ?? [],
    );
  }
  return mergeThinkingContent(merged, previous, incoming);
}

function replaceMessages(baseItems, incomingItems) {
  const observed = new Map();
  for (const item of baseItems) {
    if (item.thinkingContentTimeline !== undefined) observed.set(messageKey(item), item);
  }
  return incomingItems.map((item) =>
    mergeThinkingContent({ ...item }, observed.get(messageKey(item)) ?? {}, item),
  );
}

function mergeMessages(baseItems, incomingItems, { replace }) {
  if (replace) return replaceMessages(baseItems, incomingItems);
  const merged = new Map();
  baseItems.forEach((item) => merged.set(messageKey(item), { ...item }));
  incomingItems.forEach((item) => {
    const key = messageKey(item);
    merged.set(key, mergeMessage(merged.get(key), item));
  });
  return [...merged.values()];
}

export function mergeCanonicalSessionDetail(base, incoming, { replaceFields = [] } = {}) {
  const previous = requireSessionContentProjection(base);
  const next = requireSessionContentProjection(incoming);
  const previousSessionId = text(previous.sessionId);
  const nextSessionId = text(next.sessionId);
  const sessionId = nextSessionId || previousSessionId;
  const sameSession = !previousSessionId || !nextSessionId || previousSessionId === nextSessionId;
  const safePrevious = sameSession ? previous : {};
  const replacements = new Set(replaceFields);
  return {
    ...safePrevious,
    ...next,
    sessionId,
    messages: mergeMessages(
      selectSessionContentMessages(safePrevious),
      selectSessionContentMessages(next),
      {
        replace: replacements.has("messages"),
      },
    ),
  };
}
