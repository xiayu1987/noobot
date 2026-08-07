/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { normalizeTrimmedString } from "./utils.js";
import { applyLatestSessionAggregateVersion, getCurrentSessionAggregateVersion, isNewerSessionAggregateVersion } from "./sessionAggregateVersionManager.js";
import { validateTurnCommittedEventData } from "@noobot/shared/turn-commit-protocol";

export function routeForeignTurnLifecycleEvent(event, data, context) {
  const { activeSession, applyTurnLifecycleEnvelope, logSessionEvent, sessionId } = context;
  const transportEvent = normalizeTrimmedString(event).toLowerCase();
  if (transportEvent === StreamEventEnum.TURN_LIFECYCLE) {
    const eventSessionId = normalizeTrimmedString(data?.sessionId);
    const mainSessionId = normalizeTrimmedString(activeSession?.value?.sessionId || sessionId);
    const parentSessionId = normalizeTrimmedString(data?.parentSessionId);
    const isChildLifecycle = Boolean(
      eventSessionId && mainSessionId && eventSessionId !== mainSessionId &&
      parentSessionId && parentSessionId === mainSessionId,
    );
    logSessionEvent?.({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.authoritativeState.lifecycleRouteEvaluated",
      sessionId: mainSessionId || eventSessionId,
      dialogProcessId: data?.dialogProcessId || "",
      turnScopeId: data?.turnScopeId || "",
      data: {
        route: isChildLifecycle ? "child" : "main",
        eventSessionId,
        mainSessionId,
        parentSessionId,
        eventType: normalizeTrimmedString(data?.eventType).toLowerCase(),
        revision: Number(data?.revision || 0),
        sequence: Number(data?.sequence || 0),
        hasPersistenceScope: Boolean(data?.persistenceScope?.scopeId),
        reducerAvailable: typeof applyTurnLifecycleEnvelope === "function",
      },
    });
    if (isChildLifecycle) {
      const result = applyTurnLifecycleEnvelope?.(data);
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
  const {
    activeSession,
    applyTurnLifecycleEnvelope,
    findCanonicalMessageById,
    logSessionEvent,
    makeViewMessage,
    sessionId,
  } = context;
  if (normalizeTrimmedString(event).toLowerCase() === StreamEventEnum.TURN_LIFECYCLE) {
    const lifecycleEventType = normalizeTrimmedString(data?.eventType).toLowerCase();
    const result = applyTurnLifecycleEnvelope?.(data);
    const logReduction = (reduction = {}) => {
      const rejected = reduction?.applied !== true;
      const terminalLifecycle = ["turn.completed", "turn.stop_completed", "turn.failed"]
        .includes(lifecycleEventType);
      logSessionEvent?.({
        category: terminalLifecycle || rejected ? "state" : "debug",
        level: rejected ? "warn" : (terminalLifecycle ? "info" : "debug"),
        ...(terminalLifecycle || rejected ? {} : { debugType: "workflow-diagnostics" }),
        event: terminalLifecycle
          ? "frontend.authoritativeState.mainTerminalReduced"
          : rejected
            ? "frontend.authoritativeState.mainTurnRejected"
            : "frontend.authoritativeState.mainTurnReduced",
        sessionId: normalizeTrimmedString(data?.sessionId || sessionId),
        dialogProcessId: data?.dialogProcessId || "",
        turnScopeId: data?.turnScopeId || "",
        data: {
          eventId: normalizeTrimmedString(data?.eventId),
          eventType: normalizeTrimmedString(data?.eventType).toLowerCase(),
          revision: Number(data?.revision || 0),
          sequence: Number(data?.sequence || 0),
          applied: reduction?.applied === true,
          reason: normalizeTrimmedString(reduction?.reason),
          errors: Array.isArray(reduction?.errors) ? reduction.errors : [],
          projectedState: normalizeTrimmedString(reduction?.turn?.state),
          projectedTerminal: normalizeTrimmedString(reduction?.turn?.terminal),
        },
      });
    };
    if (result && typeof result.then === "function") {
      void result.then(logReduction, (error) => logReduction({
        applied: false,
        reason: String(error?.message || "main_turn_reduction_failed"),
      }));
    } else {
      logReduction(result);
    }
    return true;
  }
  if (event !== "turn_committed") return false;
  const eventSessionId = normalizeTrimmedString(data?.sessionId);
  const targetSessionId = normalizeTrimmedString(activeSession?.value?.sessionId || sessionId);
  const committedUserMessage = data?.userMessage;
  const committedMessageId = normalizeTrimmedString(committedUserMessage?.messageId);
  const validation = validateTurnCommittedEventData(data);
  let applied = false;
  let reason = "";
  if (!validation.ok) {
    reason = `protocol:${validation.errors[0]}`;
  } else if (eventSessionId !== targetSessionId) {
    reason = "committed_session_mismatch";
  } else {
    const targetMessage = findCanonicalMessageById?.(targetSessionId, committedMessageId);
    if (!targetMessage) {
      reason = "committed_user_target_missing";
    } else {
      const projectedMessage = typeof makeViewMessage === "function"
        ? makeViewMessage(committedUserMessage)
        : committedUserMessage;
      Object.assign(targetMessage, projectedMessage);
      targetMessage.attachments = Array.isArray(projectedMessage?.attachments)
        ? projectedMessage.attachments.map((attachment) => ({ ...attachment }))
        : [];
      if (isNewerSessionAggregateVersion(data?.aggregateVersion, getCurrentSessionAggregateVersion(activeSession))) {
        applyLatestSessionAggregateVersion(activeSession.value, {
          aggregateVersion: data.aggregateVersion,
        });
      }
      applied = true;
      reason = "applied";
    }
  }
  logSessionEvent?.({
    category: applied ? "message" : "state",
    level: applied ? "info" : "warn",
    event: applied
      ? "frontend.turnCommit.userMessageApplied"
      : "frontend.turnCommit.userMessageRejected",
    sessionId: eventSessionId || targetSessionId,
    dialogProcessId: data?.dialogProcessId || "",
    turnScopeId: data?.turnScopeId || "",
    data: {
      applied,
      reason,
      messageId: committedMessageId,
      messageUid: normalizeTrimmedString(committedUserMessage?.messageUid),
      attachmentCount: Array.isArray(committedUserMessage?.attachments)
        ? committedUserMessage.attachments.length
        : 0,
      aggregateVersion: Number(data?.aggregateVersion || 0),
    },
  });
  return true;
}
