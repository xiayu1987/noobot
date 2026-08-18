/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function messageRole(item = {}) {
  return text(item?.role || item?.messageRole).toLowerCase();
}

function isPersistedFinalAssistant(item = {}) {
  return (
    messageRole(item) === "assistant" &&
    Boolean(text(item?.presentationMessageId || item?.messageUid || item?.messageId || item?.id)) &&
    text(item?.type).toLowerCase() === "message" &&
    Boolean(text(item?.content)) &&
    item?.pending === false
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

function text(value = "") {
  return String(value || "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function entityKey(item = {}, index = 0, kind = "entity") {
  if (kind === "message") {
    const role = messageRole(item);
    if (role === "assistant") {
      const presentationMessageId = text(item?.presentationMessageId);
      if (presentationMessageId) return `assistant-presentation:${presentationMessageId}`;
    }
    const messageIdentity =
      role === "tool"
        ? text(item?.messageUid || item?.messageId || item?.id || item?.toolCallId)
        : text(item?.messageUid || item?.messageId || item?.id);
    return messageIdentity ? `message:${messageIdentity}` : "";
  }
  const stableId = text(item?.id || item?.messageId || item?.toolCallId);
  if (stableId) return `id:${stableId}`;
  // Message identity is protocol identity. Turn, dialog, role and array order
  // are projection attributes and must never be used to guess entity equality.
  if (kind === "message") return "";
  const turnScopeId = text(item?.turnScopeId);
  if (turnScopeId) return `turn:${turnScopeId}:${kind}`;
  const dialogProcessId = text(item?.dialogProcessId);
  if (dialogProcessId) return `dialog:${dialogProcessId}:${kind}`;
  return `${kind}:index:${index}`;
}

function mergeEntity(previous = {}, incoming = {}, kind = "entity") {
  if (kind === "message") {
    const previousIsFinal = isPersistedFinalAssistant(previous);
    const incomingIsFinal = isPersistedFinalAssistant(incoming);
    const authoritative = previousIsFinal && !incomingIsFinal ? previous : incoming;
    const supplemental = authoritative === previous ? incoming : previous;
    const merged = { ...supplemental, ...authoritative };
    for (const field of ["toolTimeline", "activityTimeline", "rawEvents"]) {
      if (Array.isArray(previous[field]) || Array.isArray(incoming[field])) {
        merged[field] = mergeListByIdentity(previous[field], incoming[field]);
      }
    }
    if (previousIsFinal || incomingIsFinal) merged.pending = false;
    return merged;
  }
  return { ...previous, ...incoming };
}

export function mergeSessionDetailEntities(
  baseItems = [],
  incomingItems = [],
  { kind = "entity", replace = false } = {},
) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  const accepted = (items) =>
    kind === "message" ? items.filter((item) => Boolean(entityKey(item, 0, kind))) : items;
  if (replace) return accepted(incoming).map((item) => ({ ...object(item) }));
  const merged = new Map();
  accepted(base).forEach((item, index) =>
    merged.set(entityKey(item, index, kind), { ...object(item) }),
  );
  accepted(incoming).forEach((item, index) => {
    const key = entityKey(item, index, kind);
    merged.set(key, mergeEntity(merged.get(key), object(item), kind));
  });
  return [...merged.values()];
}

export function mergeCanonicalSessionDetail(base = {}, incoming = {}, { replaceFields = [] } = {}) {
  const previous = object(base);
  const next = object(incoming);
  const previousSummary = object(previous.sessionSummary);
  const nextSummary = object(next.sessionSummary);
  const previousSessionId = text(previous.sessionId || previousSummary.sessionId);
  const nextSessionId = text(next.sessionId || nextSummary.sessionId);
  const sessionId = nextSessionId || previousSessionId;
  const sameSession = !previousSessionId || !nextSessionId || previousSessionId === nextSessionId;
  const safePrevious = sameSession ? previous : {};
  const safePreviousSummary = sameSession ? previousSummary : {};
  const replacements = new Set(replaceFields);
  const pickList = (field) => {
    const direct = Array.isArray(next[field]) ? next[field] : undefined;
    const summary = Array.isArray(nextSummary[field]) ? nextSummary[field] : undefined;
    return direct ?? summary ?? [];
  };
  const baseList = (field) => {
    const direct = Array.isArray(safePrevious[field]) ? safePrevious[field] : undefined;
    const summary = Array.isArray(safePreviousSummary[field])
      ? safePreviousSummary[field]
      : undefined;
    return direct ?? summary ?? [];
  };
  const mergeField = (field, kind = field) =>
    mergeSessionDetailEntities(baseList(field), pickList(field), {
      kind,
      replace: replacements.has(field),
    });
  const messages = mergeField("messages", "message");
  const turnTimings = mergeField("turnTimings", "turnTiming");
  return {
    ...safePrevious,
    ...next,
    sessionId,
    messages,
    turnTimings,
    sessionSummary: {
      ...safePreviousSummary,
      ...nextSummary,
      sessionId,
      messages,
      turnTimings,
    },
  };
}
