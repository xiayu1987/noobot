/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import { normalizeTrimmedString } from "./utils";
import { applyLatestSessionVersion, getCurrentSessionVersion, isNewerSessionVersion } from "./sessionVersionManager";

export function routeForeignTurnLifecycleEvent(event, data, context) {
  const { activeSession, sessionId, upsertSubSessionEvent } = context;
  if (event === StreamEventEnum.TURN_LIFECYCLE) {
    const eventSessionId = normalizeTrimmedString(data?.sessionId);
    const mainSessionId = normalizeTrimmedString(activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId);
    if (eventSessionId && mainSessionId && eventSessionId !== mainSessionId) {
      upsertSubSessionEvent?.(event, data || {});
      return true;
    }
  }
  return false;
}

export function routeCurrentTurnLifecycleEvent(event, data, context) {
  const { activeSession, applyRunStateEvent, sessionId } = context;
  if (event === StreamEventEnum.TURN_LIFECYCLE) {
    applyRunStateEvent?.({
      ...data, type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      source: "turn_lifecycle",
    });
    return true;
  }
  if (event !== "turn_committed") return false;
  const eventSessionId = normalizeTrimmedString(data?.sessionId);
  const targetSessionId = normalizeTrimmedString(activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId);
  if (eventSessionId === targetSessionId && isNewerSessionVersion(data?.sessionVersion, getCurrentSessionVersion(activeSession))) {
    applyLatestSessionVersion(activeSession.value, { version: data.sessionVersion, revision: data.sessionVersion });
  }
  return true;
}
