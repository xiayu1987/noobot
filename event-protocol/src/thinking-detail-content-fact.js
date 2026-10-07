/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "./normalize.js";

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
    "messageId",
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

export function isThinkingDetailContentFact(value = {}) {
  const contentKind = text(value?.contentKind);
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    text(value.contentId) &&
    Object.values(THINKING_DETAIL_CONTENT_KIND).includes(contentKind) &&
    (contentKind !== THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY || text(value.activityKind)) &&
    (text(value.sourceMessageUid) || text(value.sourceEventId)) &&
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
  messageId = "",
  presentationMessageId = "",
} = {}) {
  const sourceMessageUid = text(messageUid);
  const fact = Object.freeze({
    contentId: `message:${sourceMessageUid}`,
    contentKind: THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION,
    sourceMessageUid,
    text: String(message || "").trim(),
    timestamp: text(receivedAt),
    sequence: Number(sequence),
    sessionId: text(sessionId),
    dialogProcessId: text(dialogProcessId),
    turnScopeId: text(turnScopeId),
    messageId: text(messageId),
    presentationMessageId: text(presentationMessageId),
  });
  if (!isThinkingDetailContentFact(fact)) {
    throw new TypeError("invalid user interjection content fact");
  }
  return fact;
}

export { THINKING_DETAIL_CONTENT_FIELDS };
