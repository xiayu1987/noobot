/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

const THINKING_DETAIL_CONTENT_FIELDS = Object.freeze(
  new Set([
    "contentId",
    "contentKind",
    "activityKind",
    "sourceMessageUid",
    "sourceEventId",
    "text",
    "timestamp",
    "sequence",
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "presentationMessageId",
  ]),
);

export const THINKING_DETAIL_CONTENT_KIND = Object.freeze({
  INJECTED_MESSAGE: "injected_message",
  USER_INTERJECTION: "user_interjection",
  MODEL_ANALYSIS: "model_analysis",
  THINKING: "thinking",
  PLUGIN_ACTIVITY: "plugin_activity",
});

export const THINKING_DETAIL_CONTENT_SOURCE_FIELD = Object.freeze({
  [THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE]: "sourceMessageUid",
  [THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION]: "sourceMessageUid",
  [THINKING_DETAIL_CONTENT_KIND.MODEL_ANALYSIS]: "sourceEventId",
  [THINKING_DETAIL_CONTENT_KIND.THINKING]: "sourceEventId",
  [THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY]: "sourceEventId",
});

const THINKING_DETAIL_CONTENT_SOURCE_FIELDS = Object.freeze(
  new Set(Object.values(THINKING_DETAIL_CONTENT_SOURCE_FIELD)),
);

function hasExclusiveContentSource(value = {}, contentKind = "") {
  const sourceField = THINKING_DETAIL_CONTENT_SOURCE_FIELD[contentKind];
  return Boolean(
    sourceField &&
    text(value[sourceField]) &&
    [...THINKING_DETAIL_CONTENT_SOURCE_FIELDS].every(
      (field) => field === sourceField || !Object.hasOwn(value, field),
    ),
  );
}

export function isThinkingDetailContentFact(value = {}) {
  const contentKind = text(value?.contentKind);
  return Boolean(
    isPlainObject(value) &&
    text(value.contentId) &&
    (contentKind !== THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY || text(value.activityKind)) &&
    hasExclusiveContentSource(value, contentKind) &&
    typeof value.text === "string" &&
    text(value.text) &&
    Number.isInteger(Number(value.sequence)) &&
    Number(value.sequence) > 0 &&
    Object.keys(value).every((field) => THINKING_DETAIL_CONTENT_FIELDS.has(field)),
  );
}

export function createUserInterjectionContentFact({
  messageUid = "",
  message = "",
  receivedAt = "",
  sequence = 0,
  sessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  presentationMessageId = "",
} = {}) {
  const sourceMessageUid = text(messageUid);
  const fact = Object.freeze({
    contentId: `message:${sourceMessageUid}`,
    contentKind: THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION,
    sourceMessageUid,
    text: text(message),
    timestamp: text(receivedAt),
    sequence: Number(sequence),
    sessionId: text(sessionId),
    dialogProcessId: text(dialogProcessId),
    turnScopeId: text(turnScopeId),
    presentationMessageId: text(presentationMessageId),
  });
  if (!isThinkingDetailContentFact(fact)) {
    throw new TypeError("invalid user interjection content fact");
  }
  return fact;
}

export { THINKING_DETAIL_CONTENT_FIELDS };
