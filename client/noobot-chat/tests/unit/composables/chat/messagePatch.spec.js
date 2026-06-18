import { describe, expect, it } from "vitest";
import { applyDoneMessagesPatch } from "../../../../src/composables/chat/chatEngine/messagePatch";

describe("messagePatch", () => {
  it("stamps current-turn raw messages with client messageRoundId without touching previous turns", () => {
    const botMessage = {
      role: "assistant",
      messageRoundId: "round-current",
      dialogProcessId: "dp-current",
      content: "",
      attachmentMetas: [],
    };
    const activeSession = {
      value: {
        rawMessages: [],
        messages: [botMessage],
      },
    };
    const dataMessages = [
      { role: "user", content: "previous user" },
      { role: "assistant", dialogProcessId: "dp-prev", content: "previous assistant" },
      { role: "user", content: "current user" },
      {
        role: "user",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dp-current",
        content: "current injected context",
      },
      {
        role: "tool",
        dialogProcessId: "dp-current",
        content: JSON.stringify({ toolName: "write_file", state: "OK" }),
      },
      { role: "assistant", dialogProcessId: "dp-current", content: "current assistant" },
    ];

    applyDoneMessagesPatch({
      data: { dialogProcessId: "dp-current", messages: dataMessages },
      botMessage,
      activeSession,
      makeViewMessage: (messageItem) => ({ ...messageItem }),
      foldMessagesForView: (messages) =>
        messages.filter((messageItem) => ["user", "assistant"].includes(messageItem.role)),
      mergeAssistantAttachmentMetas: () => {},
    });

    expect(activeSession.value.rawMessages[0].messageRoundId || "").toBe("");
    expect(activeSession.value.rawMessages[1].messageRoundId || "").toBe("");
    expect(activeSession.value.rawMessages.slice(2).map((messageItem) => messageItem.messageRoundId)).toEqual([
      "round-current",
      "round-current",
      "round-current",
      "round-current",
    ]);
    expect(botMessage.messageRoundId).toBe("round-current");
    expect(botMessage.content).toBe("current assistant");
  });
});
