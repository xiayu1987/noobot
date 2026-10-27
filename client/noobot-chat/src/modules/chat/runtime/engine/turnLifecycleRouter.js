/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { applyLatestSessionAggregateVersion } from "./sessionAggregateVersionManager.js";
import { TURN_COMMITTED_WIRE_EVENT } from "@noobot/session-protocol/turn-commit";
import { TURN_ATTACHMENTS_BOUND_WIRE_EVENT } from "@noobot/session-protocol/turn-attachment-bind";
import { isTerminalTurnEvent } from "@noobot/session-protocol/turn-lifecycle";

const TURN_USER_MESSAGE_LOG_PREFIX = Object.freeze({
  [TURN_COMMITTED_WIRE_EVENT]: "frontend.turnCommit",
  [TURN_ATTACHMENTS_BOUND_WIRE_EVENT]: "frontend.turnAttachmentsBound",
});

function rejectedByException(error) {
  return { applied: false, reason: "reducer_exception", errors: [error.message] };
}

export function routeForeignTurnLifecycleEvent(event, data, context) {
  const { applyTurnLifecycleEnvelope, logSessionEvent, sessionId } = context;
  if (event === StreamEventEnum.TURN_LIFECYCLE) {
    const eventSessionId = data.sessionId;
    const mainSessionId = sessionId;
    const parentSessionId = data.parentSessionId;
    const isChildLifecycle = Boolean(
      eventSessionId &&
      mainSessionId &&
      eventSessionId !== mainSessionId &&
      parentSessionId &&
      parentSessionId === mainSessionId,
    );
    logSessionEvent({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.authoritativeState.lifecycleRouteEvaluated",
      sessionId: mainSessionId,
      dialogProcessId: data.dialogProcessId,
      turnScopeId: data.turnScopeId,
      data: {
        route: isChildLifecycle ? "child" : "main",
        eventSessionId,
        mainSessionId,
        parentSessionId,
        eventType: data.eventType,
        revision: data.revision,
        sequence: data.sequence,
      },
    });
    if (isChildLifecycle) {
      const terminalLifecycle = isTerminalTurnEvent(data.eventType);
      const logReduction = (reduction) => {
        const rejected = reduction.applied !== true;
        return logSessionEvent({
          category: terminalLifecycle || rejected ? "state" : "debug",
          level: rejected ? "warn" : terminalLifecycle ? "info" : "debug",
          ...(terminalLifecycle || rejected ? {} : { debugType: "workflow-diagnostics" }),
          event: terminalLifecycle
            ? "frontend.authoritativeState.foreignTerminalReduced"
            : rejected
              ? "frontend.authoritativeState.foreignTurnRejected"
              : "frontend.authoritativeState.foreignTurnReduced",
          sessionId: mainSessionId,
          dialogProcessId: data.dialogProcessId,
          turnScopeId: data.turnScopeId,
          data: {
            childSessionId: eventSessionId,
            parentSessionId: data.parentSessionId,
            eventId: data.eventId,
            eventType: data.eventType,
            revision: data.revision,
            sequence: data.sequence,
            applied: !rejected,
            reason: reduction.reason,
            errors: reduction.errors,
            terminalResolutionScheduled: terminalLifecycle,
          },
        });
      };
      void applyTurnLifecycleEnvelope(data).then(logReduction, (error) =>
        logReduction(rejectedByException(error)),
      );
      return true;
    }
  }
  return false;
}

export function routeCurrentTurnLifecycleEvent(event, data, context) {
  const { applyTurnLifecycleEnvelope, logSessionEvent } = context;
  if (event === StreamEventEnum.TURN_LIFECYCLE) {
    const terminalLifecycle = isTerminalTurnEvent(data.eventType);
    const logReduction = (reduction) => {
      const rejected = reduction.applied !== true;
      logSessionEvent({
        category: terminalLifecycle || rejected ? "state" : "debug",
        level: rejected ? "warn" : terminalLifecycle ? "info" : "debug",
        ...(terminalLifecycle || rejected ? {} : { debugType: "workflow-diagnostics" }),
        event: terminalLifecycle
          ? "frontend.authoritativeState.mainTerminalReduced"
          : rejected
            ? "frontend.authoritativeState.mainTurnRejected"
            : "frontend.authoritativeState.mainTurnReduced",
        sessionId: data.sessionId,
        dialogProcessId: data.dialogProcessId,
        turnScopeId: data.turnScopeId,
        data: {
          eventId: data.eventId,
          eventType: data.eventType,
          revision: data.revision,
          sequence: data.sequence,
          applied: !rejected,
          reason: reduction.reason,
          errors: reduction.errors,
          projectedState: reduction.turn?.state,
          projectedTerminal: reduction.turn?.terminal,
        },
      });
    };
    void applyTurnLifecycleEnvelope(data).then(logReduction, (error) =>
      logReduction(rejectedByException(error)),
    );
    return true;
  }
  const logPrefix = TURN_USER_MESSAGE_LOG_PREFIX[event];
  if (!logPrefix) return false;
  const { userMessage } = data;
  const reason = applyCommittedUserMessage(data, context);
  const applied = reason === "applied";
  logSessionEvent({
    category: applied ? "message" : "state",
    level: applied ? "info" : "warn",
    event: applied ? `${logPrefix}.userMessageApplied` : `${logPrefix}.userMessageRejected`,
    sessionId: data.sessionId,
    dialogProcessId: data.dialogProcessId,
    turnScopeId: data.turnScopeId,
    data: {
      applied,
      reason,
      messageUid: userMessage.messageUid,
      userMessageId: userMessage.userMessageId,
      aggregateVersion: data.aggregateVersion,
    },
  });
  return true;
}

function applyCommittedUserMessage(data, context) {
  const { findSession, findUserMessageForCommit, makeViewMessage, sessionId } = context;
  if (data.sessionId !== sessionId) return "committed_session_mismatch";
  const session = findSession(sessionId);
  if (!session) return "committed_session_missing";
  applyLatestSessionAggregateVersion(session, { aggregateVersion: data.aggregateVersion });
  const targetMessage = findUserMessageForCommit(sessionId, data.userMessage);
  if (!targetMessage) return "committed_user_target_missing";
  const projectedMessage = makeViewMessage(data.userMessage, { sessionId });
  Object.assign(targetMessage, projectedMessage);
  targetMessage.attachments = projectedMessage.attachments.map((attachment) => ({
    ...attachment,
  }));
  return "applied";
}
