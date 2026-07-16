/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnMeta } from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeState, trim } from "./normalize";

const LOCAL_EVENT_STATE_BY_TYPE = Object.freeze({
  [SESSION_RUN_EVENT.LOCAL_SEND_STARTED]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_STARTED]: FrontendRunState.ACTION_REQUESTING,
  // Replacing the old turn and opening the stream are still request work.
  // Only an identity-matched backend `sending` fact starts processing.
  [SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING]: FrontendRunState.ACTION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
  [SESSION_RUN_EVENT.LOCAL_RESEND_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
  [SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED]: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  [SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED]: FrontendRunState.FRONTEND_COMPLETED,
  [SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
  [SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED]: FrontendRunState.USER_STOPPING,
  [SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED]: FrontendRunState.USER_STOP_COMPLETED,
  [SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED]: FrontendRunState.STOP_ERROR,
  [SESSION_RUN_EVENT.LOCAL_RESET]: FrontendRunState.IDLE,
});

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
  // A local failure belongs to the frontend phase in which it happened.  Some
  // callers also carry `state: error`; do not let that backend-shaped value
  // erase the more precise action/processing/completion/stop attribution.
  let state = type === SESSION_RUN_EVENT.LOCAL_FAILURE
    ? normalizeState(rawEvent?.failureState)
    : wireState;
  const isBackendStateEvent = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(type);
  if (isBackendStateEvent && wireState === BackendChannelState.USER_STOPPED) {
    // Backend persistence is confirmed, but the frontend still has to read and
    // apply the authoritative session summary before exposing its stop terminal.
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
  return {
    type,
    state,
    backendState: wireState,
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
    authoritativeSnapshot: rawEvent?.authoritativeSnapshot === true,
    sourceEvent: trim(rawEvent?.sourceEvent),
    seq: Number(rawEvent?.seq || 0),
    timestamp,
    createdAtMs: Number(rawEvent?.createdAtMs || 0),
    updatedAtMs: Number(rawEvent?.updatedAtMs || 0),
    createdAt: trim(rawEvent?.createdAt),
    updatedAt: trim(rawEvent?.updatedAt),
    raw: rawEvent,
  };
}
