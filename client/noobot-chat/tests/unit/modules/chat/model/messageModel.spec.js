/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildAppendMessage,
  buildViewMessage,
  findVisibleLastMessage,
  foldConversationMessages,
} from "../../../../../src/modules/chat/model/messageModel.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 2,
  transferId: "transfer-model-1",
  messageId: "message-model-1",
  identity: {
    sessionId: "test-session",
    turnScopeId: "turn-1",
    runId: "run-1",
    producer: { type: "tool", id: "call-1" },
  },
  direction: "output",
  payload: {
    mode: "attachment",
    attachments: [
      {
        identity: { attachmentId: "att-1", sessionId: "test-session", attachmentSource: "test" },
        role: "primary",
        name: "report.md",
        mimeType: "text/markdown",
      },
    ],
  },
  intent: {
    source: "tool",
    reason: "semantic_transfer_tool_result",
    scenario: "tool",
    strategy: "tool_result_text",
  },
  meta: { persisted: true },
};

describe("messageModel semantic transfer", () => {
  it("projects attachment identity from its owning message before live updates", () => {
    const message = buildViewMessage({
      role: "user",
      sessionId: "session-1",
      attachments: [
        {
          attachmentId: "source-att",
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
    });

    expect(message.attachments[0]).toMatchObject({
      attachmentId: "source-att",
      sessionId: "session-1",
      attachmentSource: "user",
    });
  });

  it("does not admit workflow running view models into canonical messages", () => {
    const message = buildViewMessage({
      role: "assistant",
      type: "message",
      content: "",
      pending: true,
      synthetic: true,
      placeholder: true,
      turnPlaceholder: true,
      workflowNodeRunningPlaceholder: true,
    });

    expect(message).toMatchObject({
      pending: true,
      synthetic: true,
      placeholder: true,
      turnPlaceholder: true,
    });
    expect(message).not.toHaveProperty("workflowNodeRunningPlaceholder");
  });

  it("keeps turn UI state out of message projections", () => {
    expect(buildViewMessage({ role: "assistant", pending: true })).not.toHaveProperty(
      "thinkingOpenNames",
    );
    expect(buildViewMessage({ role: "assistant" })).not.toHaveProperty("expandedToolDetailKeys");
    expect(buildViewMessage({ role: "user" })).not.toHaveProperty("thinkingOpenNames");
  });

  it("finds the last user-visible message and skips harness injected relay messages", () => {
    const userMessage = { role: "user", content: "real request" };
    const assistantMessage = { role: "assistant", content: "real answer" };
    const harnessRelay = {
      role: "user",
      content: "[来自harness外部模型输出/planning] hidden relay",
      injectedMessage: true,
      injectedBy: "harness-plugin",
    };

    expect(findVisibleLastMessage([userMessage, assistantMessage, harnessRelay])).toBe(
      assistantMessage,
    );
    expect(findVisibleLastMessage([harnessRelay])).toBe(null);
  });

  it("renders serialized LangChain human and ai messages as user and assistant", () => {
    const messages = foldConversationMessages(
      [
        {
          lc_id: ["langchain_core", "messages", "human", "HumanMessage"],
          type: "constructor",
          kwargs: { content: "question from serialized human" },
        },
        {
          lc_id: ["langchain_core", "messages", "ai", "AIMessage"],
          type: "constructor",
          kwargs: { content: "answer from serialized ai" },
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "question from serialized human",
      type: "message",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "answer from serialized ai",
      type: "message",
    });
  });

  it("keeps thinking timing fields out of backend view messages after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "running",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:12.000Z",
    });

    expect(message.thinkingStartedAt).toBeUndefined();
    expect(message.thinkingFinishedAt).toBeUndefined();
  });

  it("uses backend createdAt as message timestamp so pending thinking elapsed does not reset after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "running",
      pending: true,
      createdAt: "2026-06-22T10:00:00.000Z",
    });

    expect(message.ts).toBe("2026-06-22T10:00:00.000Z");
  });

  it("does not expose backend turn/message identity aliases", () => {
    const message = buildViewMessage({
      role: "user",
      content: "edit me",
      id: "storage-id-1",
      turnScopeId: "client-turn:backend-scope-1",
    });

    expect(message.id).toBe("storage-id-1");
    expect(message.turnScopeId).toBe("client-turn:backend-scope-1");
  });

  it("projects ordinary attachments independently from semantic transfer envelopes", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      attachments: [
        {
          attachmentId: "ordinary-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "input.md",
          mimeType: "text/plain",
        },
      ],
      transferEnvelopes: [envelope],
    });
    expect(message.transferEnvelopes).toHaveLength(1);
    expect(message.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attachmentId: "ordinary-1", name: "input.md" }),
        expect.objectContaining({ attachmentId: "att-1", name: "report.md" }),
      ]),
    );
  });

  it("restores V2 transfer attachment identity after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done after refresh",
      transferEnvelopes: [envelope],
    });
    expect(message.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-1",
        name: "report.md",
        sessionId: "test-session",
      }),
    ]);
  });

  it("rejects path-based transfer payloads without rebuilding an attachment", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      transferEnvelopes: [{ ...envelope, filePath: "/legacy/result.md" }],
    });
    expect(message.transferEnvelopes).toEqual([]);
    expect(message.attachments).toEqual([]);
  });

  it("normalizes parsed result metadata from attachments", () => {
    const message = buildViewMessage(
      {
        role: "user",
        content: "source",
        attachments: [
          {
            attachmentId: "src-1",
            sessionId: "s1",
            attachmentSource: "test",
            name: "source.pdf",
            mimeType: "application/pdf",
            parsedResult: {
              attachmentId: "parsed-1",
              sessionId: "s1",
              attachmentSource: "test",
              relativePath: "runtime/attach/parsed/source.md",
            },
          },
        ],
      },
      { userId: "admin" },
    );

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "src-1",
      parsedResult: {
        attachmentId: "parsed-1",
        relativePath: "runtime/attach/parsed/source.md",
      },
      parsedResultName: "source.md",
    });
    expect(message.attachments[0].parsedResultUrl).toContain("parsed-1");
  });

  it("normalizes attachment url from compatible id/session/source fields", () => {
    const message = buildViewMessage(
      {
        role: "assistant",
        content: "generated file",
        attachments: [
          {
            id: "att-alias-1",
            name: "result.md",
            session_id: "session-1",
            source: "model",
          },
        ],
      },
      { userId: "admin" },
    );

    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-alias-1",
      sessionId: "session-1",
      attachmentSource: "model",
    });
    expect(message.attachments[0].url).toBe(
      "/api/internal/attachment/admin/att-alias-1?sessionId=session-1&attachmentSource=model",
    );
  });

  it("keeps canonical attachments after refresh", () => {
    const message = buildViewMessage({
      role: "user",
      content: "source",
      attachments: [
        {
          attachmentId: "legacy-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "legacy.pdf",
        },
      ],
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "legacy-1",
      name: "legacy.pdf",
    });
  });

  it("does not restore attachment metadata from legacy snake_case attachment_metas", () => {
    const message = buildViewMessage({
      role: "user",
      content: "source",
      attachment_metas: [
        {
          attachmentId: "snake-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "snake.pdf",
        },
      ],
    });

    expect(message.attachments).toEqual([]);
  });

  it("preserves parent dialog process id for related attachment aggregation", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      dialogProcessId: "child-dp",
      parentDialogProcessId: "root-dp",
    });

    expect(message.parentDialogProcessId).toBe("root-dp");
  });

  it("preserves summary thinking entry fields on view messages", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      hasThinkingDetails: true,
      thinkingDetailCount: 2,
    });

    expect(message.hasThinkingDetails).toBe(true);
    expect(message.thinkingDetailCount).toBe(2);
  });
});

describe("messageModel workflow messages", () => {
  it("infers workflow messages from canonical pluginMeta for card matching and folding", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "normal",
          dialogProcessId: "dp-workflow",
        },
        {
          role: "assistant",
          type: "workflow",
          content: "workflow plan",
          dialogProcessId: "dp-workflow",
          pluginMessage: true,
          pluginMeta: {
            source: "workflow-plugin",
            kind: "workflow",
            phase: "planning",
            payload: { semantic: { nodes: [{ id: "n1", type: "action" }] } },
          },
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].workflowMessage).toBe(true);
    expect(messages[1].workflowMeta?.source).toBe("workflow-plugin");
  });
});

describe("messageModel execution logs", () => {
  it("does not merge a new pending assistant placeholder with previous turn state", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "previous answer",
          dialogProcessId: "dp-same-until-stream-arrives",
          attachments: [
            {
              attachmentId: "att-prev",
              sessionId: "child-session",
              attachmentSource: "test",
              name: "previous.md",
            },
          ],
          realtimeLogs: [{ text: "previous tool log" }],
          completedToolLogs: [{ text: "previous completed tool" }],
          tool_calls: [{ id: "tool-prev" }],
          executionLogTotal: 1,
        },
        {
          role: "assistant",
          content: "",
          dialogProcessId: "dp-same-until-stream-arrives",
          pending: true,
          attachments: [],
          realtimeLogs: [],
          completedToolLogs: [],
          tool_calls: [],
          executionLogTotal: 0,
          statusLabel: "",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].pending).toBe(true);
    expect(messages[1].attachments).toEqual([]);
    expect(messages[1].toolTimeline).toEqual([]);
    expect(messages[1].activityTimeline).toEqual([]);
    expect(messages[1].tool_calls).toEqual([]);
    expect(messages[1].statusLabel).toBe("");
  });

  it("fills the new assistant turn only after non-pending stream events arrive", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "new partial answer",
          turnScopeId: "client-turn:new-stream",
          dialogProcessId: "dp-new-stream",
          attachments: [
            {
              attachmentId: "att-new",
              sessionId: "child-session",
              attachmentSource: "test",
              name: "new.md",
            },
          ],
          activityTimeline: [
            {
              activityId: "event:new-log-1",
              eventId: "new-log-1",
              event: "thinking",
              type: "thinking",
              text: "new tool log",
              sequence: 1,
              sequenceScopeId: "message-new",
              sequenceDomain: "message-event",
              authority: "authoritative",
            },
          ],
          tool_calls: [{ id: "tool-new" }],
          executionLogTotal: 1,
        },
        {
          role: "assistant",
          content: "new continuation",
          turnScopeId: "client-turn:new-stream",
          dialogProcessId: "dp-new-stream",
          activityTimeline: [
            {
              activityId: "event:new-log-2",
              eventId: "new-log-2",
              event: "thinking",
              type: "thinking",
              text: "new tool log 2",
              sequence: 2,
              sequenceScopeId: "message-new",
              sequenceDomain: "message-event",
              authority: "authoritative",
            },
          ],
          executionLogTotal: 2,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("new partial answer");
    expect(messages[0].content).toContain("new continuation");
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0]).toMatchObject({ attachmentId: "att-new" });
    expect(selectActivityTimelineLogs(messages[0])).toHaveLength(2);
    expect(messages[0].tool_calls).toHaveLength(1);
  });

  it("keeps the user message and merges assistant projections with the same stable id", () => {
    const messages = foldConversationMessages(
      [
        {
          id: "storage-user-1",
          role: "user",
          content: "question",
          turnScopeId: "client-turn:render-1",
        },
        {
          id: "storage-assistant-1",
          role: "assistant",
          content: "answer part 1",
          dialogProcessId: "dp-render-1",
          turnScopeId: "client-turn:render-1",
        },
        {
          id: "storage-assistant-1",
          role: "assistant",
          content: "answer part 2",
          dialogProcessId: "dp-render-1",
          turnScopeId: "client-turn:render-1",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "question",
      }),
    );
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("answer part 1");
    expect(messages[1].content).toContain("answer part 2");
  });

  it("projects the canonical persisted model analysis onto the presentation message", () => {
    const messages = foldConversationMessages(
      [
        {
          messageUid: "sm-analysis-1",
          messageId: "msg-model-1",
          presentationMessageId: "msg-chat-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "I should inspect the repository first.",
          activityTimeline: [
            {
              eventId: "model-content:msg-model-1",
              sequence: 1,
              sequenceScopeId: "msg-model-1",
              sequenceDomain: "message-event",
              authority: "authoritative",
              event: "main_model_content",
              type: "main_model_content",
              text: "I should inspect the repository first.",
              log: {
                eventId: "model-content:msg-model-1",
                event: "main_model_content",
                type: "main_model_content",
                text: "I should inspect the repository first.",
              },
            },
          ],
          turnScopeId: "client-turn:refresh",
          dialogProcessId: "dp-refresh",
          ts: "2026-07-29T01:00:00.000Z",
        },
        {
          messageUid: "sm-final-1",
          messageId: "msg-model-2",
          presentationMessageId: "msg-chat-1",
          chatPresentation: true,
          role: "assistant",
          type: "message",
          content: "Final answer",
          turnScopeId: "client-turn:refresh",
          dialogProcessId: "dp-refresh",
          ts: "2026-07-29T01:01:00.000Z",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "msg-chat-1",
      messageId: "msg-chat-1",
      content: "Final answer",
    });
    expect(selectActivityTimelineLogs(messages[0])).toEqual([
      expect.objectContaining({
        event: "main_model_content",
        text: "I should inspect the repository first.",
      }),
    ]);
  });

  it("projects model-history records through one explicit chat presentation", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "model-tool-call-1",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "inspect first",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-1", name: "read_file" }],
          activityTimeline: [
            {
              eventId: "activity-1",
              sequence: 1,
              sequenceScopeId: "model-tool-call-1",
              sequenceDomain: "message-event",
              authority: "authoritative",
              event: "main_model_content",
              type: "main_model_content",
              text: "inspect first",
              log: {
                eventId: "activity-1",
                event: "main_model_content",
                type: "main_model_content",
                text: "inspect first",
              },
            },
          ],
        },
        {
          messageId: "model-tool-call-2",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "verify next",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-2", name: "execute_script" }],
        },
        {
          messageId: "model-final",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          type: "message",
          content: "Final answer",
          turnScopeId: "client-turn:canonical-presentation",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-presentation-1",
      chatPresentation: true,
      content: "Final answer",
      type: "message",
    });
    expect(messages[0].tool_calls.map((item) => item.id)).toEqual(["call-1", "call-2"]);
    expect(selectActivityTimelineLogs(messages[0])).toEqual([
      expect.objectContaining({ eventId: "activity-1", text: "inspect first" }),
    ]);
  });

  it("does not fold two explicit chat presentations into one entity", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "model-final-1",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "First answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
        {
          messageId: "model-final-2",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "Second answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
  });

  it("excludes non-chat context control entities from every conversation projection", () => {
    const messages = foldConversationMessages(
      [
        {
          messageUid: "sm-control-1",
          role: "user",
          type: "context_control",
          content: "periodic task check control",
          chatPresentation: false,
          noobotInternalMessageType: "noobot.task_check_prompt",
          turnScopeId: "workflow-node:control-1",
          dialogProcessId: "dp-control-1",
        },
        {
          messageUid: "sm-user-1",
          role: "user",
          content: "real workflow node task",
          turnScopeId: "workflow-node:control-1",
          dialogProcessId: "dp-control-1",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({ role: "user", content: "real workflow node task" }),
    );
  });

  it("folds a pending shell and persisted fragment with one presentation identity", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "msg-chat-running",
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "message",
          content: "",
          pending: true,
          turnScopeId: "client-turn:running",
        },
        {
          messageId: "msg-model-tool-call",
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "tool_call",
          content: "",
          pending: false,
          turnScopeId: "client-turn:running",
          tool_calls: [{ id: "tool-call-1", name: "write_file" }],
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "msg-chat-running",
      messageId: "msg-chat-running",
      presentationMessageId: "msg-chat-running",
      pending: true,
      turnScopeId: "client-turn:running",
    });
    expect(messages[0].tool_calls).toEqual([
      expect.objectContaining({ id: "tool-call-1", name: "write_file" }),
    ]);
  });

  it("keeps summary thinking entry fields when merging assistant messages", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "part 1",
          turnScopeId: "client-turn:summary-thinking",
          dialogProcessId: "dp-summary-thinking",
        },
        {
          role: "assistant",
          content: "part 2",
          turnScopeId: "client-turn:summary-thinking",
          dialogProcessId: "dp-summary-thinking",
          hasThinkingDetails: true,
          thinkingDetailCount: 3,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].hasThinkingDetails).toBe(true);
    expect(messages[0].thinkingDetailCount).toBe(3);
  });

  it("keeps child-session thinking and tool facets on view messages", () => {
    const rawEvents = [
      {
        event: "tool_call_start",
        data: { eventType: "tool_call_start", toolCallId: "call-1" },
      },
    ];
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "done",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          thinking: "checking the workspace",
          toolCall: { id: "call-1", name: "read_file", args: { filePath: "notes.txt" } },
          toolResult: { id: "call-1", output: "file body" },
          rawEvents,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        thinking: "checking the workspace",
        toolCall: expect.objectContaining({ id: "call-1", name: "read_file" }),
        toolResult: expect.objectContaining({ id: "call-1", output: "file body" }),
        rawEvents,
      }),
    );
  });

  it("preserves a running child execution status through the view boundary", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "",
          pending: true,
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completing",
          workflowNodeRunningPlaceholder: true,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completing",
    });
  });

  it("preserves terminal child execution status while folding same-turn assistant fragments", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "part 1",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completed",
        },
        {
          role: "assistant",
          content: "part 2",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completing",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    });
  });

  it("does not merge child execution status across turns", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "first turn",
          sessionId: "child-session",
          turnScopeId: "workflow-node:first",
          statusTurnScopeId: "workflow-node:first",
          projectedStatusStepState: "completed",
        },
        {
          role: "assistant",
          content: "second turn",
          sessionId: "child-session",
          turnScopeId: "workflow-node:second",
          statusTurnScopeId: "workflow-node:second",
          projectedStatusStepState: "completing",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.projectedStatusStepState)).toEqual([
      "completed",
      "completing",
    ]);
  });

  it("keeps all canonical activities when merging completed assistant messages", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "part 1",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) => ({
            activityId: `event:log-${index + 1}`,
            eventId: `log-${index + 1}`,
            event: "thinking",
            type: "thinking",
            text: `log-${index + 1}`,
            sequence: index + 1,
            sequenceScopeId: "message-logs",
            sequenceDomain: "message-event",
            authority: "authoritative",
          })),
          executionLogTotal: 6,
        },
        {
          role: "assistant",
          content: "part 2",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) => ({
            activityId: `event:log-${index + 7}`,
            eventId: `log-${index + 7}`,
            event: "thinking",
            type: "thinking",
            text: `log-${index + 7}`,
            sequence: index + 7,
            sequenceScopeId: "message-logs",
            sequenceDomain: "message-event",
            authority: "authoritative",
          })),
          executionLogTotal: 12,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    const logs = selectActivityTimelineLogs(messages[0]);
    expect(logs).toHaveLength(12);
    expect(logs[0].text).toBe("log-1");
    expect(logs[11].text).toBe("log-12");
  });

  it("keeps thinking intervals out of folded messages when continuing the same turn", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "initial attempt",
          turnScopeId: "client-turn:continue",
          dialogProcessId: "dp-continue",
          thinkingStartedAt: 1700000000000,
          thinkingFinishedAt: 1700000001000,
        },
        {
          role: "assistant",
          content: "continued attempt",
          turnScopeId: "client-turn:continue",
          dialogProcessId: "dp-continue",
          thinkingStartedAt: 1700000010000,
          thinkingFinishedAt: 1700000012000,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].thinkingStartedAt).toBeUndefined();
    expect(messages[0].thinkingFinishedAt).toBeUndefined();
  });
});
