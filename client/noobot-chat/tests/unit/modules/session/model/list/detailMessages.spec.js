/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildNormalizedDetailMessages } from "../../../../../../src/modules/session/model/list/detailMessages.js";

describe("buildNormalizedDetailMessages turnTimings", () => {
  it("binds projected messages to their session envelope identity", () => {
    const messages = buildNormalizedDetailMessages({
      detailMessages: [{ role: "assistant", turnScopeId: "turn-session" }],
      rootSessionId: "session-envelope",
      isSummaryDetail: true,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (source) => source.map((message) => ({ ...message })),
    });

    expect(messages[0]).toMatchObject({
      sessionId: "session-envelope",
      session_id: "session-envelope",
      turnScopeId: "turn-session",
    });
  });

  it("keeps terminal presentation entities out of the canonical detail message list", () => {
    const messages = buildNormalizedDetailMessages({
      detailMessages: [
        { role: "user", content: "stop", turnScopeId: "turn-stop", dialogProcessId: "dp-stop" },
        { role: "assistant", content: "", turnScopeId: "turn-stop", dialogProcessId: "dp-stop" },
      ],
      rootSessionId: "session-stop",
      isSummaryDetail: true,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (source) => source.map((message) => ({ ...message })),
    });

    expect(messages).toHaveLength(2);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messages.some((message) => message.turnStatusPlaceholder === true)).toBe(false);
  });

  it("does not copy authoritative turnTimings into disposable view messages", () => {
    const messages = buildNormalizedDetailMessages({
      detailMessages: [
        {
          role: "user",
          content: "hi",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
        },
        {
          role: "assistant",
          content: "done",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          thinkingStartedAt: "2026-01-01T00:00:00.000Z",
          thinkingFinishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      turnTimings: [
        {
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          thinkingStartedAt: "2026-07-08T15:45:58.275Z",
          thinkingFinishedAt: "2026-07-08T15:47:11.710Z",
        },
      ],
      isSummaryDetail: true,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (source) => source.map((message) => ({ ...message })),
    });

    expect(messages[0].thinkingStartedAt).toBeUndefined();
    expect(messages[0].thinkingFinishedAt).toBeUndefined();
    expect(messages[1].thinkingStartedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(messages[1].thinkingFinishedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("keeps historical message timing when turnTimings are absent", () => {
    const messages = buildNormalizedDetailMessages({
      detailMessages: [
        {
          role: "assistant",
          content: "done",
          turnScopeId: "turn-history",
          dialogProcessId: "dp-history",
          thinkingStartedAt: "2026-02-01T00:00:00.000Z",
          thinkingFinishedAt: "2026-02-01T00:00:02.000Z",
        },
      ],
      turnTimings: [],
      isSummaryDetail: true,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (source) => source.map((message) => ({ ...message })),
    });

    expect(messages[0].thinkingStartedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(messages[0].thinkingFinishedAt).toBe("2026-02-01T00:00:02.000Z");
  });
});
