import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper";

describe("useMessageFiles turn backfill", () => {
  it("does not backfill written files while current assistant is pending before streaming starts", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      hasFirstStreamEvent: false,
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      content: JSON.stringify({
        toolName: "write_file",
        state: "OK",
        resolvedPath: "/workspace/admin/previous.md",
        fileName: "previous.md",
      }),
    };
    const { writtenFiles } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousToolMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(writtenFiles.value).toEqual([]);
  });

  it("collects written files for the same turnScopeId after current turn starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      content: JSON.stringify({
        toolName: "write_file",
        state: "OK",
        resolvedPath: "/workspace/admin/previous.md",
        fileName: "previous.md",
      }),
    };
    const currentToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      content: JSON.stringify({
        toolName: "write_file",
        state: "OK",
        resolvedPath: "/workspace/admin/current.md",
        fileName: "current.md",
      }),
    };
    const { writtenFiles } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousToolMessage, currentToolMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(writtenFiles.value.map((item) => item.fileName)).toEqual(["previous.md", "current.md"]);
  });

  it("does not backfill previous assistant attachments while current assistant is pending", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("collects attachments for the same dialogProcessId after current dialog starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "prev-1", owner: { type: "agent" }, name: "previous-result.md" },
    ]);
  });

  it("does not collect previous assistant attachments from a different turn scope", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-previous",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous assistant attachments when explicit turn identity is missing", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not fall back to dialogProcessId when current message has a turn scope", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous turn tool attachments for a later assistant before refresh", () => {
    const firstUser = { role: "user", dialogProcessId: "dp-first", content: "生成一张小鸟图" };
    const firstTool = {
      role: "tool",
      dialogProcessId: "dp-first",
      attachments: [
        { attachmentId: "bird-1", name: "generated_image_1.png" },
      ],
    };
    const firstAssistant = {
      role: "assistant",
      dialogProcessId: "dp-first",
      content: "小鸟图片已生成",
      attachments: [],
    };
    const secondUser = { role: "user", dialogProcessId: "dp-second", content: "你好" };
    const secondAssistant = {
      role: "assistant",
      pending: false,
      hasFirstStreamEvent: true,
      dialogProcessId: "dp-second",
      content: "你好！",
      attachments: [],
    };
    const allMessages = [firstUser, firstTool, firstAssistant, secondUser, secondAssistant];

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => secondAssistant,
      getAllMessages: () => allMessages,
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous session-doc tool attachments while later assistant is streaming but absent from summary", () => {
    const sessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "user",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          content: "生成一张小鸟图",
        },
        {
          role: "tool",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          attachments: [
            {
              attachmentId: "bird-1",
              name: "generated_image_1.png",
              turnScope: { turnScopeId: "turn-first", dialogProcessId: "dp-first" },
            },
          ],
        },
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          content: "小鸟图片已生成",
        },
        {
          role: "user",
          sessionId: "session-1",
          turnScopeId: "turn-second",
          dialogProcessId: "dp-second",
          content: "测试脚本工具调用3次",
        },
      ],
    };
    const secondUser = sessionDoc.messages[3];
    const secondAssistant = {
      role: "assistant",
      pending: true,
      hasFirstStreamEvent: true,
      sessionId: "session-1",
      turnScopeId: "turn-second",
      dialogProcessId: "dp-second",
      attachments: [],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => secondAssistant,
      getAllMessages: () => [sessionDoc.messages[0], sessionDoc.messages[2], secondUser, secondAssistant],
      getSessionDocs: () => [sessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect session-doc attachments from a different session with the same turn scope", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-current",
      turnScopeId: "turn-same",
      dialogProcessId: "dp-current",
      attachments: [],
    };
    const otherSessionDoc = {
      sessionId: "session-other",
      messages: [
        {
          role: "tool",
          turnScopeId: "turn-same",
          dialogProcessId: "dp-other",
          attachments: [
            {
              attachmentId: "other-session-file",
              name: "other.png",
              turnScope: { sessionId: "session-other", turnScopeId: "turn-same" },
            },
          ],
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [otherSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("still collects tool attachments from the same linear turn", () => {
    const firstUser = {
      role: "user",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      content: "生成一张小鸟图",
    };
    const firstTool = {
      role: "tool",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      attachments: [
        { attachmentId: "bird-1", name: "generated_image_1.png" },
      ],
    };
    const firstAssistant = {
      role: "assistant",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      content: "小鸟图片已生成",
      attachments: [],
    };
    const secondUser = {
      role: "user",
      dialogProcessId: "dp-second",
      sessionId: "session-1",
      turnScopeId: "turn-second",
      content: "你好",
    };
    const secondAssistant = {
      role: "assistant",
      dialogProcessId: "dp-second",
      sessionId: "session-1",
      turnScopeId: "turn-second",
      content: "你好！",
    };
    const allMessages = [firstUser, firstTool, firstAssistant, secondUser, secondAssistant];

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => firstAssistant,
      getAllMessages: () => allMessages,
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "bird-1", owner: { type: "agent" }, name: "generated_image_1.png" },
    ]);
  });

  it("prefers explicit attachment turnScopeId ownership over dialogProcessId fallback", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-reused",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousTool = {
      role: "tool",
      dialogProcessId: "dp-reused",
      turnScopeId: "turn-previous",
      attachments: [
        {
          attachmentId: "prev-explicit",
          name: "previous.png",
          turnScope: { turnScopeId: "turn-previous", dialogProcessId: "dp-reused" },
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousTool, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("collects explicitly owned tool attachments for the current turn scope", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const currentTool = {
      role: "tool",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      attachments: [
        {
          attachmentId: "current-explicit",
          name: "current.png",
          turnScope: { turnScopeId: "turn-current", dialogProcessId: "dp-current" },
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [currentTool, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      {
        attachmentId: "current-explicit",
        owner: { type: "agent" },
        name: "current.png",
        turnScope: { turnScopeId: "turn-current", dialogProcessId: "dp-current" },
      },
    ]);
  });
});
