/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MESSAGE_EVENT_TYPE } from "./message-event.js";
import { mergeCanonicalActivityTimelines } from "./activity-timeline.js";
import { text } from "./normalize.js";

const THINKING_DETAIL_CONTENT_FIELDS = Object.freeze(
  new Set([
    "contentId",
    "contentKind",
    "sourceMessageUid",
    "sourceEventId",
    "text",
    "timestamp",
    "sequence",
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "messageId",
    "presentationMessageId",
  ]),
);

export const THINKING_DETAIL_CONTENT_KIND = Object.freeze({
  INJECTED_MESSAGE: "injected_message",
  MAIN_MODEL_CONTENT: "main_model_content",
  THINKING: "thinking",
});

function messageIdentity(message = {}) {
  return text(message?.messageUid);
}

function messageContent(message = {}) {
  return typeof message?.content === "string" ? message.content.trim() : "";
}

export function isThinkingDetailControlMessage(message = {}) {
  return (
    text(message?.type) === "context_control" ||
    Boolean(text(message?.noobotInternalMessageType)) ||
    Boolean(text(message?.additional_kwargs?.noobotInternalMessageType)) ||
    Boolean(text(message?.metadata?.noobotInternalMessageType)) ||
    Boolean(text(message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType)) ||
    Boolean(text(message?.lc_kwargs?.metadata?.noobotInternalMessageType))
  );
}

export function isThinkingDetailInjectedMessage(message = {}) {
  return message?.injectedMessage === true && !isThinkingDetailControlMessage(message);
}

function messageContentFact(message = {}, contentKind, index) {
  const identity = messageIdentity(message);
  const value = messageContent(message);
  if (!identity || !value) return null;
  return {
    contentId: `message:${identity}`,
    contentKind,
    sourceMessageUid: identity,
    text: value,
    timestamp: text(message?.ts),
    sequence: Number(index) + 1,
    sessionId: text(message?.sessionId),
    dialogProcessId: text(message?.dialogProcessId),
    turnScopeId: text(message?.turnScopeId),
    messageId: text(message?.messageId),
    presentationMessageId: text(message?.presentationMessageId),
  };
}

function activityContentFact(activity = {}, index) {
  const eventId = text(activity?.eventId);
  const value = text(activity?.text);
  if (!eventId || !value) return null;
  return {
    contentId: `event:${eventId}`,
    contentKind:
      text(activity?.eventType) === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT
        ? THINKING_DETAIL_CONTENT_KIND.MAIN_MODEL_CONTENT
        : THINKING_DETAIL_CONTENT_KIND.THINKING,
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
  const timeline = [];
  const activities = mergeCanonicalActivityTimelines(activityTimeline);
  const hasUnboundMainModelActivity = activities.some(
    (item) => item.eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT && !text(item.messageId),
  );
  const boundMainModelIds = new Set(
    activities
      .filter((item) => item.eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT)
      .map((item) => text(item.messageId))
      .filter(Boolean),
  );
  const messageUidsWithMainModelActivity = new Set(
    (Array.isArray(messages) ? messages : [])
      .filter((message = {}) =>
        mergeCanonicalActivityTimelines(message?.activityTimeline || []).some(
          (item) => item.eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT,
        ),
      )
      .map((message = {}) => messageIdentity(message))
      .filter(Boolean),
  );
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    if (isThinkingDetailInjectedMessage(message)) {
      const fact = messageContentFact(
        message,
        THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE,
        index,
      );
      if (fact) timeline.push(fact);
      continue;
    }
    const messageId = text(message?.messageId || message?.id);
    if (
      text(message?.role) === "assistant" &&
      text(message?.type) === "tool_call" &&
      !hasUnboundMainModelActivity &&
      !boundMainModelIds.has(messageId) &&
      !messageUidsWithMainModelActivity.has(messageIdentity(message))
    ) {
      const fact = messageContentFact(
        message,
        THINKING_DETAIL_CONTENT_KIND.MAIN_MODEL_CONTENT,
        index,
      );
      if (fact) timeline.push(fact);
    }
  }
  for (const [index, activity] of activities.entries()) {
    const fact = activityContentFact(activity, index);
    if (fact) timeline.push(fact);
  }
  return Object.freeze(timeline.map((fact) => Object.freeze(fact)));
}

export function isThinkingDetailContentFact(value = {}) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    text(value.contentId) &&
    Object.values(THINKING_DETAIL_CONTENT_KIND).includes(text(value.contentKind)) &&
    (text(value.sourceMessageUid) || text(value.sourceEventId)) &&
    typeof value.text === "string" &&
    text(value.text) &&
    Number.isInteger(Number(value.sequence)) &&
    Number(value.sequence) > 0 &&
    Object.keys(value).every((field) => THINKING_DETAIL_CONTENT_FIELDS.has(field)),
  );
}

export function selectThinkingDetailContentTimeline(message = {}) {
  return (
    Array.isArray(message?.thinkingContentTimeline) ? message.thinkingContentTimeline : []
  ).filter(isThinkingDetailContentFact);
}
