import { describe, expect, it } from "vitest";
import { applyDoneMessagesPatch } from "../../../../src/composables/chat/chatEngine/messagePatch";

describe("messagePatch", () => {
  it("applies done raw messages without adding legacy dialog identity", () => {
    const botMessage = {
      role: "assistant",
      dialogProcessId: "dp-current",
      content: "",
      attachments: [],
    };
    const activeSession = {
      value: {
        rawMessages: [],
        messages: [botMessage],
      },
    };
    const dataMessages = [
      { role: "user", content: "previous", dialogProcessId: "dp-prev" },
      { role: "assistant", content: "previous answer", dialogProcessId: "dp-prev" },
      { role: "user", content: "current", dialogProcessId: "dp-current" },
      { role: "assistant", content: "tool call", type: "tool_call", dialogProcessId: "dp-current" },
      { role: "tool", content: "tool result", dialogProcessId: "dp-current" },
      { role: "assistant", content: "current assistant", dialogProcessId: "dp-current" },
    ];

    applyDoneMessagesPatch({
      data: { messages: dataMessages, dialogProcessId: "dp-current" },
      botMessage,
      activeSession,
      makeViewMessage: (messageItem) => ({ ...messageItem }),
      foldMessagesForView: (messages) =>
        messages.filter((messageItem) => ["user", "assistant"].includes(messageItem.role)),
      mergeAssistantAttachments: () => {},
    });

    expect(activeSession.value.rawMessages.map((messageItem) => messageItem.legacyDialogIdentity)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(botMessage.legacyDialogIdentity).toBeUndefined();
    expect(botMessage.content).toBe("current assistant");
  });
});
