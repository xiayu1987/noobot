import { describe, expect, it } from "vitest";
import {
  applySummaryToolLogs,
  buildChildAttachmentsByParentDialogProcessId,
  mergeChildTurnAttachmentsIntoRootMessages,
  mergePreservedDetailMessages,
} from "../../../../src/composables/chat/chatList/detailMessages";
import { buildViewMessage } from "../../../../src/composables/infra/messageModel";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("detailMessages", () => {
  it("does not overwrite the user message with assistant detail from the same turn scope", () => {
    const existingMessages = [
      { role: RoleEnum.USER, content: "question", turnScopeId: "client-turn:1" },
      { role: RoleEnum.ASSISTANT, content: "streaming", turnScopeId: "client-turn:1", pending: true },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.USER,
        content: "question",
        turnScopeId: "client-turn:1",
        dialogProcessId: "dp-1",
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "final answer",
        turnScopeId: "client-turn:1",
        dialogProcessId: "dp-1",
        pending: false,
      },
    ]);

    expect(existingMessages).toHaveLength(2);
    expect(existingMessages[0]).toMatchObject({
      role: RoleEnum.USER,
      content: "question",
      turnScopeId: "client-turn:1",
    });
    expect(existingMessages[1]).toMatchObject({
      role: RoleEnum.ASSISTANT,
      content: "final answer",
      turnScopeId: "client-turn:1",
      dialogProcessId: "dp-1",
      pending: false,
    });
  });

  it("preserves running thinking timing fields while merging refreshed detail", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const existingMessages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        turnScopeId: "client-turn:time",
        dialogProcessId: "dp-time",
        content: "partial",
        pending: true,
        channelState: { state: "sending", createdAt: startedAt, createdAtMs: Date.parse(startedAt) },
        thinkingStartedAt: startedAt,
        thinking_started_at: startedAt,
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.ASSISTANT,
        turnScopeId: "client-turn:time",
        dialogProcessId: "dp-time",
        content: "partial from detail",
        pending: false,
      },
    ]);

    const assistant = existingMessages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending", createdAt: startedAt });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
    expect(assistant.thinking_started_at).toBeUndefined();
  });

  it("does not merge stale stopped detail into a newer resend turn by dialogProcessId or content", () => {
    const existingMessages = [
      { role: RoleEnum.USER, content: "repeat", turnScopeId: "client-turn:new" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId: "client-turn:new",
        dialogProcessId: "",
        pending: true,
        channelState: { state: "sending", turnScopeId: "client-turn:new" },
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.USER,
        content: "repeat",
        turnScopeId: "client-turn:old",
        dialogProcessId: "dp-reused",
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId: "client-turn:old",
        dialogProcessId: "dp-reused",
        pending: false,
        channelState: { state: "stopped", turnScopeId: "client-turn:old" },
        statusLabel: "chat.stopped",
      },
    ]);

    expect(existingMessages).toHaveLength(2);
    expect(existingMessages[1]).toMatchObject({
      role: RoleEnum.ASSISTANT,
      turnScopeId: "client-turn:new",
      pending: true,
      channelState: { state: "sending", turnScopeId: "client-turn:new" },
    });
    expect(existingMessages[1].statusLabel).toBeUndefined();
  });

  it("does not apply summary tool logs to assistant messages before turnScopeId is persisted", () => {
    const sessionItem = {
      messages: [
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "dp-reused",
          content: "current answer without persisted turn scope",
        },
      ],
    };

    applySummaryToolLogs(sessionItem, [
      {
        toolLogSummaries: [
          {
            dialogProcessId: "dp-reused",
            turnScopeId: "client-turn:previous",
            event: "tool_call",
            text: "previous tool",
          },
        ],
      },
    ]);

    expect(sessionItem.messages[0].completedToolLogs).toEqual([]);
  });

  it("applies summary tool logs by turnScopeId when assistant turnScopeId is available", () => {
    const sessionItem = {
      messages: [
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "dp-current",
          turnScopeId: "client-turn:current",
          content: "current answer",
        },
      ],
    };

    applySummaryToolLogs(sessionItem, [
      {
        toolLogSummaries: [
          {
            dialogProcessId: "dp-previous",
            turnScopeId: "client-turn:previous",
            event: "tool_call",
            text: "previous tool",
          },
          {
            dialogProcessId: "dp-current",
            turnScopeId: "client-turn:current",
            event: "tool_call",
            text: "current tool",
          },
        ],
      },
    ]);

    expect(sessionItem.messages[0].completedToolLogs).toHaveLength(1);
    expect(sessionItem.messages[0].completedToolLogs[0].text).toBe("current tool");
  });

  it("collects child attachments from transfer envelopes for refreshed detail", () => {
    const metasByParent = buildChildAttachmentsByParentDialogProcessId({
      rootSessionId: "root-session",
      rootMessages: [
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "root-dp",
          turnScopeId: "client-turn:root",
        },
      ],
      sessionDocs: [
        {
          sessionId: "root-session",
          messages: [
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "root-dp",
              turnScopeId: "client-turn:root",
            },
          ],
        },
        {
          sessionId: "child-session",
          messages: [
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "child-dp",
              parentDialogProcessId: "root-dp",
              transferEnvelopes: [
                {
                  protocol: "noobot.semantic-transfer",
                  version: 1,
                  files: [
                    {
                      filePath: "/workspace/result.md",
                      attachmentMeta: {
                        attachmentId: "child-transfer-1",
                        name: "result.md",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      makeViewMessage: buildViewMessage,
    });

    expect(metasByParent.get("root-dp")).toHaveLength(1);
    expect(metasByParent.get("root-dp")?.[0]).toMatchObject({
      attachmentId: "child-transfer-1",
      name: "result.md",
    });
  });

  it("keeps child transfer envelope attachments on root assistant after refreshed detail merge", () => {
    const rootMessages = [
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "root-dp",
        turnScopeId: "client-turn:root",
        content: "root answer",
      },
    ];

    const mergedMessages = mergeChildTurnAttachmentsIntoRootMessages({
      rootSessionId: "root-session",
      rootMessages,
      sessionDocs: [
        {
          sessionId: "root-session",
          messages: rootMessages,
        },
        {
          sessionId: "child-session",
          messages: [
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "child-dp",
              parentDialogProcessId: "root-dp",
              content: "child generated file",
              transferEnvelopes: [
                {
                  protocol: "noobot.semantic-transfer",
                  version: 1,
                  direction: "output",
                  files: [
                    {
                      filePath: "/workspace/result.md",
                      attachmentMeta: {
                        attachmentId: "child-transfer-1",
                        name: "result.md",
                        mimeType: "text/markdown",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      makeViewMessage: buildViewMessage,
    });

    expect(mergedMessages[0].attachments).toHaveLength(1);
    expect(mergedMessages[0].attachments[0]).toMatchObject({
      attachmentId: "child-transfer-1",
      name: "result.md",
      mimeType: "text/markdown",
    });
  });
});
