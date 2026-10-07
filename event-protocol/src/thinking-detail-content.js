/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MESSAGE_EVENT_TYPE, isHostActivity } from "./message-event.js";
import { mergeCanonicalActivityTimelines } from "./activity-timeline.js";
import { text } from "./normalize.js";
import {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  resolveContextInternalMessageType,
} from "@noobot/context-protocol/policy/injected-message";
import { isInjectedMessage } from "@noobot/context-protocol/policy/message";
import {
  THINKING_DETAIL_CONTENT_KIND,
  isThinkingDetailContentFact,
} from "./thinking-detail-content-fact.js";

export {
  THINKING_DETAIL_CONTENT_FIELDS,
  THINKING_DETAIL_CONTENT_KIND,
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
    resolveContextInternalMessageType(message) === CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION
  );
}

export function isThinkingDetailControlMessage(message = {}) {
  if (isThinkingDetailUserInterjection(message)) return false;
  return Boolean(resolveContextInternalMessageType(message));
}

export function isThinkingDetailInjectedMessage(message = {}) {
  return isInjectedMessage(message) && !isThinkingDetailControlMessage(message);
}

function compareContentFacts(left = {}, right = {}) {
  const leftTime = Date.parse(text(left.timestamp));
  const rightTime = Date.parse(text(right.timestamp));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime))
    return Number.isFinite(leftTime) ? -1 : 1;
  const sequenceDifference = Number(left.sequence || 0) - Number(right.sequence || 0);
  if (sequenceDifference) return sequenceDifference;
  return text(left.contentId).localeCompare(text(right.contentId));
}

export function reduceThinkingDetailContentTimelines(...timelines) {
  const factsByContentId = new Map();
  for (const timeline of timelines) {
    for (const fact of Array.isArray(timeline) ? timeline : []) {
      if (!isThinkingDetailContentFact(fact)) continue;
      factsByContentId.set(text(fact.contentId), Object.freeze({ ...fact }));
    }
  }
  return Object.freeze([...factsByContentId.values()].sort(compareContentFacts));
}

function messageContentFact(message = {}, contentKind, index) {
  const identity = messageIdentity(message);
  const value = messageContent(message);
  if (!identity || !value) return null;
  const sequence =
    contentKind === THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION
      ? Number(message?.interjectionSequence || 0)
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
    messageId: text(message?.messageId),
    presentationMessageId: text(message?.presentationMessageId),
  };
}

function activityContentKind(activity = {}) {
  if (!isHostActivity(activity)) return THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY;
  return text(activity?.eventType) === MESSAGE_EVENT_TYPE.MODEL_ANALYSIS
    ? THINKING_DETAIL_CONTENT_KIND.MODEL_ANALYSIS
    : THINKING_DETAIL_CONTENT_KIND.THINKING;
}

function activityContentFact(activity = {}, index) {
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
    sequence: Number(activity?.sequence || index + 1),
    sessionId: text(activity?.sessionId),
    dialogProcessId: text(activity?.dialogProcessId),
    turnScopeId: text(activity?.turnScopeId),
    messageId: text(activity?.messageId),
    presentationMessageId: text(activity?.presentationMessageId),
  };
}

export function projectThinkingDetailContentTimeline(messages = [], activityTimeline = []) {
  const timeline = (Array.isArray(messages) ? messages : []).flatMap((message = {}) =>
    Array.isArray(message?.thinkingContentTimeline) ? message.thinkingContentTimeline : [],
  );
  const activities = mergeCanonicalActivityTimelines(activityTimeline);
  const supersededRelayCorrelationIds = new Set(
    (Array.isArray(messages) ? messages : [])
      .filter((message = {}) => isThinkingDetailInjectedMessage(message))
      .map((message = {}) => text(message?.relayCorrelationId))
      .filter(Boolean),
  );
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    if (isThinkingDetailUserInterjection(message)) {
      const fact = messageContentFact(
        message,
        THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION,
        index,
      );
      if (fact) timeline.push(fact);
      continue;
    }
    if (isThinkingDetailInjectedMessage(message)) {
      const fact = messageContentFact(
        message,
        THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE,
        index,
      );
      if (fact) timeline.push(fact);
    }
  }
  for (const [index, activity] of activities.entries()) {
    if (
      supersededRelayCorrelationIds.size &&
      supersededRelayCorrelationIds.has(text(activity?.relayCorrelationId))
    ) {
      continue;
    }
    const fact = activityContentFact(activity, index);
    if (fact) timeline.push(fact);
  }
  return reduceThinkingDetailContentTimelines(timeline);
}

export function selectThinkingDetailContentTimeline(message = {}) {
  return (
    Array.isArray(message?.thinkingContentTimeline) ? message.thinkingContentTimeline : []
  ).filter(isThinkingDetailContentFact);
}
