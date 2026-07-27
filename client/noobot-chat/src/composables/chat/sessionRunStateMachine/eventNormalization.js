/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnMeta } from "../../infra/messageIdentity.js";
import { nowMs } from "../../infra/timeFields.js";
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants.js";
import { normalizeState, trim } from "./normalize.js";

const LOCAL_EVENT_STATE_BY_TYPE = Object.freeze({
  [SESSION_RUN_EVENT.LOCAL_SEND_STARTED]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_STARTED]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
  [SESSION_RUN_EVENT.LOCAL_RESEND_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
  [SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED]: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
  [SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED]: FrontendRunState.USER_STOPPING,
  [SESSION_RUN_EVENT.LOCAL_RESET]: FrontendRunState.IDLE,
});

export const TURN_RUNTIME_AUTHORITY = Object.freeze({
  NONE: "none",
  BACKEND_TERMINAL_OBSERVED: "backend_terminal_observed",
  AUTHORITATIVE_DETAIL_APPLIED: "authoritative_detail_applied",
  AUTHORITATIVE_DETAIL_FAILED: "authoritative_detail_failed",
});

function resolveRuntimeAuthority(type, wireState, rawEvent = {}) {
  if (rawEvent?.authority) return trim(rawEvent.authority);
  if (type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_APPLIED;
  }
  if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED) {
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_FAILED;
  }
  if (
    [SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE].includes(type) &&
    wireState === BackendChannelState.COMPLETED
  ) {
    return TURN_RUNTIME_AUTHORITY.BACKEND_TERMINAL_OBSERVED;
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

export function normalizeSessionRunEvent(rawEvent = {}) {
  const turnMeta = normalizeTurnMeta(rawEvent);
  const type = trim(rawEvent?.type || rawEvent?.event || SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE);
  const wireState = normalizeState(rawEvent?.state);
  let state = type === SESSION_RUN_EVENT.LOCAL_FAILURE
    ? normalizeState(rawEvent?.failureState)
    : wireState;
  const isBackendStateEvent = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(type);
  if (isBackendStateEvent && wireState === BackendChannelState.USER_STOPPED) {
    state = FrontendRunState.USER_STOPPING;
  }
  if (isBackendStateEvent && wireState === BackendChannelState.STOPPING) {
    state = FrontendRunState.USER_STOPPING;
  }
  if (!state) {
    state = type === SESSION_RUN_EVENT.LOCAL_FAILURE
      ? normalizeState(rawEvent?.failureState) || BackendChannelState.ERROR
      : LOCAL_EVENT_STATE_BY_TYPE[type] || "";
  }
  const timestamp = normalizeTimestamp(rawEvent);
  const rawSequence = Number(rawEvent?.sequence || rawEvent?.seq || 0);
  const isLifecycleEvent = type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE ||
    type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  return {
    type,
    state,
    backendState: trim(rawEvent?.executionState).toLowerCase() || wireState,
    action: trim(rawEvent?.action),
    sessionId: trim(rawEvent?.sessionId),
    dialogProcessId: [
      SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
      SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
    ].includes(type)
      ? ""
      : trim(rawEvent?.dialogProcessId),
    turnScopeId: turnMeta.turnScopeId,
    source: trim(rawEvent?.source || type),
    authority: resolveRuntimeAuthority(type, wireState, rawEvent),
    authoritativeSnapshot: rawEvent?.authoritativeSnapshot === true,
    sourceEvent: trim(rawEvent?.sourceEvent),
    seq: rawSequence,
    transportSeq: isBackendStateEvent ? rawSequence : Number(rawEvent?.transportSeq || 0),
    lifecycleSeq: isLifecycleEvent ? rawSequence : Number(rawEvent?.lifecycleSeq || 0),
    revision: Number(rawEvent?.revision || 0),
    summaryVersion: Number(rawEvent?.summaryVersion || 0),
    completionCommitId: trim(rawEvent?.completionCommitId),
    authoritativeTurnState: type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
      ? trim(rawEvent?.state || rawEvent?.raw?.turn?.state).toLowerCase()
      : "",
    finalizeIntent: rawEvent?.finalizeIntent || rawEvent?.raw?.turn?.finalizeIntent || null,
    failure: rawEvent?.failure || rawEvent?.raw?.turn?.failure || null,
    materialization: rawEvent?.materialization && typeof rawEvent.materialization === "object"
      ? rawEvent.materialization
      : null,
    eventType: trim(rawEvent?.eventType),
    phase: trim(rawEvent?.phase || rawEvent?.failure?.phase),
    timestamp,
    createdAtMs: Number(rawEvent?.createdAtMs || 0),
    updatedAtMs: Number(rawEvent?.updatedAtMs || 0),
    createdAt: trim(rawEvent?.createdAt),
    updatedAt: trim(rawEvent?.updatedAt),
    raw: rawEvent,
  };
}
