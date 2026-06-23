/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnMeta } from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import { SESSION_RUN_EVENT, SESSION_RUN_STATE } from "./constants";
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
  let state = normalizeState(rawEvent?.state);
  if (!state) {
    if (type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) state = SESSION_RUN_STATE.SENDING;
    if (type === SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED) state = SESSION_RUN_STATE.STOP_REQUESTED;
    if (type === SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING) state = SESSION_RUN_STATE.RECONNECTING;
    if (type === SESSION_RUN_EVENT.LOCAL_FAILURE) state = SESSION_RUN_STATE.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_RESET) state = SESSION_RUN_STATE.IDLE;
  }
  const timestamp = normalizeTimestamp(rawEvent);
  return {
    type,
    state,
    sessionId: trim(rawEvent?.sessionId),
    dialogProcessId: type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED
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
