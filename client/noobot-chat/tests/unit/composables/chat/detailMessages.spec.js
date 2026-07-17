/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applySummaryToolLogs,
  buildNormalizedDetailMessages,
  buildChildAttachmentsByParentDialogProcessId,
  mergeChildTurnAttachmentsIntoRootMessages,
  mergePreservedDetailMessages,
} from "../../../../src/composables/chat/chatList/detailMessages";
import {
  buildViewMessage,
  foldConversationMessages,
} from "../../../../src/composables/infra/messageModel";
import {
  FrontendRunState,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  resolveSessionRunMessageRuntimePatch,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("detailMessages", () => {
  it("builds one normalized detail message list for replace and preserve inputs", () => {
    const detailMessages = [
      { role: RoleEnum.USER, content: "q", turnScopeId: "turn-1", sessionId: "root-session" },
      {
        role: RoleEnum.ASSISTANT,
        content: "final",
        turnScopeId: "turn-1",
        dialogProcessId: "root-dp",
        sessionId: "root-session",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            files: [
              {
                filePath: "/workspace/root.md",
                attachmentMeta: { attachmentId: "root-attachment", name: "root.md" },
              },
            ],
          },
        ],
      },
    ];
    const sessionDocs = [
      { sessionId: "root-session", messages: detailMessages },
      {
        sessionId: "child-session",
        messages: [
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "child-dp",
            parentDialogProcessId: "root-dp",
            turnScopeId: "turn-child",
            transferEnvelopes: [
              {
                protocol: "noobot.semantic-transfer",
                files: [
                  {
                    filePath: "/workspace/child.md",
                    attachmentMeta: { attachmentId: "child-attachment", name: "child.md" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const normalizedForReplace = buildNormalizedDetailMessages({
      detailMessages,
      sessionDocs,
      rootSessionId: "root-session",
      makeViewMessage: buildViewMessage,
      foldMessagesForView: (messages) => messages.map((messageItem) => buildViewMessage(messageItem)),
    });
    const normalizedForPreserve = buildNormalizedDetailMessages({
      detailMessages,
      sessionDocs,
      rootSessionId: "root-session",
      makeViewMessage: buildViewMessage,
      foldMessagesForView: (messages) => messages.map((messageItem) => buildViewMessage(messageItem)),
    });

    expect(
      normalizedForPreserve.map((messageItem) => ({
        role: messageItem.role,
        content: messageItem.content,
        turnScopeId: messageItem.turnScopeId,
        dialogProcessId: messageItem.dialogProcessId,
        attachments: (messageItem.attachments || []).map((item) => item.attachmentId).sort(),
      })),
    ).toEqual(
      normalizedForReplace.map((messageItem) => ({
        role: messageItem.role,
        content: messageItem.content,
        turnScopeId: messageItem.turnScopeId,
        dialogProcessId: messageItem.dialogProcessId,
        attachments: (messageItem.attachments || []).map((item) => item.attachmentId).sort(),
      })),
    );
    expect(normalizedForReplace[1].attachments.map((item) => item.attachmentId).sort()).toEqual([
      "child-attachment",
      "root-attachment",
    ]);
  });

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

  it("merges same-turn finalized assistant into pending overlay without duplicating it", () => {
    const existingMessages = [
      { role: RoleEnum.USER, content: "q", turnScopeId: "turn-merge" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial",
        turnScopeId: "turn-merge",
        dialogProcessId: "dp-merge",
        pending: true,
        attachments: [],
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.ASSISTANT,
        content: "final",
        turnScopeId: "turn-merge",
        dialogProcessId: "dp-merge",
        pending: false,
        attachments: [{ attachmentId: "final-file", name: "final.md" }],
      },
    ]);

    expect(existingMessages).toHaveLength(2);
    expect(existingMessages[1]).toMatchObject({
      role: RoleEnum.ASSISTANT,
      content: "final",
      pending: false,
      attachments: [{ attachmentId: "final-file", name: "final.md" }],
    });
  });

  it("preserves frontend completion runtime mark while merging finalized detail attachments", () => {
    const runtimeKey = "frontend_completion_requesting|session-runtime|dp-runtime|turn-runtime|100";
    const existingMessages = [
      { role: RoleEnum.USER, content: "q", turnScopeId: "turn-runtime" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial",
        turnScopeId: "turn-runtime",
        dialogProcessId: "dp-runtime",
        pending: true,
        channelState: {
          state: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
          sessionId: "session-runtime",
          dialogProcessId: "dp-runtime",
          turnScopeId: "turn-runtime",
        },
        [SESSION_RUN_MESSAGE_RUNTIME_MARK]: runtimeKey,
        runtimeMark: runtimeKey,
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.ASSISTANT,
        content: "final",
        turnScopeId: "turn-runtime",
        dialogProcessId: "dp-runtime",
        pending: false,
        attachments: [{ attachmentId: "final-file", name: "final.md" }],
        completedToolLogs: [
          { id: "tool-1", attachments: [{ attachmentId: "tool-file", name: "tool.log" }] },
        ],
      },
    ]);

    const assistant = existingMessages[1];
    expect(assistant).toMatchObject({
      role: RoleEnum.ASSISTANT,
      content: "final",
      attachments: [{ attachmentId: "final-file", name: "final.md" }],
      completedToolLogs: [
        { id: "tool-1", attachments: [{ attachmentId: "tool-file", name: "tool.log" }] },
      ],
    });
    expect(assistant[SESSION_RUN_MESSAGE_RUNTIME_MARK]).toBe(runtimeKey);
    expect(assistant.runtimeMark).toBe(runtimeKey);

    const effect = resolveSessionRunMessageRuntimePatch({
      stateSnapshot: {
        state: FrontendRunState.FRONTEND_COMPLETED,
        sessionId: "session-runtime",
        dialogProcessId: "dp-runtime",
        turnScopeId: "turn-runtime",
      },
      messageItem: assistant,
      activeSession: { id: "session-runtime", messages: existingMessages },
    });
    expect(effect.action).toBe(SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE);
    expect(effect.patch).toMatchObject({
      clearRuntimeMark: true,
      pending: false,
      channelState: { state: FrontendRunState.FRONTEND_COMPLETED },
      statusLabelKey: "chat.generated",
    });
  });

  it("appends only safe finalized detail assistants missing from the pending overlay", () => {
    const existingMessages = [
      { role: RoleEnum.USER, content: "q", turnScopeId: "turn-current" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial current",
        turnScopeId: "turn-current",
        dialogProcessId: "dp-current",
        pending: true,
      },
    ];

    mergePreservedDetailMessages(existingMessages, [
      {
        role: RoleEnum.ASSISTANT,
        content: "old stopped",
        turnScopeId: "turn-old",
        dialogProcessId: "dp-old",
        channelState: { state: "user_stopped" },
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "no identity",
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "safe finalized",
        turnScopeId: "turn-safe",
        dialogProcessId: "dp-safe",
        attachments: [{ attachmentId: "safe-file", name: "safe.md" }],
      },
    ]);

    expect(existingMessages.map((messageItem) => messageItem.content)).toEqual([
      "q",
      "partial current",
      "safe finalized",
    ]);
    expect(existingMessages[2].attachments).toEqual([{ attachmentId: "safe-file", name: "safe.md" }]);
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
        thinkingStartedAt: startedAt,
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
        channelState: { state: "user_stopped", turnScopeId: "client-turn:old" },
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

  it("normalizes plugin and node transfer envelope attachments before UI reads messages", () => {
    const normalizedMessages = buildNormalizedDetailMessages({
      detailMessages: [
        {
          role: RoleEnum.ASSISTANT,
          content: "workflow generated files",
          dialogProcessId: "root-dp",
          turnScopeId: "client-turn:root",
          sessionId: "root-session",
          pluginMeta: {
            payload: {
              transferEnvelopes: [
                {
                  protocol: "noobot.semantic-transfer",
                  files: [
                    {
                      filePath: "/workspace/plugin.md",
                      attachmentMeta: {
                        attachmentId: "plugin-transfer-1",
                        name: "plugin.md",
                      },
                    },
                  ],
                },
              ],
              nodeResultTransferEnvelopes: [
                {
                  protocol: "noobot.semantic-transfer",
                  files: [
                    {
                      filePath: "/workspace/node-result.md",
                      attachmentMeta: {
                        attachmentId: "node-result-1",
                        name: "node-result.md",
                      },
                    },
                  ],
                },
              ],
              nodeSessions: [
                {
                  transferEnvelopes: [
                    {
                      protocol: "noobot.semantic-transfer",
                      files: [
                        {
                          filePath: "/workspace/node-session.md",
                          attachmentMeta: {
                            attachmentId: "node-session-1",
                            name: "node-session.md",
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          completedToolLogs: [
            {
              attachments: [
                { attachmentId: "completed-tool-1", name: "completed-tool.md" },
              ],
            },
          ],
        },
      ],
      sessionDocs: [],
      rootSessionId: "root-session",
      makeViewMessage: buildViewMessage,
      foldMessagesForView: (messages) => foldConversationMessages(messages, buildViewMessage),
    });

    expect(normalizedMessages).toHaveLength(1);
    expect(normalizedMessages[0].attachments.map((item) => item.attachmentId)).toEqual([
      "plugin-transfer-1",
      "node-result-1",
      "node-session-1",
    ]);
    expect(normalizedMessages[0].completedToolLogs[0].attachments).toEqual([
      { attachmentId: "completed-tool-1", name: "completed-tool.md" },
    ]);
  });
  it("keeps same-turn assistant thinking timing out of reloaded messages", () => {
    const startedAt = "2026-06-22T10:00:05.000Z";
    const finishedAt = "2026-06-22T10:00:12.000Z";
    const normalizedMessages = buildNormalizedDetailMessages({
      detailMessages: [
        {
          role: RoleEnum.ASSISTANT,
          content: "first chunk",
          turnScopeId: "turn-thinking",
          dialogProcessId: "dp-thinking",
          sessionId: "root-session",
          thinkingStartedAt: startedAt,
        },
        {
          role: RoleEnum.ASSISTANT,
          content: "final chunk",
          turnScopeId: "turn-thinking",
          dialogProcessId: "dp-thinking",
          sessionId: "root-session",
          thinkingFinishedAt: finishedAt,
        },
      ],
      sessionDocs: [],
      rootSessionId: "root-session",
      makeViewMessage: buildViewMessage,
      foldMessagesForView: (messages) => foldConversationMessages(messages, buildViewMessage),
    });

    expect(normalizedMessages).toHaveLength(1);
    expect(normalizedMessages[0].thinkingStartedAt).toBeUndefined();
    expect(normalizedMessages[0].thinkingFinishedAt).toBeUndefined();
    expect(normalizedMessages[0].content).toBe("first chunk\n\nfinal chunk");
  });

});
