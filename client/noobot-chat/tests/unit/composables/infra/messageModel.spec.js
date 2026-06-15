import { describe, expect, it } from "vitest";
import { buildViewMessage } from "../../../../src/composables/infra/messageModel";

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
