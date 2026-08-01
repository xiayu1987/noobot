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
  const transportEvent = normalizeTrimmedString(event).toLowerCase();
  if (transportEvent === StreamEventEnum.TURN_LIFECYCLE) {
    const eventSessionId = normalizeTrimmedString(data?.sessionId);
    const mainSessionId = normalizeTrimmedString(activeSession?.value?.backendSessionId || activeSession?.value?.id || sessionId);
    logSessionEvent?.({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.authoritativeState.lifecycleRouteEvaluated",
      sessionId: mainSessionId || eventSessionId,
      dialogProcessId: data?.dialogProcessId || "",
      turnScopeId: data?.turnScopeId || "",
      data: {
        route: eventSessionId && mainSessionId && eventSessionId !== mainSessionId ? "child" : "main",
        eventSessionId,
        mainSessionId,
        parentSessionId: normalizeTrimmedString(data?.parentSessionId),
        eventType: normalizeTrimmedString(data?.eventType).toLowerCase(),
        revision: Number(data?.revision || 0),
        sequence: Number(data?.sequence || 0),
        hasPersistenceScope: Boolean(data?.persistenceScope?.scopeId),
        reducerAvailable: typeof applyRunStateEvent === "function",
      },
    });
    if (eventSessionId && mainSessionId && eventSessionId !== mainSessionId) {
      const result = applyRunStateEvent?.({
        ...data,
        type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
        source: "turn_lifecycle",
      });
      const terminalLifecycle = ["turn.completed", "turn.stop_completed", "turn.failed"]
        .includes(normalizeTrimmedString(data?.eventType).toLowerCase());
      const logReduction = (reduction = {}) => {
        const rejected = reduction?.applied !== true;
        const runtimeProjection = reduction?.subSessionEffect?.runtimeProjection || null;
        const projectedSession = runtimeProjection?.session || null;
        return logSessionEvent?.({
          category: terminalLifecycle || rejected ? "state" : "debug",
          level: rejected ? "warn" : (terminalLifecycle ? "info" : "debug"),
          ...(terminalLifecycle || rejected ? {} : { debugType: "workflow-diagnostics" }),
          event: terminalLifecycle
            ? "frontend.authoritativeState.foreignTerminalReduced"
            : rejected
              ? "frontend.authoritativeState.foreignTurnRejected"
              : "frontend.authoritativeState.foreignTurnReduced",
          sessionId: mainSessionId,
          dialogProcessId: data?.dialogProcessId || "",
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
            projectionApplied: runtimeProjection?.applied === true,
            projectionReason: runtimeProjection?.reason || "",
            projectedStatus: projectedSession?.status || "",
            projectedMessages: (Array.isArray(projectedSession?.messages) ? projectedSession.messages : [])
              .map((message = {}) => ({
                messageId: normalizeTrimmedString(message?.messageId || message?.id),
                role: normalizeTrimmedString(message?.role),
                turnScopeId: normalizeTrimmedString(message?.turnScopeId),
                pending: message?.pending,
                channelState: normalizeTrimmedString(message?.channelState?.state),
              })),
            terminalResolutionScheduled: terminalLifecycle,
          },
        });
      };
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
  const { activeSession, applyRunStateEvent, logSessionEvent, sessionId } = context;
  if (normalizeTrimmedString(event).toLowerCase() === StreamEventEnum.TURN_LIFECYCLE) {
    const result = applyRunStateEvent?.({
      ...data, type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      source: "turn_lifecycle",
    });
    logSessionEvent?.({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.authoritativeState.mainLifecycleDispatched",
      sessionId: normalizeTrimmedString(data?.sessionId || sessionId),
      dialogProcessId: data?.dialogProcessId || "",
      turnScopeId: data?.turnScopeId || "",
      data: {
        eventType: normalizeTrimmedString(data?.eventType).toLowerCase(),
        asynchronous: Boolean(result && typeof result.then === "function"),
      },
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
