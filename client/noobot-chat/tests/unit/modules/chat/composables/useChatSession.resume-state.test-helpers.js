/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { vi } from "vitest";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { jsonResponse } from "../../../helpers/jsonResponse.js";
import { terminalStatusFixture } from "../helpers/terminalStatusFixture.js";
import { turnRecordFixture } from "../helpers/turnRecordFixture.js";
import { createSessionDetailDocument } from "@noobot/session-protocol/session-detail";
import { withServerNow } from "@noobot/session-protocol/server-clock";
import {
  FIXTURE_SERVER_NOW,
  detailEntryWithLifecycle,
} from "../../../helpers/sessionDetailFixture.js";

export function detailResponse(options) {
  const payload = detailPayload(options);
  return jsonResponse(payload);
}

export function detailPayload({ sessionId, dialogProcessId, turnScopeId, turnLifecycleSnapshot }) {
  return withServerNow(
    {
      ok: true,
      ...createSessionDetailDocument({
        sessionId,
        sessions: [
          detailEntryWithLifecycle({
            sessionId,
            title: sessionId,
            aggregateVersion: 1,
            turnTimings: [],
            turnLifecycleSnapshot,
            messages: [
              {
                role: RoleEnum.USER,
                ts: "2026-01-01T00:00:00.000Z",
                messageUid: `user-${turnScopeId}`,
                content: "question",
                turnScopeId,
              },
              {
                role: RoleEnum.ASSISTANT,
                ts: "2026-01-01T00:00:00.000Z",
                presentationMessageId: `msg-${turnScopeId}`,
                content: "answer",
                dialogProcessId,
                turnScopeId,
              },
            ],
          }),
        ],
      }),
    },
    FIXTURE_SERVER_NOW,
  );
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
      turnRecordFixture({
        sessionId,
        turnScopeId,
        dialogProcessId,
        presentationMessageId: `msg-${turnScopeId}`,
        state,
        phase: state === "stop_completed" ? "stop" : "completion",
        revision,
        sequence,
        capabilities: { actionLocked: false, canStop: false },
        completionCommitId,
        summaryVersion: 1,
        failure: null,
      }),
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
    generatedAt: "2026-11-01T00:00:00.000Z",
    commandId: `resolve:${sessionId}:${turnScopeId}`,
    sessionId,
    turnScopeId,
    resolved: true,
    retryable: false,
    reason: "",
    retryAfterMs: 0,
    aggregateVersion: 1,
    turn: turnRecordFixture({
      sessionId,
      turnScopeId,
      dialogProcessId: `dp-${turnScopeId}`,
      state,
      phase: state === "stop_completed" ? "stop" : "completion",
      revision,
      sequence,
      completionCommitId,
      summaryVersion,
      failure: successful
        ? null
        : { code: "fixture_failure", message: "terminal failure", retryable: false },
      ...(startedAt ? { startedAt } : {}),
      terminalStatus: terminalStatusFixture(state, {
        turnScopeId,
        dialogProcessId: `dp-${turnScopeId}`,
      }),
    }),
  };
}

export function routeAwareFetcher({ detail, terminal }) {
  return vi.fn(async (url) => {
    const payload = String(url).includes("/terminal") ? terminal : detail;
    return jsonResponse(payload);
  });
}
