import { describe, expect, it } from "vitest";
import { useMessageFiles } from "../../../../src/composables/message/useMessageFiles";

describe("useMessageFiles", () => {
  it("recognizes markdown file path without trailing full-width status suffix", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "已输出文件：workspace/admin/assessment_center_report_deepseek_glm_5_1/05_落地挑战与发展趋势.md（已完成）",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("05_落地挑战与发展趋势.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/05_落地挑战与发展趋势.md",
    );
  });

  it("trims any trailing suffix after file extension", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "输出：workspace/admin/assessment_center_report_deepseek_glm_5_1/04_实施流程与考官机制.md已完成并归档",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("04_实施流程与考官机制.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/04_实施流程与考官机制.md",
    );
  });

  it("recognizes workplace typo prefix as workspace-compatible path", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "已输出文件：workplace/admin/assessment_center_report_deepseek_glm_5_1/01_概述与价值.md（已完成）",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("01_概述与价值.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/01_概述与价值.md",
    );
  });

  it("prefers semantic-transfer attachment metadata before legacy attachmentMetas", () => {
    const envelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      filePath: "/workspace/admin/runtime/result.md",
      files: [
        {
          filePath: "/workspace/admin/runtime/result.md",
          attachmentMeta: {
            attachmentId: "att-transfer-1",
            name: "result.md",
            mimeType: "text/markdown",
            path: "/legacy/result.md",
          },
          pathView: { sandboxPath: "/workspace/admin/runtime/result.md" },
          role: "primary",
        },
      ],
    };
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachmentMetas: [
        {
          attachmentId: "att-transfer-1",
          name: "legacy-result.md",
          mimeType: "text/plain",
          path: "/legacy-only/result.md",
        },
      ],
      transferEnvelopes: [envelope],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toHaveLength(1);
    expect(displayedAttachmentMetas.value[0]).toMatchObject({
      attachmentId: "att-transfer-1",
      name: "result.md",
      mimeType: "text/markdown",
      transferFilePath: "/workspace/admin/runtime/result.md",
      attachmentOwnerType: "agent",
    });
  });

  it("classifies explicitly marked harness assistant attachments as plugin attachments", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachmentMetas: [
        {
          attachmentId: "att-harness-1",
          name: "harness-acceptance-report.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
          attachmentOwnerType: "plugin",
          attachmentOwner: "harness-plugin",
        },
        {
          attachmentId: "att-agent-1",
          name: "main-result.txt",
          mimeType: "text/plain",
        },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toHaveLength(2);
    expect(displayedAttachmentMetas.value.find((item) => item.attachmentId === "att-harness-1")).toMatchObject({
      attachmentOwnerType: "plugin",
    });
    expect(displayedAttachmentMetas.value.find((item) => item.attachmentId === "att-agent-1")).toMatchObject({
      attachmentOwnerType: "agent",
    });
  });

  it("does not infer plugin ownership from harness-like generationSource alone", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachmentMetas: [
        {
          attachmentId: "att-legacy-harness-name",
          name: "harness-named-file.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
        },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toHaveLength(1);
    expect(displayedAttachmentMetas.value[0]).toMatchObject({
      attachmentId: "att-legacy-harness-name",
      attachmentOwnerType: "agent",
    });
  });


  it("keeps parsed result metadata from attachmentMetas", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachmentMetas: [
        {
          attachmentId: "src-1",
          name: "source.pdf",
          parsedResultAttachmentId: "parsed-1",
          parsedResultUrl: "/api/attachments/parsed-1",
          parsedResultName: "source.md",
        },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toHaveLength(1);
    expect(displayedAttachmentMetas.value[0]).toMatchObject({
      attachmentId: "src-1",
      parsedResultAttachmentId: "parsed-1",
      parsedResultUrl: "/api/attachments/parsed-1",
      parsedResultName: "source.md",
    });
  });

  it("does not read legacy attachments fallback", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachments: [
        { attachmentId: "legacy-1", name: "legacy.pdf" },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toEqual([]);
  });

  it("does not backfill previously written files while current assistant is pending", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      messageRoundId: "round-2",
      hasFirstStreamEvent: false,
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      messageRoundId: "round-1",
      content: JSON.stringify({
        toolName: "write_file",
        state: "OK",
        resolvedPath: "/workspace/admin/previous.md",
        fileName: "previous.md",
      }),
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousToolMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(writtenFiles.value).toEqual([]);
  });

  it("does not backfill written files from a previous assistant round after current round starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      messageRoundId: "round-2",
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      messageRoundId: "round-1",
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
      messageRoundId: "round-2",
      content: JSON.stringify({
        toolName: "write_file",
        state: "OK",
        resolvedPath: "/workspace/admin/current.md",
        fileName: "current.md",
      }),
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousToolMessage, currentToolMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(writtenFiles.value.map((item) => item.fileName)).toEqual(["current.md"]);
  });

  it("does not backfill previous assistant attachments while current assistant is pending", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      attachmentMetas: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachmentMetas: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toEqual([]);
  });

  it("does not backfill attachments from a previous assistant round after current round starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      messageRoundId: "round-2",
      attachmentMetas: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      messageRoundId: "round-1",
      attachmentMetas: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachmentMetas } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachmentMetas.value).toEqual([]);
  });

});
