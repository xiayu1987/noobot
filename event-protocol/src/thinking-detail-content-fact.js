/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject, text } from "@noobot/shared/value";

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

function hasExclusiveContentSource(value, contentKind) {
  const sourceField = THINKING_DETAIL_CONTENT_SOURCE_FIELD[contentKind];
  return Boolean(
    sourceField &&
    isCanonicalText(value[sourceField]) &&
    [...THINKING_DETAIL_CONTENT_SOURCE_FIELDS].every(
      (field) => field === sourceField || !Object.hasOwn(value, field),
    ),
  );
}

export function isThinkingDetailContentFact(value) {
  if (!isPlainObject(value)) return false;
  const { contentKind } = value;
  return Boolean(
    isCanonicalText(value.contentId) &&
    (contentKind !== THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY ||
      isCanonicalText(value.activityKind)) &&
    hasExclusiveContentSource(value, contentKind) &&
    typeof value.text === "string" &&
    text(value.text) &&
    Number.isInteger(value.sequence) &&
    value.sequence > 0 &&
    Object.keys(value).every((field) => THINKING_DETAIL_CONTENT_FIELDS.has(field)),
  );
}

export const USER_INTERJECTION_FACT_REQUIREMENTS = Object.freeze([
  ["sourceMessageUid", "missing_user_interjection_fact_source_message_uid"],
  ["timestamp", "missing_user_interjection_fact_timestamp"],
  ["sessionId", "missing_user_interjection_fact_session_id"],
  ["dialogProcessId", "missing_user_interjection_fact_dialog_process_id"],
  ["turnScopeId", "missing_user_interjection_fact_turn_scope_id"],
  ["presentationMessageId", "missing_user_interjection_fact_presentation_message_id"],
]);

export function validateUserInterjectionFact(contentFact) {
  if (!isThinkingDetailContentFact(contentFact)) return ["invalid_user_interjection_content_fact"];
  if (contentFact.contentKind !== THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION) {
    return ["invalid_user_interjection_content_kind"];
  }
  const errors = USER_INTERJECTION_FACT_REQUIREMENTS.filter(
    ([field]) => !isCanonicalText(contentFact[field]),
  ).map(([, error]) => error);
  if (!Number.isInteger(contentFact.sequence)) {
    errors.push("invalid_user_interjection_fact_sequence");
  }
  if (contentFact.contentId !== `message:${contentFact.sourceMessageUid}`) {
    errors.push("interjection_content_identity_mismatch");
  }
  return errors;
}

export function createUserInterjectionContentFact({
  messageUid,
  message,
  receivedAt,
  sequence,
  sessionId,
  dialogProcessId,
  turnScopeId,
  presentationMessageId,
}) {
  const fact = Object.freeze({
    contentId: `message:${messageUid}`,
    contentKind: THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION,
    sourceMessageUid: messageUid,
    text: message,
    timestamp: receivedAt,
    sequence,
    sessionId,
    dialogProcessId,
    turnScopeId,
    presentationMessageId,
  });
  const errors = validateUserInterjectionFact(fact);
  if (errors.length > 0) {
    throw new TypeError(`invalid user interjection content fact: ${errors.join(",")}`);
  }
  return fact;
}

export { THINKING_DETAIL_CONTENT_FIELDS };
