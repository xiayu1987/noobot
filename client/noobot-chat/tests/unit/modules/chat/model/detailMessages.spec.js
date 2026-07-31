/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildNormalizedDetailMessages,
  buildChildAttachmentsByParentDialogProcessId,
  mergeChildTurnAttachmentsIntoRootMessages,
} from "../../../../../src/modules/session/model/list/detailMessages.js";
import {
  buildViewMessage,
  foldConversationMessages,
} from "../../../../../src/modules/chat/model/messageModel.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

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
          toolTimeline: [{
            key: "call:completed-tool", toolCallId: "completed-tool", status: "completed",
            resultEvent: {
              eventId: "completed-tool-result", sequence: 1, sequenceScopeId: "message-1",
              sequenceDomain: "message-event", authority: "authoritative",
              log: { event: "tool_result", type: "tool_result", attachments: [
                { attachmentId: "completed-tool-1", name: "completed-tool.md" },
              ] },
            },
          }],
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
    expect(selectToolTimelineLogs(normalizedMessages[0])[0].attachments).toEqual([
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

    expect(normalizedMessages).toHaveLength(2);
    expect(normalizedMessages.map((message) => message.content)).toEqual(["first chunk", "final chunk"]);
    expect(normalizedMessages[0].thinkingStartedAt).toBeUndefined();
    expect(normalizedMessages[1].thinkingFinishedAt).toBeUndefined();
  });

});
