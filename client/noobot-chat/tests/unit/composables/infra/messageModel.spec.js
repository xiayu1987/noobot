import { describe, expect, it } from "vitest";
import {
  buildAppendMessage,
  buildViewMessage,
  findVisibleLastMessage,
  foldConversationMessages,
} from "../../../../src/composables/infra/messageModel";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 1,
  direction: "output",
  transport: "file",
  files: [
    {
      filePath: "/workspace/u1/report.md",
      attachmentMeta: {
        attachmentId: "att-1",
        name: "report.md",
        mimeType: "text/markdown",
        path: "/legacy/report.md",
      },
      pathView: {
        sandboxPath: "/workspace/u1/report.md",
        relativePath: "runtime/report.md",
      },
      role: "primary",
    },
  ],
};

describe("messageModel semantic transfer", () => {
  it("finds the last user-visible message and skips harness injected relay messages", () => {
    const userMessage = { role: "user", content: "real request" };
    const assistantMessage = { role: "assistant", content: "real answer" };
    const harnessRelay = {
      role: "user",
      content: "[来自harness外部模型输出/planning] hidden relay",
      injectedMessage: true,
      injectedBy: "harness-plugin",
    };

    expect(findVisibleLastMessage([userMessage, assistantMessage, harnessRelay])).toBe(assistantMessage);
    expect(findVisibleLastMessage([harnessRelay])).toBe(null);
  });

  it("renders serialized LangChain human and ai messages as user and assistant", () => {
    const messages = foldConversationMessages([
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
    ], buildViewMessage);

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

  it("preserves legacy attachments alongside semantic transfer envelopes", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      attachments: [
        {
          attachmentId: "att-1",
          name: "legacy-report.md",
          mimeType: "text/plain",
          path: "/legacy-only/report.md",
        },
      ],
      transferEnvelopes: [envelope],
    });

    expect(message.transferResult).toBeUndefined();
    expect(message.transferEnvelopes).toHaveLength(1);
    expect(message.transferEnvelopes[0]?.protocol).toBe("noobot.semantic-transfer");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-1",
      name: "legacy-report.md",
      mimeType: "text/plain",
      path: "/legacy-only/report.md",
    });
  });

  it("restores attachment metadata from refreshed session summary transfer envelopes", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done after refresh",
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          files: [
            {
              role: "primary",
              filePath: "/workspace/u1/runtime/workflow-result.md",
              attachmentMeta: {
                attachmentId: "att-workflow-1",
                sessionId: "s1",
                attachmentSource: "model",
                name: "workflow-result.md",
                mimeType: "text/markdown",
                relativePath: "runtime/workflow-result.md",
              },
              pathView: {
                sandboxPath: "/sandbox/u1/runtime/workflow-result.md",
                relativePath: "runtime/workflow-result.md",
              },
            },
          ],
        },
      ],
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-workflow-1",
      sessionId: "s1",
      attachmentSource: "model",
      name: "workflow-result.md",
      mimeType: "text/markdown",
      transferFilePath: "/sandbox/u1/runtime/workflow-result.md",
      sandboxPath: "/sandbox/u1/runtime/workflow-result.md",
    });
  });

  it("restores compact session summary transfer attachments with ownership", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "compact transfer",
      sessionId: "session-compact-1",
      turnScopeId: "turn-compact-1",
      dialogProcessId: "dialog-compact-1",
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          files: [
            {
              attachmentId: "att-compact-1",
              name: "compact.md",
              mimeType: "text/markdown",
              relativePath: "runtime/compact.md",
              sandboxPath: "/workspace/u1/runtime/compact.md",
              owner: { type: "plugin", id: "harness-plugin" },
              role: "primary",
            },
          ],
        },
      ],
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-compact-1",
      name: "compact.md",
      mimeType: "text/markdown",
      relativePath: "runtime/compact.md",
      sandboxPath: "/workspace/u1/runtime/compact.md",
      transferFilePath: "/workspace/u1/runtime/compact.md",
      owner: expect.objectContaining({
        type: "plugin",
        id: "harness-plugin",
        sessionId: "session-compact-1",
        turnScopeId: "turn-compact-1",
        dialogProcessId: "dialog-compact-1",
      }),
    });
  });

  it("enriches refreshed transfer envelope attachments with message scope", () => {
    const message = buildViewMessage({
      id: "msg-scope-1",
      role: "assistant",
      content: "done",
      sessionId: "session-scope-1",
      turnScopeId: "turn-scope-1",
      dialogProcessId: "dialog-scope-1",
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          files: [
            {
              filePath: "runtime/attach/scope.txt",
              attachmentMeta: {
                attachmentId: "att-scope-1",
                name: "scope.txt",
                size: 10,
              },
            },
          ],
        },
      ],
    });

    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-scope-1",
      sessionId: "session-scope-1",
      owner: {
        sessionId: "session-scope-1",
        turnScopeId: "turn-scope-1",
        dialogProcessId: "dialog-scope-1",
        role: "assistant",
      },
      turnScope: {
        sessionId: "session-scope-1",
        turnScopeId: "turn-scope-1",
        dialogProcessId: "dialog-scope-1",
      },
    });
  });

  it("restores attachments from refreshed plugin payload transfer envelopes", () => {
    const message = buildViewMessage({
      id: "msg-plugin-payload-transfer",
      role: "assistant",
      content: "workflow done",
      sessionId: "session-plugin-1",
      turnScopeId: "turn-plugin-1",
      pluginMeta: {
        payload: {
          execution: {
            nodeAgentRuns: [
              {
                nodeResultTransferEnvelopes: [
                  {
                    protocol: "noobot.semantic-transfer",
                    files: [
                      {
                        filePath: "runtime/workflow/report.md",
                        attachmentMeta: {
                          attachmentId: "att-plugin-payload-1",
                          name: "report.md",
                          mimeType: "text/markdown",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-plugin-payload-1",
      name: "report.md",
      sessionId: "session-plugin-1",
      owner: expect.objectContaining({ turnScopeId: "turn-plugin-1" }),
    });
  });

  it("normalizes parsed result metadata from attachments", () => {
    const message = buildViewMessage(
      {
        role: "user",
        content: "source",
        attachments: [
          {
            attachmentId: "src-1",
            name: "source.pdf",
            mimeType: "application/pdf",
            parsedResult: {
              attachmentId: "parsed-1",
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
    const messages = foldConversationMessages([
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
    ], buildViewMessage);

    expect(messages).toHaveLength(2);
    expect(messages[1].workflowMessage).toBe(true);
    expect(messages[1].workflowMeta?.source).toBe("workflow-plugin");
  });
});

describe("messageModel execution logs", () => {

  it("does not merge a new pending assistant placeholder with previous turn state", () => {
    const messages = foldConversationMessages([
      {
        role: "assistant",
        content: "previous answer",
        dialogProcessId: "dp-same-until-stream-arrives",
        attachments: [{ attachmentId: "att-prev", name: "previous.md" }],
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
    ], buildViewMessage);

    expect(messages).toHaveLength(2);
    expect(messages[1].pending).toBe(true);
    expect(messages[1].attachments).toEqual([]);
    expect(messages[1].realtimeLogs).toEqual([]);
    expect(messages[1].completedToolLogs).toEqual([]);
    expect(messages[1].tool_calls).toEqual([]);
    expect(messages[1].executionLogTotal).toBe(0);
    expect(messages[1].statusLabel).toBe("");
  });

  it("fills the new assistant turn only after non-pending stream events arrive", () => {
    const messages = foldConversationMessages([
      {
        role: "assistant",
        content: "new partial answer",
        turnScopeId: "client-turn:new-stream",
        dialogProcessId: "dp-new-stream",
        attachments: [{ attachmentId: "att-new", name: "new.md" }],
        realtimeLogs: [{ text: "new tool log" }],
        tool_calls: [{ id: "tool-new" }],
        executionLogTotal: 1,
      },
      {
        role: "assistant",
        content: "new continuation",
        turnScopeId: "client-turn:new-stream",
        dialogProcessId: "dp-new-stream",
        realtimeLogs: [{ text: "new tool log 2" }],
        executionLogTotal: 2,
      },
    ], buildViewMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("new partial answer");
    expect(messages[0].content).toContain("new continuation");
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0]).toMatchObject({ attachmentId: "att-new" });
    expect(messages[0].realtimeLogs).toHaveLength(2);
    expect(messages[0].tool_calls).toHaveLength(1);
    expect(messages[0].executionLogTotal).toBe(2);
  });

  it("keeps the user message and merges assistant chunks even when storage ids differ", () => {
    const messages = foldConversationMessages([
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
        id: "storage-assistant-2",
        role: "assistant",
        content: "answer part 2",
        dialogProcessId: "dp-render-1",
        turnScopeId: "client-turn:render-1",
      },
    ], buildViewMessage);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(expect.objectContaining({
      role: "user",
      content: "question",
    }));
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("answer part 1");
    expect(messages[1].content).toContain("answer part 2");
  });

  it("keeps summary thinking entry fields when merging assistant messages", () => {
    const messages = foldConversationMessages([
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
    ], buildViewMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0].hasThinkingDetails).toBe(true);
    expect(messages[0].thinkingDetailCount).toBe(3);
  });

  it("keeps only latest 10 realtime logs when merging completed assistant messages", () => {
    const messages = foldConversationMessages([
      {
        role: "assistant",
        content: "part 1",
        turnScopeId: "client-turn:logs",
        dialogProcessId: "dp-logs",
        realtimeLogs: Array.from({ length: 6 }, (_, index) => ({ text: `log-${index + 1}` })),
        executionLogTotal: 6,
      },
      {
        role: "assistant",
        content: "part 2",
        turnScopeId: "client-turn:logs",
        dialogProcessId: "dp-logs",
        realtimeLogs: Array.from({ length: 6 }, (_, index) => ({ text: `log-${index + 7}` })),
        executionLogTotal: 12,
      },
    ], buildViewMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0].realtimeLogs).toHaveLength(10);
    expect(messages[0].realtimeLogs[0].text).toBe("log-3");
    expect(messages[0].realtimeLogs[9].text).toBe("log-12");
    expect(messages[0].executionLogTotal).toBe(12);
  });

  it("keeps thinking intervals out of folded messages when continuing the same turn", () => {
    const messages = foldConversationMessages([
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
    ], buildViewMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0].thinkingStartedAt).toBeUndefined();
    expect(messages[0].thinkingFinishedAt).toBeUndefined();
  });
});
