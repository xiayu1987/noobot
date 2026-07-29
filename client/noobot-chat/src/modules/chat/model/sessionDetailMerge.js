/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const TERMINAL_TURN_STATES = new Set([
  "completed", "frontend_completed", "user_stopped", "cancelled", "aborted",
  "error", "expired", "timeout", "no_conversation",
]);

function text(value = "") {
  return String(value || "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function entityKey(item = {}, index = 0, kind = "entity") {
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

function normalizeState(value = "") {
  return text(value).toLowerCase();
}

function mergeEntity(previous = {}, incoming = {}, kind = "entity") {
  if (kind !== "turnStatus") return { ...previous, ...incoming };
  const previousState = normalizeState(previous?.status || previous?.state);
  const incomingState = normalizeState(incoming?.status || incoming?.state);
  if (TERMINAL_TURN_STATES.has(previousState) && incomingState && !TERMINAL_TURN_STATES.has(incomingState)) {
    const { status, state, ...rest } = incoming;
    return { ...previous, ...rest };
  }
  return { ...previous, ...incoming };
}

export function mergeSessionDetailEntities(baseItems = [], incomingItems = [], { kind = "entity", replace = false } = {}) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  const accepted = (items) => kind === "message"
    ? items.filter((item) => Boolean(entityKey(item, 0, kind)))
    : items;
  if (replace) return accepted(incoming).map((item) => ({ ...object(item) }));
  const merged = new Map();
  accepted(base).forEach((item, index) => merged.set(entityKey(item, index, kind), { ...object(item) }));
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
    const summary = Array.isArray(safePreviousSummary[field]) ? safePreviousSummary[field] : undefined;
    return direct ?? summary ?? [];
  };
  const mergeField = (field, kind = field) => mergeSessionDetailEntities(
    baseList(field),
    pickList(field),
    { kind, replace: replacements.has(field) },
  );
  const messages = mergeField("messages", "message");
  const rawMessages = mergeField("rawMessages", "message");
  const turnStatuses = mergeField("turnStatuses", "turnStatus");
  const turnTimings = mergeField("turnTimings", "turnTiming");
  return {
    ...safePrevious,
    ...next,
    sessionId,
    messages,
    rawMessages: rawMessages.length ? rawMessages : messages,
    turnStatuses,
    turnTimings,
    sessionSummary: {
      ...safePreviousSummary,
      ...nextSummary,
      sessionId,
      messages,
      turnStatuses,
      turnTimings,
    },
  };
}
