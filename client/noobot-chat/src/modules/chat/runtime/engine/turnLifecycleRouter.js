/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { normalizeTrimmedString } from "./utils.js";
import { applyLatestSessionVersion, getCurrentSessionVersion, isNewerSessionVersion } from "./sessionVersionManager.js";

export function routeForeignTurnLifecycleEvent(event, data, context) {
  const { activeSession, applyRunStateEvent, logSessionEvent, sessionId } = context;
  if (event === StreamEventEnum.TURN_LIFECYCLE) {
    const eventSessionId = normalizeTrimmedString(data?.sessionId);
    const mainSessionId = normalizeTrimmedString(activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId);
    if (eventSessionId && mainSessionId && eventSessionId !== mainSessionId) {
      const result = applyRunStateEvent?.({
        ...data,
        type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
        source: "turn_lifecycle",
      });
      const logReduction = (reduction = {}) => logSessionEvent?.({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "frontend.authoritativeState.foreignTurnReduced",
        sessionId: mainSessionId,
        turnScopeId: data?.turnScopeId || "",
        data: {
          childSessionId: eventSessionId,
          parentSessionId: data?.parentSessionId || "",
          eventId: data?.eventId || "",
          eventType: data?.eventType || "",
          revision: Number(data?.revision || 0),
          sequence: Number(data?.sequence || 0),
          applied: reduction?.applied === true,
          reason: reduction?.reason || "",
          projectedStatus: reduction?.subSessionEffect?.session?.status || "",
          terminalResolutionScheduled: ["turn.completed", "turn.stop_completed", "turn.failed"].includes(data?.eventType),
        },
      });
      if (result && typeof result.then === "function") {
        void result.then(logReduction, (error) => logReduction({
          applied: false,
          reason: String(error?.message || "foreign_turn_reduction_failed"),
        }));
      } else {
        logReduction(result);
      }
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
