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

    expect(activeSession.value.rawMessages).toEqual([]);
    expect(botMessage.legacyDialogIdentity).toBeUndefined();
    expect(botMessage.content).toBe("current assistant");
  });

  it("does not append workflow finalized messages from DONE into display messages", () => {
    const botMessage = {
      role: "assistant",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      content: "",
      attachments: [],
      pending: true,
    };
    const activeSession = {
      value: {
        rawMessages: [],
        messages: [
          { role: "user", content: "current", dialogProcessId: "dp-current", turnScopeId: "turn-current" },
          botMessage,
        ],
      },
    };
    const dataMessages = [
      { role: "user", content: "current", dialogProcessId: "dp-current", turnScopeId: "turn-current" },
      {
        role: "assistant",
        content: "workflow finalized",
        dialogProcessId: "dp-current",
        turnScopeId: "turn-current",
        workflowMessage: true,
        workflowMeta: { source: "workflow-plugin" },
      },
      {
        role: "assistant",
        content: "normal finalized",
        dialogProcessId: "dp-current",
        turnScopeId: "turn-current",
      },
    ];

    applyDoneMessagesPatch({
      data: { messages: dataMessages, dialogProcessId: "dp-current" },
      botMessage,
      activeSession,
      makeViewMessage: (messageItem) => ({ ...messageItem }),
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachments: () => {},
    });

    expect(activeSession.value.rawMessages).toEqual([]);
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((messageItem) => messageItem.workflowMessage === true)).toBe(false);
    expect(botMessage.content).toBe("normal finalized");
  });
});
