/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";

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

function mergeListByIdentity(previous = [], incoming = []) {
  const merged = new Map();
  const keyOf = (item = {}, index = 0, source = "list") =>
    text(item?.eventId || item?.key || item?.toolCallId || item?.id) ||
    `anonymous:${source}:${index}`;
  (Array.isArray(previous) ? previous : []).forEach((item, index) =>
    merged.set(keyOf(item, index, "previous"), item),
  );
  (Array.isArray(incoming) ? incoming : []).forEach((item, index) => {
    const key = keyOf(item, index, "incoming");
    merged.set(key, { ...object(merged.get(key)), ...object(item) });
  });
  return [...merged.values()];
}

function object(value) {
  return isPlainObject(value) ? value : {};
}

function messageKey(item = {}) {
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

function mergeMessage(previous = {}, incoming = {}) {
  const merged = selectMessageFacts(previous, incoming);
  for (const field of ["toolTimeline", "activityTimeline", "rawEvents"]) {
    if (Array.isArray(previous[field]) || Array.isArray(incoming[field])) {
      merged[field] = mergeListByIdentity(previous[field], incoming[field]);
    }
  }
  return merged;
}

function mergeMessages(baseItems, incomingItems, { replace }) {
  if (replace) {
    incomingItems.forEach(messageKey);
    return incomingItems.map((item) => ({ ...object(item) }));
  }
  const merged = new Map();
  baseItems.forEach((item) => merged.set(messageKey(item), { ...object(item) }));
  incomingItems.forEach((item) => {
    const key = messageKey(item);
    merged.set(key, mergeMessage(merged.get(key), object(item)));
  });
  return [...merged.values()];
}

const NON_DETAIL_FIELDS = ["sessionSummary", "turnTimings"];

export function requireTopLevelDetail(value, side) {
  const detail = object(value);
  const foreignField = NON_DETAIL_FIELDS.find((field) => Object.hasOwn(detail, field));
  if (foreignField) {
    throw new TypeError(
      `[session-detail] ${side} detail carries ${foreignField}; session detail carries only sessionId/messages at top level, turn timings are applied to the turn runtime registry`,
    );
  }
  return detail;
}

export function mergeCanonicalSessionDetail(base = {}, incoming = {}, { replaceFields = [] } = {}) {
  const previous = requireTopLevelDetail(base, "base");
  const next = requireTopLevelDetail(incoming, "incoming");
  const previousSessionId = text(previous.sessionId);
  const nextSessionId = text(next.sessionId);
  const sessionId = nextSessionId || previousSessionId;
  const sameSession = !previousSessionId || !nextSessionId || previousSessionId === nextSessionId;
  const safePrevious = sameSession ? previous : {};
  const replacements = new Set(replaceFields);
  const listOf = (source) => (Array.isArray(source.messages) ? source.messages : []);
  return {
    ...safePrevious,
    ...next,
    sessionId,
    messages: mergeMessages(listOf(safePrevious), listOf(next), {
      replace: replacements.has("messages"),
    }),
  };
}
