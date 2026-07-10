/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnMeta } from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeState, trim } from "./normalize";

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
  let state = wireState;
  const isBackendStateEvent = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(type);
  if (isBackendStateEvent && wireState === BackendChannelState.USER_STOPPED) {
    state = FrontendRunState.USER_STOP_COMPLETED;
  }
  if (isBackendStateEvent && wireState === BackendChannelState.STOPPING) {
    state = FrontendRunState.USER_STOPPING;
  }
  if (!state) {
    if (type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) state = BackendChannelState.SENDING;
    if (type === SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED) {
      state = FrontendRunState.CONTINUE_REQUESTING;
    }
    if (type === SESSION_RUN_EVENT.LOCAL_RESEND_STARTED) state = FrontendRunState.RESEND_REPLACING_TURN;
    if (type === SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN) state = FrontendRunState.RESEND_REPLACING_TURN;
    if (type === SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING) state = FrontendRunState.RESEND_STREAMING;
    if (type === SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED) state = FrontendRunState.FRONTEND_COMPLETED;
    if (type === SESSION_RUN_EVENT.LOCAL_RESEND_FAILED) state = BackendChannelState.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED) {
      state = FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
    }
    if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED) {
      state = FrontendRunState.FRONTEND_COMPLETED;
    }
    if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED) state = BackendChannelState.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED) state = FrontendRunState.USER_STOP_REQUESTED;
    if (type === SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING) state = BackendChannelState.RECONNECTING;
    if (type === SESSION_RUN_EVENT.LOCAL_FAILURE) state = BackendChannelState.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_RESET) state = FrontendRunState.IDLE;
  }
  const timestamp = normalizeTimestamp(rawEvent);
  return {
    type,
    state,
    backendState: wireState,
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
