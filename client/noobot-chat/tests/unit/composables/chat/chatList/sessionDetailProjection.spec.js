/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildSessionDetailProjection } from "../../../../../src/composables/chat/chatList/sessionDetailProjection.js";

const identity = (item) => ({ ...item });

describe("buildSessionDetailProjection", () => {
  it("projects messages, status placeholders and timings through one entrypoint", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{ role: "user", content: "hello", turnScopeId: "turn-1", dialogProcessId: "dialog-1" }],
        turnStatuses: [{ turnScopeId: "turn-1", dialogProcessId: "dialog-1", status: "thinking" }],
        turnTimings: [{ turnScopeId: "turn-1", thinkingStartedAt: "2026-01-01T00:00:00.000Z" }],
      },
      sessionDocs: [{ sessionId: "session-1" }],
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
    });

    expect(projection.sessionId).toBe("session-1");
    expect(projection.turnStatuses[0].status).toBe("thinking");
    expect(projection.turnTimingsByTurnScopeId["turn-1"].thinkingStartedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(projection.messages.some((item) => item.role === "user")).toBe(true);
    expect(projection.messages.some((item) => item.placeholder === true || item.statusTurnScopeId === "turn-1")).toBe(true);
  });

  it("preserves a running timing when a sparse projection has no timing facts", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{ role: "assistant", content: "streaming", turnScopeId: "turn-1" }],
      },
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
      currentTimingsByTurnScopeId: {
        "turn-1": { thinkingStartedAt: "start", thinkingFinishedAt: null },
      },
    });

    expect(projection.turnTimingsByTurnScopeId["turn-1"]).toEqual({
      thinkingStartedAt: "start",
      thinkingFinishedAt: null,
    });
  });

  it("indexes workflow node timings by normalized turn scope key", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{
          role: "assistant",
          content: "child agent done",
          turnScopeId: "workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1",
          dialogProcessId: "dialog-child-1",
        }],
        turnTimings: [{
          turnScopeId: "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1",
          dialogProcessId: "dialog-child-1",
          thinkingStartedAt: "2026-07-21T08:29:00.000Z",
          thinkingFinishedAt: "2026-07-21T08:30:00.000Z",
        }],
      },
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
    });

    expect(projection.turnTimingsByTurnScopeId["workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1"])
      .toEqual({
        thinkingStartedAt: "2026-07-21T08:29:00.000Z",
        thinkingFinishedAt: "2026-07-21T08:30:00.000Z",
      });
    expect(projection.turnTimingsByTurnScopeId["workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1"])
      .toBeUndefined();
  });
});
