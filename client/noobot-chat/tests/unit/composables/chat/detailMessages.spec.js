import { describe, expect, it } from "vitest";
import { mergePreservedDetailMessages } from "../../../../src/composables/chat/chatList/detailMessages";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("detailMessages", () => {
  it("preserves running thinking timing fields while merging refreshed detail", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const existingMessages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-time",
        content: "partial",
        pending: true,
        channelState: { state: "sending", createdAt: startedAt, createdAtMs: Date.parse(startedAt) },
        thinkingStartedAt: startedAt,
        thinking_started_at: startedAt,
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-time", content: "partial from detail", pending: false },
    ]);

    const assistant = existingMessages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending", createdAt: startedAt });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
    expect(assistant.thinking_started_at).toBe(startedAt);
  });
});
