/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnMeta } from "../../model/messageIdentity.js";
import { nowMs } from "../../model/timeFields.js";
import { SESSION_RUN_EVENT } from "./constants.js";
import { normalizeState, trim } from "./normalize.js";

export const TURN_RUNTIME_AUTHORITY = Object.freeze({
  NONE: "none",
  AUTHORITATIVE_DETAIL_APPLIED: "authoritative_detail_applied",
  AUTHORITATIVE_DETAIL_FAILED: "authoritative_detail_failed",
});

const TURN_START_EVENT_TYPES = Object.freeze([
  SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
  SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
  SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
  SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
]);

const BACKEND_STATE_EVENT_TYPES = Object.freeze([
  SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
  SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
]);

function isAuthoritativeEventType(type) {
  return (
    type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE ||
    type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
  );
}

function resolveRuntimeAuthority(type, rawEvent = {}) {
  if (rawEvent?.authority) return trim(rawEvent.authority);
  if (type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_APPLIED;
  }
  if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED) {
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_FAILED;
  }
  return TURN_RUNTIME_AUTHORITY.NONE;
}

function normalizeTimestamp(rawEvent = {}) {
  const numericTimestamp = Number(
    rawEvent?.timestamp || rawEvent?.updatedAtMs || rawEvent?.createdAtMs || 0,
  );
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) return numericTimestamp;
  const parsedUpdatedAt = rawEvent?.updatedAt ? Date.parse(rawEvent.updatedAt) : 0;
  if (Number.isFinite(parsedUpdatedAt) && parsedUpdatedAt > 0) return parsedUpdatedAt;
  const parsedCreatedAt = rawEvent?.createdAt ? Date.parse(rawEvent.createdAt) : 0;
  if (Number.isFinite(parsedCreatedAt) && parsedCreatedAt > 0) return parsedCreatedAt;
  return nowMs();
}

function resolveTurnState(rawEvent = {}) {
  return trim(rawEvent?.state || rawEvent?.raw?.turn?.state).toLowerCase();
}

function resolveEventState(type, rawEvent, wireState) {
  if (isAuthoritativeEventType(type)) return resolveTurnState(rawEvent);
  if (type === SESSION_RUN_EVENT.LOCAL_FAILURE) return normalizeState(rawEvent?.failureState);
  return wireState;
}

function resolveIdentityFields(rawEvent, turnMeta, type) {
  return {
    action: trim(rawEvent?.action),
    commandId: trim(rawEvent?.commandId),
    sessionId: trim(rawEvent?.sessionId),
    dialogProcessId: TURN_START_EVENT_TYPES.includes(type) ? "" : trim(rawEvent?.dialogProcessId),
    turnScopeId: turnMeta.turnScopeId,
    source: trim(rawEvent?.source || type),
  };
}

function resolveSequenceFields(rawEvent, type) {
  const rawSequence = Number(rawEvent?.sequence || rawEvent?.seq || 0);
  return {
    seq: rawSequence,
    transportSeq: BACKEND_STATE_EVENT_TYPES.includes(type)
      ? rawSequence
      : Number(rawEvent?.transportSeq || 0),
    lifecycleSeq: isAuthoritativeEventType(type)
      ? rawSequence
      : Number(rawEvent?.lifecycleSeq || 0),
    revision: Number(rawEvent?.revision || 0),
    summaryVersion: Number(rawEvent?.summaryVersion || 0),
  };
}

function resolveTurnPayloadFields(rawEvent, type) {
  const turn = rawEvent?.raw?.turn;
  return {
    authoritativeTurnState:
      type === SESSION_RUN_EVENT.TERMINAL_RESOLVED ? resolveTurnState(rawEvent) : "",
    finalizeIntent: rawEvent?.finalizeIntent || turn?.finalizeIntent || null,
    failure: rawEvent?.failure || turn?.failure || null,
    continuationSource: rawEvent?.continuationSource || turn?.continuationSource || null,
    continuedByTurnScopeId: trim(rawEvent?.continuedByTurnScopeId || turn?.continuedByTurnScopeId),
    materialization:
      rawEvent?.materialization && typeof rawEvent.materialization === "object"
        ? rawEvent.materialization
        : null,
  };
}

function resolveTimeFields(rawEvent) {
  return {
    timestamp: normalizeTimestamp(rawEvent),
    createdAtMs: Number(rawEvent?.createdAtMs || 0),
    updatedAtMs: Number(rawEvent?.updatedAtMs || 0),
    createdAt: trim(rawEvent?.createdAt),
    updatedAt: trim(rawEvent?.updatedAt),
  };
}

export function normalizeSessionRunEvent(rawEvent = {}) {
  const turnMeta = normalizeTurnMeta(rawEvent);
  const type = trim(
    rawEvent?.type || rawEvent?.event || SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  );
  const wireState = normalizeState(rawEvent?.state);
  return {
    type,
    state: resolveEventState(type, rawEvent, wireState),
    backendState: trim(rawEvent?.executionState).toLowerCase() || wireState,
    ...resolveIdentityFields(rawEvent, turnMeta, type),
    authority: resolveRuntimeAuthority(type, rawEvent),
    authoritativeSnapshot: rawEvent?.authoritativeSnapshot === true,
    sourceEvent: trim(rawEvent?.sourceEvent),
    ...resolveSequenceFields(rawEvent, type),
    completionCommitId: trim(rawEvent?.completionCommitId),
    ...resolveTurnPayloadFields(rawEvent, type),
    eventType: trim(rawEvent?.eventType),
    phase: trim(rawEvent?.phase || rawEvent?.failure?.phase),
    ...resolveTimeFields(rawEvent),
    raw: rawEvent,
  };
}
