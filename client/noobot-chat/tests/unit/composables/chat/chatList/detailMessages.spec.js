import { describe, expect, it } from "vitest";

import { buildNormalizedDetailMessages } from "../../../../../src/composables/chat/chatList/detailMessages.js";

describe("buildNormalizedDetailMessages turnTimings", () => {
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

  it("projects a main-turn status identity through the parent dialog chain", () => {
    const messages = buildNormalizedDetailMessages({
      detailMessages: [{
        role: "assistant",
        content: "done",
        turnScopeId: "internal-turn:child",
        dialogProcessId: "child-dialog",
        parentDialogProcessId: "main-dialog",
      }],
      sessionDocs: [],
      turnStatuses: [{
        turnScopeId: "client-turn:main",
        dialogProcessId: "main-dialog",
        status: "completed",
      }],
      isSummaryDetail: true,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (source) => source.map((message) => ({ ...message })),
    });
    expect(messages[0].statusTurnScopeId).toBe("client-turn:main");
    expect(messages[0].persistedStatusStepState).toBe("completed");
    expect(messages[0].turnScopeId).toBe("internal-turn:child");
  });

});
