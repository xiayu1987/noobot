import { describe, expect, it } from "vitest";
import { buildAppendMessage, buildViewMessage, foldConversationMessages } from "../../../../src/composables/infra/messageModel";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 1,
  direction: "output",
  transport: "file",
  filePath: "/workspace/u1/report.md",
  attachmentMeta: {
    attachmentId: "att-1",
    name: "report.md",
    mimeType: "text/markdown",
    path: "/legacy/report.md",
  },
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
  it("preserves thinking timing fields from backend messages after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "running",
      thinking_started_at: "2026-06-22T10:00:00.000Z",
      thinking_finished_at: "2026-06-22T10:00:12.000Z",
    });

    expect(message.thinkingStartedAt).toBe("2026-06-22T10:00:00.000Z");
    expect(message.thinking_started_at).toBeUndefined();
    expect(message.thinkingFinishedAt).toBe("2026-06-22T10:00:12.000Z");
    expect(message.thinking_finished_at).toBeUndefined();
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

  it("preserves backend turn and message identity aliases for monotonic resend anchors", () => {
    const message = buildViewMessage({
      role: "user",
      content: "edit me",
      id: "storage-id-1",
      message_id: "backend-message-1",
      turn_id: "backend-turn-1",
      turnScopeId: "client-turn:backend-scope-1",
    });

    expect(message.id).toBe("storage-id-1");
    expect(message.messageId).toBe("backend-message-1");
    expect(message.message_id).toBe("backend-message-1");
    expect(message.turnId).toBe("backend-turn-1");
    expect(message.turn_id).toBe("backend-turn-1");
    expect(message.turnScopeId).toBe("client-turn:backend-scope-1");
    expect(Object.keys(message)).not.toContain(["turn", "scope", "id"].join("_"));
  });

  it("prefers transfer-derived attachment metadata over legacy attachmentMetas", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      attachmentMetas: [
        {
          attachmentId: "att-1",
          name: "legacy-report.md",
          mimeType: "text/plain",
          path: "/legacy-only/report.md",
        },
      ],
      transferResult: { ok: true, status: "file", envelope },
    });

    expect(message.transferResult?.ok).toBe(true);
    expect(message.transferEnvelopes).toHaveLength(1);
    expect(message.transferEnvelopes[0]?.protocol).toBe("noobot.semantic-transfer");
    expect(message.attachmentMetas).toHaveLength(1);
    expect(message.attachmentMetas[0]).toMatchObject({
      attachmentId: "att-1",
      name: "report.md",
      mimeType: "text/markdown",
      transferFilePath: "/workspace/u1/report.md",
      sandboxPath: "/workspace/u1/report.md",
    });
  });

  it("normalizes parsed result metadata from attachmentMetas", () => {
    const message = buildViewMessage(
      {
        role: "user",
        content: "source",
        attachmentMetas: [
          {
            attachmentId: "src-1",
            name: "source.pdf",
            mimeType: "application/pdf",
            parsedResultAttachmentId: "parsed-1",
            parsedResultRelativePath: "runtime/attach/parsed/source.md",
          },
        ],
      },
      { userId: "admin" },
    );

    expect(message.attachmentMetas).toHaveLength(1);
    expect(message.attachmentMetas[0]).toMatchObject({
      attachmentId: "src-1",
      parsedResultAttachmentId: "parsed-1",
      parsedResultRelativePath: "runtime/attach/parsed/source.md",
      parsedResultName: "source.md",
    });
    expect(message.attachmentMetas[0].parsedResultUrl).toContain("parsed-1");
  });

  it("normalizes attachment url from compatible id/session/source fields", () => {
    const message = buildViewMessage(
      {
        role: "assistant",
        content: "generated file",
        attachmentMetas: [
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

    expect(message.attachmentMetas[0]).toMatchObject({
      attachmentId: "att-alias-1",
      sessionId: "session-1",
      attachmentSource: "model",
    });
    expect(message.attachmentMetas[0].url).toBe(
      "/api/internal/attachment/admin/att-alias-1?sessionId=session-1&attachmentSource=model",
    );
  });

  it("does not fall back to legacy attachments", () => {
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

    expect(message.attachmentMetas).toEqual([]);
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
        attachmentMetas: [{ attachmentId: "att-prev", name: "previous.md" }],
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
        attachmentMetas: [],
        realtimeLogs: [],
        completedToolLogs: [],
        tool_calls: [],
        executionLogTotal: 0,
        statusLabel: "",
      },
    ], buildViewMessage);

    expect(messages).toHaveLength(2);
    expect(messages[1].pending).toBe(true);
    expect(messages[1].attachmentMetas).toEqual([]);
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
        dialogProcessId: "dp-new-stream",
        attachmentMetas: [{ attachmentId: "att-new", name: "new.md" }],
        realtimeLogs: [{ text: "new tool log" }],
        tool_calls: [{ id: "tool-new" }],
        executionLogTotal: 1,
      },
      {
        role: "assistant",
        content: "new continuation",
        dialogProcessId: "dp-new-stream",
        realtimeLogs: [{ text: "new tool log 2" }],
        executionLogTotal: 2,
      },
    ], buildViewMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("new partial answer");
    expect(messages[0].content).toContain("new continuation");
    expect(messages[0].attachmentMetas).toHaveLength(1);
    expect(messages[0].attachmentMetas[0]).toMatchObject({ attachmentId: "att-new" });
    expect(messages[0].realtimeLogs).toHaveLength(2);
    expect(messages[0].tool_calls).toHaveLength(1);
    expect(messages[0].executionLogTotal).toBe(2);
  });

  it("keeps summary thinking entry fields when merging assistant messages", () => {
    const messages = foldConversationMessages([
      {
        role: "assistant",
        content: "part 1",
        dialogProcessId: "dp-summary-thinking",
      },
      {
        role: "assistant",
        content: "part 2",
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
        dialogProcessId: "dp-logs",
        realtimeLogs: Array.from({ length: 6 }, (_, index) => ({ text: `log-${index + 1}` })),
        executionLogTotal: 6,
      },
      {
        role: "assistant",
        content: "part 2",
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
});
