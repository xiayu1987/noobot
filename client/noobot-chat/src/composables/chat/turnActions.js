/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const USER_STOPPED = "user_stopped";

import { findVisibleLastMessage } from "../infra/messageModel";
import { getMessageTurnScopeId } from "../infra/messageIdentity";
import { findMessageTurnStatus } from "./chatEngine/messageStateGuards";
import { resolveTurnRuntimeView } from "./sessionRunStateMachine/messageRuntime";
import { FrontendRunState } from "./sessionRunStateMachine/constants";

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

/**
 * Returns the last persisted turn fact. turnStatuses is chronological and is
 * the only source of truth for completed/stopped/error turn results.
 */
export function resolveLastTurnStatus(turnStatuses = []) {
  const statuses = Array.isArray(turnStatuses) ? turnStatuses : [];
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    const item = statuses[index];
    const status = normalize(item?.status);
    if (!status) continue;
    return { ...item, status };
  }
  return null;
}

export function deriveLastTurnActions(messages = [], turnStatuses = [], turnTimingsByTurnScopeId = {}) {
  const lastMessage = findVisibleLastMessage(messages);
  const matchedTurn = lastMessage
    ? findMessageTurnStatus(lastMessage, turnStatuses)
    : null;
  const lastTurn = matchedTurn?.status
    ? { ...matchedTurn, status: normalize(matchedTurn.status) }
    : null;
  const userStopped = lastTurn?.status === USER_STOPPED;
  const turnScopeId = lastMessage ? getMessageTurnScopeId(lastMessage) : "";
  const runtime = lastMessage
    ? resolveTurnRuntimeView({
        messageItem: lastMessage,
        turnStatus: lastTurn,
        turnTiming: turnTimingsByTurnScopeId?.[turnScopeId] || null,
      })
    : {};
  const runtimeState = normalize(runtime.state);
  const requesting = runtimeState === FrontendRunState.ACTION_REQUESTING ||
    runtimeState === FrontendRunState.CONTINUE_REQUESTING;
  const completing = runtimeState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  const stopping = runtimeState === FrontendRunState.USER_STOPPING;
  const processing = Boolean(runtime.inFlightAssistant && !requesting && !completing && !stopping);
  const displayState = requesting
    ? "requesting"
    : completing
      ? "completing"
      : stopping
        ? "stopping"
        : processing
          ? "sending"
          : userStopped
            ? "continue"
            : "send";
  return {
    lastMessage,
    lastTurn,
    userStopped,
    action: userStopped ? "continue" : "send",
    canContinue: userStopped,
    canResend: userStopped,
    canSend: !userStopped,
    runtime,
    displayState,
    canStop: displayState === "sending" && Boolean(runtime.canStopTarget),
  };
}
