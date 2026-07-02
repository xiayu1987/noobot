import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper";

describe("useMessageFiles harness attachments", () => {
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
    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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

    const { displayedAttachments } = createMessageFiles({
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
    const { displayedAttachments } = createMessageFiles({
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
});
