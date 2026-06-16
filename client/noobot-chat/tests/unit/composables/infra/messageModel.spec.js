import { describe, expect, it } from "vitest";
import { buildViewMessage, foldConversationMessages } from "../../../../src/composables/infra/messageModel";

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
    expect(message.transferEnvelope?.protocol).toBe("noobot.semantic-transfer");
    expect(message.transferEnvelopes).toHaveLength(1);
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

});

describe("messageModel workflow messages", () => {
  it("infers workflow messages from type/workflowMeta for card matching and folding", () => {
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
        workflowMeta: {
          source: "workflow-plugin",
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

