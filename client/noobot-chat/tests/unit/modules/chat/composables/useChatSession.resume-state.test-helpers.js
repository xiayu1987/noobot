/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { vi } from "vitest";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { jsonResponse } from "../../../helpers/jsonResponse.js";
import { terminalStatusFixture } from "../helpers/terminalStatusFixture.js";

export function detailResponse(options) {
  const payload = detailPayload(options);
  return jsonResponse(payload);
}

export function detailPayload({ sessionId, dialogProcessId, turnScopeId, turnLifecycleSnapshot }) {
  return {
    ok: true,
    exists: true,
    sessionId,
    ...(turnLifecycleSnapshot ? { turnLifecycleSnapshot } : {}),
    sessions: [
      {
        sessionId,
        ...(turnLifecycleSnapshot ? { turnLifecycleSnapshot } : {}),
        turnTimings: [],
        messages: [
          {
            role: RoleEnum.USER,
            messageUid: `user-${turnScopeId}`,
            content: "question",
            turnScopeId,
          },
          {
            role: RoleEnum.ASSISTANT,
            presentationMessageId: `msg-${turnScopeId}`,
            content: "answer",
            dialogProcessId,
            turnScopeId,
          },
        ],
      },
    ],
  };
}

export function terminalLifecycleSnapshot({
  sessionId,
  turnScopeId,
  dialogProcessId,
  state = "stop_completed",
  revision = 4,
  sequence = 4,
}) {
  const completionCommitId = `commit:${sessionId}:${turnScopeId}:${revision}`;
  return {
    protocolVersion: 1,
    eventType: "turn.snapshot",
    recovery: "none",
    commandId: `summary:${sessionId}:${sequence}`,
    sessionId,
    sequence,
    activeTurnScopeId: "",
    activeTurn: null,
    unchanged: false,
    replacedTurns: [],
    recentTerminalTurns: [
      {
        sessionId,
        turnScopeId,
        dialogProcessId,
        presentationMessageId: `msg-${turnScopeId}`,
        state,
        phase: state === "stop_completed" ? "stop" : "completion",
        revision,
        sequence,
        capabilities: { canStop: false },
        completionCommitId,
        summaryVersion: 1,
        finalizeIntent: state === "stop_completed" ? "stop" : "complete",
        failure: null,
      },
    ],
  };
}

export function terminalResolution({
  sessionId,
  turnScopeId,
  state,
  revision = 2,
  sequence = 2,
  startedAt = "",
}) {
  const successful = state === "completed" || state === "stop_completed";
  const completionCommitId = `commit:${sessionId}:${turnScopeId}:${revision}`;
  const summaryVersion = 1;
  return {
    ok: true,
    protocolVersion: 2,
    eventType: "turn.terminal_resolved",
    commandId: `resolve:${sessionId}:${turnScopeId}`,
    sessionId,
    turnScopeId,
    resolved: true,
    retryable: false,
    reason: "",
    retryAfterMs: 0,
    aggregateVersion: 1,
    turn: {
      sessionId,
      turnScopeId,
      dialogProcessId: `dp-${turnScopeId}`,
      state,
      phase: state === "stop_completed" ? "stop" : "completion",
      revision,
      sequence,
      completionCommitId,
      summaryVersion,
      finalizeIntent: state === "stop_completed" ? "stop" : "complete",
      failure: successful ? null : { stage: state.replace("_failed", ""), retryable: false },
      ...(startedAt ? { startedAt } : {}),
      terminalStatus: terminalStatusFixture(state, {
        turnScopeId,
        dialogProcessId: `dp-${turnScopeId}`,
      }),
    },
  };
}

export function routeAwareFetcher({ detail, terminal }) {
  return vi.fn(async (url) => {
    const payload = String(url).includes("/terminal") ? terminal : detail;
    return jsonResponse(payload);
  });
}
