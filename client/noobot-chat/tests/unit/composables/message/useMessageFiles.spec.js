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

  it("keeps legacy attachment metadata while augmenting display with semantic-transfer fields", () => {
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
      attachments: [
        {
          attachmentId: "att-transfer-1",
          name: "legacy-result.md",
          mimeType: "text/plain",
          path: "/legacy-only/result.md",
        },
      ],
      transferEnvelopes: [envelope],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "att-transfer-1",
      name: "legacy-result.md",
      mimeType: "text/plain",
      transferFilePath: "/workspace/admin/runtime/result.md",
      owner: { type: "agent" },
    });
  });

  it("classifies explicitly marked harness assistant attachments as plugin attachments", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "att-harness-1",
          name: "harness-acceptance-report.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "att-agent-1",
          name: "main-result.txt",
          mimeType: "text/plain",
        },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value.find((item) => item.attachmentId === "att-harness-1")).toMatchObject({
      owner: { type: "plugin" },
    });
    expect(displayedAttachments.value.find((item) => item.attachmentId === "att-agent-1")).toMatchObject({
      owner: { type: "agent" },
    });
  });

  it("keeps refreshed harness attachments as plugin-owned without duplicating agent copies", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-1",
          name: "harness-plan-text.txt",
          size: 1400,
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "report-1",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };
    const refreshedSessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          content: "done",
          attachments: [
            { attachmentId: "plan-1", name: "harness-plan-text.txt", size: 1400 },
            { attachmentId: "report-1", name: "harness-acceptance-report.txt", size: 5600 },
          ],
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [refreshedSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value.map((item) => item.attachmentId)).toEqual([
      "plan-1",
      "report-1",
    ]);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({
        attachmentId: "plan-1",
        owner: { type: "plugin", id: "harness-plugin" },
      }),
      expect.objectContaining({
        attachmentId: "report-1",
        owner: { type: "plugin", id: "harness-plugin" },
      }),
    ]);
  });

  it("promotes same-key attachment metadata to plugin ownership when harness metadata arrives later", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        { attachmentId: "report-1", name: "harness-acceptance-report.txt", size: 5600 },
        {
          attachmentId: "report-1",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "report-1",
      owner: { type: "plugin", id: "harness-plugin" },
    });
  });

  it("dedupes refreshed harness attachments with different ids by stable file identity and keeps plugin ownership", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-plugin-live",
          name: "harness-plan-text.txt",
          size: 1400,
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "report-plugin-live",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };
    const refreshedSessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          content: "done",
          attachments: [
            { attachmentId: "plan-agent-refresh", name: "harness-plan-text.txt", size: 1400 },
            { attachmentId: "report-agent-refresh", name: "harness-acceptance-report.txt", size: 5600 },
          ],
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [refreshedSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value.map((item) => item.attachmentId)).toEqual([
      "plan-plugin-live",
      "report-plugin-live",
    ]);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({ name: "harness-plan-text.txt", owner: expect.objectContaining({ type: "plugin" }) }),
      expect.objectContaining({ name: "harness-acceptance-report.txt", owner: expect.objectContaining({ type: "plugin" }) }),
    ]);
  });

  it("recognizes harness plugin ownership from owner metadata", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-nested-owner",
          name: "harness-plan-text.txt",
          size: 1400,
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "report-nested-owner",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({
        attachmentId: "plan-nested-owner",
        owner: expect.objectContaining({ type: "plugin" }),
      }),
      expect.objectContaining({
        attachmentId: "report-nested-owner",
        owner: expect.objectContaining({ type: "plugin" }),
      }),
    ]);
  });

  it("does not infer plugin ownership from persisted harness file names without owner metadata", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        { attachmentId: "plan-current", name: "harness-plan-text.txt", size: 1400 },
        { attachmentId: "report-current", name: "harness-acceptance-report.txt", size: 5600 },
      ],
    };
    const refreshedSessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          content: "done",
          attachments: [
            { attachmentId: "plan-refreshed", name: "harness-plan-text.txt", size: 1400 },
            { attachmentId: "report-refreshed", name: "harness-acceptance-report.txt", size: 5600 },
          ],
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [refreshedSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(4);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({ attachmentId: "plan-current", owner: { type: "agent" } }),
      expect.objectContaining({ attachmentId: "report-current", owner: { type: "agent" } }),
      expect.objectContaining({ attachmentId: "plan-refreshed", owner: { type: "agent" } }),
      expect.objectContaining({ attachmentId: "report-refreshed", owner: { type: "agent" } }),
    ]);
  });

  it("restores persisted harness checklist attachments from owner metadata and dedupes refreshed copies", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-current",
          name: "harness-plan-text.txt",
          size: 1400,
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "report-current",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };
    const refreshedSessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          dialogProcessId: "dp-1",
          content: "done",
          attachments: [
            {
              attachmentId: "plan-refreshed",
              name: "harness-plan-text.txt",
              size: 1400,
              owner: { type: "plugin", id: "harness-plugin" },
            },
            {
              attachmentId: "report-refreshed",
              name: "harness-acceptance-report.txt",
              size: 5600,
              owner: { type: "plugin", id: "harness-plugin" },
            },
          ],
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [refreshedSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({
        attachmentId: "plan-current",
        owner: expect.objectContaining({ type: "plugin" }),
      }),
      expect.objectContaining({
        attachmentId: "report-current",
        owner: expect.objectContaining({ type: "plugin" }),
      }),
    ]);
  });

  it("does not infer plugin ownership from harness-like generationSource alone", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "att-legacy-harness-name",
          name: "harness-named-file.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
        },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "att-legacy-harness-name",
      owner: { type: "agent" },
    });
  });


  it("keeps parsed result metadata from attachments", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachments: [
        {
          attachmentId: "src-1",
          name: "source.pdf",
          parsedResult: { attachmentId: "parsed-1" },
          parsedResultUrl: "/api/attachments/parsed-1",
          parsedResultName: "source.md",
        },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "src-1",
      parsedResult: { attachmentId: "parsed-1" },
      parsedResultUrl: "/api/attachments/parsed-1",
      parsedResultName: "source.md",
    });
  });

  it("reads canonical message attachments", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachments: [
        { attachmentId: "legacy-1", name: "legacy.pdf" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "legacy-1", name: "legacy.pdf" },
    ]);
  });

  it("does not backfill written files while current assistant is pending before streaming starts", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      hasFirstStreamEvent: false,
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
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

  it("collects written files for the same turnScopeId after current turn starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      content: "",
    };
    const previousToolMessage = {
      role: "tool",
      dialogProcessId: "dp-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
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
      sessionId: "session-1",
      turnScopeId: "turn-1",
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

    expect(writtenFiles.value.map((item) => item.fileName)).toEqual(["previous.md", "current.md"]);
  });

  it("does not backfill previous assistant attachments while current assistant is pending", () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("collects attachments for the same dialogProcessId after current dialog starts streaming", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "prev-1", owner: { type: "agent" }, name: "previous-result.md" },
    ]);
  });

  it("does not collect previous assistant attachments from a different turn scope", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-previous",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous assistant attachments when explicit turn identity is missing", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not fall back to dialogProcessId when current message has a turn scope", () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousAssistantMessage = {
      role: "assistant",
      pending: false,
      dialogProcessId: "dp-1",
      attachments: [
        { attachmentId: "prev-1", name: "previous-result.md" },
      ],
    };
    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousAssistantMessage, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous turn tool attachments for a later assistant before refresh", () => {
    const firstUser = { role: "user", dialogProcessId: "dp-first", content: "生成一张小鸟图" };
    const firstTool = {
      role: "tool",
      dialogProcessId: "dp-first",
      attachments: [
        { attachmentId: "bird-1", name: "generated_image_1.png" },
      ],
    };
    const firstAssistant = {
      role: "assistant",
      dialogProcessId: "dp-first",
      content: "小鸟图片已生成",
      attachments: [],
    };
    const secondUser = { role: "user", dialogProcessId: "dp-second", content: "你好" };
    const secondAssistant = {
      role: "assistant",
      pending: false,
      hasFirstStreamEvent: true,
      dialogProcessId: "dp-second",
      content: "你好！",
      attachments: [],
    };
    const allMessages = [firstUser, firstTool, firstAssistant, secondUser, secondAssistant];

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => secondAssistant,
      getAllMessages: () => allMessages,
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect previous session-doc tool attachments while later assistant is streaming but absent from summary", () => {
    const sessionDoc = {
      sessionId: "session-1",
      messages: [
        {
          role: "user",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          content: "生成一张小鸟图",
        },
        {
          role: "tool",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          attachments: [
            {
              attachmentId: "bird-1",
              name: "generated_image_1.png",
              turnScope: { turnScopeId: "turn-first", dialogProcessId: "dp-first" },
            },
          ],
        },
        {
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-first",
          dialogProcessId: "dp-first",
          content: "小鸟图片已生成",
        },
        {
          role: "user",
          sessionId: "session-1",
          turnScopeId: "turn-second",
          dialogProcessId: "dp-second",
          content: "测试脚本工具调用3次",
        },
      ],
    };
    const secondUser = sessionDoc.messages[3];
    const secondAssistant = {
      role: "assistant",
      pending: true,
      hasFirstStreamEvent: true,
      sessionId: "session-1",
      turnScopeId: "turn-second",
      dialogProcessId: "dp-second",
      attachments: [],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => secondAssistant,
      getAllMessages: () => [sessionDoc.messages[0], sessionDoc.messages[2], secondUser, secondAssistant],
      getSessionDocs: () => [sessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("does not collect session-doc attachments from a different session with the same turn scope", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-current",
      turnScopeId: "turn-same",
      dialogProcessId: "dp-current",
      attachments: [],
    };
    const otherSessionDoc = {
      sessionId: "session-other",
      messages: [
        {
          role: "tool",
          turnScopeId: "turn-same",
          dialogProcessId: "dp-other",
          attachments: [
            {
              attachmentId: "other-session-file",
              name: "other.png",
              turnScope: { sessionId: "session-other", turnScopeId: "turn-same" },
            },
          ],
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [otherSessionDoc],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("still collects tool attachments from the same linear turn", () => {
    const firstUser = {
      role: "user",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      content: "生成一张小鸟图",
    };
    const firstTool = {
      role: "tool",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      attachments: [
        { attachmentId: "bird-1", name: "generated_image_1.png" },
      ],
    };
    const firstAssistant = {
      role: "assistant",
      dialogProcessId: "dp-first",
      sessionId: "session-1",
      turnScopeId: "turn-first",
      content: "小鸟图片已生成",
      attachments: [],
    };
    const secondUser = {
      role: "user",
      dialogProcessId: "dp-second",
      sessionId: "session-1",
      turnScopeId: "turn-second",
      content: "你好",
    };
    const secondAssistant = {
      role: "assistant",
      dialogProcessId: "dp-second",
      sessionId: "session-1",
      turnScopeId: "turn-second",
      content: "你好！",
    };
    const allMessages = [firstUser, firstTool, firstAssistant, secondUser, secondAssistant];

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => firstAssistant,
      getAllMessages: () => allMessages,
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "bird-1", owner: { type: "agent" }, name: "generated_image_1.png" },
    ]);
  });

  it("prefers explicit attachment turnScopeId ownership over dialogProcessId fallback", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-reused",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const previousTool = {
      role: "tool",
      dialogProcessId: "dp-reused",
      turnScopeId: "turn-previous",
      attachments: [
        {
          attachmentId: "prev-explicit",
          name: "previous.png",
          turnScope: { turnScopeId: "turn-previous", dialogProcessId: "dp-reused" },
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [previousTool, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([]);
  });

  it("collects explicitly owned tool attachments for the current turn scope", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      attachments: [],
    };
    const currentTool = {
      role: "tool",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      attachments: [
        {
          attachmentId: "current-explicit",
          name: "current.png",
          turnScope: { turnScopeId: "turn-current", dialogProcessId: "dp-current" },
        },
      ],
    };

    const { displayedAttachments } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [currentTool, messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      {
        attachmentId: "current-explicit",
        owner: { type: "agent" },
        name: "current.png",
        turnScope: { turnScopeId: "turn-current", dialogProcessId: "dp-current" },
      },
    ]);
  });

  it("does not render the same file in both attachment and written-file lists when paths match", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-current",
      dialogProcessId: "dp-current",
      content: "done",
      attachments: [
        {
          attachmentId: "att-result",
          name: "result.md",
          transferFilePath: "/workspace/admin/runtime/result.md",
        },
      ],
      completedToolLogs: [
        {
          writtenFiles: [
            {
              fileName: "result.md",
              resolvedPath: "/workspace/admin/runtime/result.md",
            },
          ],
        },
      ],
    };

    const { displayedAttachments, writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(writtenFiles.value).toEqual([]);
  });

  it("does not render the same file in both lists when stable name and size match", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-current",
      dialogProcessId: "dp-current",
      content: "done",
      attachments: [
        {
          attachmentId: "att-result",
          name: "result.md",
          size: 1234,
        },
      ],
      completedToolLogs: [
        {
          writtenFiles: [
            {
              fileName: "result.md",
              resolvedPath: "/workspace/admin/runtime/other-path/result.md",
              size: 1234,
            },
          ],
        },
      ],
    };

    const { displayedAttachments, writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(writtenFiles.value).toEqual([]);
  });

  it("keeps same-name written files when there is no path or size evidence tying them to attachments", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-current",
      dialogProcessId: "dp-current",
      content: "done",
      attachments: [
        {
          attachmentId: "att-result",
          name: "result.md",
        },
      ],
      completedToolLogs: [
        {
          writtenFiles: [
            {
              fileName: "result.md",
              resolvedPath: "/workspace/admin/runtime/different/result.md",
            },
          ],
        },
      ],
    };

    const { displayedAttachments, writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("result.md");
  });

});
