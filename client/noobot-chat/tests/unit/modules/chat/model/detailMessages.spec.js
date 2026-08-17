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
            version: 2,
            transferId: "root",
            messageId: "message-root",
            identity: {
              sessionId: "root-session",
              turnScopeId: "turn-root",
              runId: "run-root",
              producer: { type: "plugin", id: "producer-root" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: {
                    attachmentId: "root-attachment",
                    sessionId: "root-session",
                    attachmentSource: "test",
                  },
                  role: "primary",
                  name: "root.md",
                  mimeType: "text/markdown",
                },
              ],
            },
            intent: {
              source: "plugin",
              reason: "workflow_task_result",
              scenario: "workflow",
              strategy: "workflow_subagent",
            },
            meta: {},
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
                version: 2,
                transferId: "child",
                messageId: "message-child",
                identity: {
                  sessionId: "child-session",
                  turnScopeId: "turn-child",
                  runId: "run-child",
                  producer: { type: "plugin", id: "producer-child" },
                },
                direction: "output",
                payload: {
                  mode: "attachment",
                  attachments: [
                    {
                      identity: {
                        attachmentId: "child-attachment",
                        sessionId: "child-session",
                        attachmentSource: "test",
                      },
                      role: "primary",
                      name: "child.md",
                      mimeType: "text/markdown",
                    },
                  ],
                },
                intent: {
                  source: "plugin",
                  reason: "workflow_task_result",
                  scenario: "workflow",
                  strategy: "workflow_subagent",
                },
                meta: {},
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
      foldMessagesForView: (messages) =>
        messages.map((messageItem) => buildViewMessage(messageItem)),
    });
    const normalizedForPreserve = buildNormalizedDetailMessages({
      detailMessages,
      sessionDocs,
      rootSessionId: "root-session",
      makeViewMessage: buildViewMessage,
      foldMessagesForView: (messages) =>
        messages.map((messageItem) => buildViewMessage(messageItem)),
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
                  version: 2,
                  transferId: "child-transfer-b",
                  messageId: "message-child-transfer-b",
                  identity: {
                    sessionId: "child-session",
                    turnScopeId: "turn-child-transfer-b",
                    runId: "run-child-transfer-b",
                    producer: { type: "plugin", id: "producer-child-transfer-b" },
                  },
                  direction: "output",
                  payload: {
                    mode: "attachment",
                    attachments: [
                      {
                        identity: {
                          attachmentId: "child-transfer-1",
                          sessionId: "child-session",
                          attachmentSource: "test",
                        },
                        role: "primary",
                        name: "result.md",
                        mimeType: "text/markdown",
                      },
                    ],
                  },
                  intent: {
                    source: "plugin",
                    reason: "workflow_task_result",
                    scenario: "workflow",
                    strategy: "workflow_subagent",
                  },
                  meta: {},
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
                  version: 2,
                  transferId: "child-transfer",
                  messageId: "message-child-transfer",
                  identity: {
                    sessionId: "child-session",
                    turnScopeId: "turn-child-transfer",
                    runId: "run-child-transfer",
                    producer: { type: "subagent", id: "child-dp" },
                  },
                  direction: "output",
                  payload: {
                    mode: "attachment",
                    attachments: [
                      {
                        identity: {
                          attachmentId: "child-transfer-1",
                          sessionId: "child-session",
                          attachmentSource: "test",
                        },
                        role: "primary",
                        name: "result.md",
                        mimeType: "text/markdown",
                      },
                    ],
                  },
                  intent: {
                    source: "subagent",
                    reason: "workflow_task_result",
                    scenario: "workflow",
                    strategy: "workflow_subagent",
                  },
                  meta: {},
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
                  version: 2,
                  transferId: "plugin",
                  messageId: "message-plugin",
                  identity: {
                    sessionId: "root-session",
                    turnScopeId: "turn-plugin",
                    runId: "run-plugin",
                    producer: { type: "plugin", id: "producer-plugin" },
                  },
                  direction: "output",
                  payload: {
                    mode: "attachment",
                    attachments: [
                      {
                        identity: {
                          attachmentId: "plugin-transfer-1",
                          sessionId: "root-session",
                          attachmentSource: "test",
                        },
                        role: "primary",
                        name: "plugin.md",
                        mimeType: "text/markdown",
                      },
                    ],
                  },
                  intent: {
                    source: "plugin",
                    reason: "workflow_task_result",
                    scenario: "workflow",
                    strategy: "workflow_subagent",
                  },
                  meta: {},
                },
              ],
              nodeResultTransferEnvelopes: [
                {
                  protocol: "noobot.semantic-transfer",
                  version: 2,
                  transferId: "node-result",
                  messageId: "message-node-result",
                  identity: {
                    sessionId: "root-session",
                    turnScopeId: "turn-node-result",
                    runId: "run-node-result",
                    producer: { type: "plugin", id: "producer-node-result" },
                  },
                  direction: "output",
                  payload: {
                    mode: "attachment",
                    attachments: [
                      {
                        identity: {
                          attachmentId: "node-result-1",
                          sessionId: "root-session",
                          attachmentSource: "test",
                        },
                        role: "primary",
                        name: "node-result.md",
                        mimeType: "text/markdown",
                      },
                    ],
                  },
                  intent: {
                    source: "plugin",
                    reason: "workflow_task_result",
                    scenario: "workflow",
                    strategy: "workflow_subagent",
                  },
                  meta: {},
                },
              ],
              nodeSessions: [
                {
                  transferEnvelopes: [
                    {
                      protocol: "noobot.semantic-transfer",
                      version: 2,
                      transferId: "node-session",
                      messageId: "message-node-session",
                      identity: {
                        sessionId: "root-session",
                        turnScopeId: "turn-node-session",
                        runId: "run-node-session",
                        producer: { type: "plugin", id: "producer-node-session" },
                      },
                      direction: "output",
                      payload: {
                        mode: "attachment",
                        attachments: [
                          {
                            identity: {
                              attachmentId: "node-session-1",
                              sessionId: "root-session",
                              attachmentSource: "test",
                            },
                            role: "primary",
                            name: "node-session.md",
                            mimeType: "text/markdown",
                          },
                        ],
                      },
                      intent: {
                        source: "plugin",
                        reason: "workflow_task_result",
                        scenario: "workflow",
                        strategy: "workflow_subagent",
                      },
                      meta: {},
                    },
                  ],
                },
              ],
            },
          },
          toolTimeline: [
            {
              key: "call:completed-tool",
              toolCallId: "completed-tool",
              status: "completed",
              resultEvent: {
                eventId: "completed-tool-result",
                sequence: 1,
                sequenceScopeId: "message-1",
                sequenceDomain: "message-event",
                authority: "authoritative",
                attachments: [
                  {
                    attachmentId: "completed-tool-1",
                    sessionId: "root-session",
                    attachmentSource: "test",
                    name: "completed-tool.md",
                  },
                ],
              },
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
      "completed-tool-1",
    ]);
    expect(selectToolTimelineLogs(normalizedMessages[0])[0].attachments).toEqual([
      {
        attachmentId: "completed-tool-1",
        sessionId: "root-session",
        attachmentSource: "test",
        name: "completed-tool.md",
      },
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
    expect(normalizedMessages.map((message) => message.content)).toEqual([
      "first chunk",
      "final chunk",
    ]);
    expect(normalizedMessages[0].thinkingStartedAt).toBeUndefined();
    expect(normalizedMessages[1].thinkingFinishedAt).toBeUndefined();
  });
});
