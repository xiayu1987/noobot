/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { MESSAGE_EVENT_TYPE, isHostActivity } from "./message-event.js";
import { mergeCanonicalActivityTimelines } from "./activity-timeline.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import {
  isInjectedSessionMessageRecord,
  resolveSessionMessageRecordInternalMessageType,
} from "@noobot/session-protocol";
import {
  THINKING_DETAIL_CONTENT_KIND,
  isThinkingDetailContentFact,
} from "./thinking-detail-content-fact.js";

export {
  THINKING_DETAIL_CONTENT_FIELDS,
  THINKING_DETAIL_CONTENT_KIND,
  THINKING_DETAIL_CONTENT_SOURCE_FIELD,
  createUserInterjectionContentFact,
  isThinkingDetailContentFact,
} from "./thinking-detail-content-fact.js";

function messageIdentity(message = {}) {
  return text(message?.messageUid);
}

function messageContent(message = {}) {
  return typeof message?.content === "string" ? message.content.trim() : "";
}

export function isThinkingDetailUserInterjection(message = {}) {
  return (
    resolveSessionMessageRecordInternalMessageType(message) ===
    CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION
  );
}

function isThinkingDetailControlMessage(message = {}) {
  if (isThinkingDetailUserInterjection(message)) return false;
  return Boolean(resolveSessionMessageRecordInternalMessageType(message));
}

export function isThinkingDetailInjectedMessage(message = {}) {
  return isInjectedSessionMessageRecord(message) && !isThinkingDetailControlMessage(message);
}

function compareContentFacts(left = {}, right = {}) {
  const leftTime = Date.parse(text(left.timestamp));
  const rightTime = Date.parse(text(right.timestamp));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime))
    return Number.isFinite(leftTime) ? -1 : 1;
  const sequenceDifference = left.sequence - right.sequence;
  if (sequenceDifference) return sequenceDifference;
  return left.contentId.localeCompare(right.contentId);
}

export function reduceThinkingDetailContentTimelines(...timelines) {
  const factsByContentId = new Map();
  for (const timeline of timelines) {
    if (!Array.isArray(timeline)) throw new TypeError("invalid_thinking_content_timeline");
  }
  for (const fact of timelines.flatMap((timeline) => Array.from(timeline))) {
    if (!isThinkingDetailContentFact(fact)) throw new TypeError("invalid_thinking_content_fact");
    factsByContentId.set(fact.contentId, Object.freeze({ ...fact }));
  }
  return Object.freeze([...factsByContentId.values()].sort(compareContentFacts));
}

function messageContentFact(message = {}, contentKind, index) {
  const identity = messageIdentity(message);
  const value = messageContent(message);
  if (!value) return null;
  const sequence =
    contentKind === THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION
      ? message.interjectionSequence
      : index + 1;
  return {
    contentId: `message:${identity}`,
    contentKind,
    sourceMessageUid: identity,
    text: value,
    timestamp: text(message?.ts),
    sequence,
    sessionId: text(message?.sessionId),
    dialogProcessId: text(message?.dialogProcessId),
    turnScopeId: text(message?.turnScopeId),
    presentationMessageId: text(message?.presentationMessageId),
  };
}

function activityContentKind(activity = {}) {
  if (!isHostActivity(activity)) return THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY;
  return text(activity?.eventType) === MESSAGE_EVENT_TYPE.MODEL_ANALYSIS
    ? THINKING_DETAIL_CONTENT_KIND.MODEL_ANALYSIS
    : THINKING_DETAIL_CONTENT_KIND.THINKING;
}

function activityContentFact(activity) {
  const eventId = text(activity?.eventId);
  const value = text(activity?.text);
  if (!eventId || !value) return null;
  const contentKind = activityContentKind(activity);
  return {
    contentId: `event:${eventId}`,
    contentKind,
    ...(contentKind === THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY
      ? { activityKind: text(activity.activityKind) }
      : {}),
    sourceEventId: eventId,
    text: value,
    timestamp: text(activity?.timestamp),
    sequence: activity.sequence,
    sessionId: text(activity?.sessionId),
    dialogProcessId: text(activity?.dialogProcessId),
    turnScopeId: text(activity?.turnScopeId),
    presentationMessageId: text(activity?.presentationMessageId),
  };
}

export function projectThinkingDetailContentTimeline(messages = [], activityTimeline = []) {
  if (!Array.isArray(messages)) throw new TypeError("invalid_thinking_content_messages");
  const timeline = messages.flatMap(selectThinkingDetailContentTimeline);
  const activities = mergeCanonicalActivityTimelines(activityTimeline);
  const supersededRelayCorrelationIds = new Set(
    messages
      .filter((message = {}) => isThinkingDetailInjectedMessage(message))
      .map((message = {}) => text(message?.relayCorrelationId))
      .filter(Boolean),
  );
  for (const [index, message] of messages.entries()) {
    const fact = projectMessageContentFact(message, index);
    if (fact) timeline.push(fact);
  }
  for (const activity of activities) {
    if (
      supersededRelayCorrelationIds.size &&
      supersededRelayCorrelationIds.has(text(activity?.relayCorrelationId))
    ) {
      continue;
    }
    const fact = activityContentFact(activity);
    if (fact) timeline.push(fact);
  }
  return reduceThinkingDetailContentTimelines(timeline);
}

function projectMessageContentFact(message, index) {
  if (isThinkingDetailUserInterjection(message)) {
    return messageContentFact(message, THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION, index);
  }
  if (isThinkingDetailInjectedMessage(message)) {
    return messageContentFact(message, THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE, index);
  }
  return null;
}

export function selectThinkingDetailContentTimeline(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("invalid_thinking_content_message");
  }
  if (!Object.hasOwn(message, "thinkingContentTimeline")) return [];
  return reduceThinkingDetailContentTimelines(message.thinkingContentTimeline);
}
