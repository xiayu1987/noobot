/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper.js";

describe("useMessageFiles plugin attachments", () => {
  it("preserves explicit attachment ownership without inventing ownership for other attachments", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "att-harness-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-acceptance-report.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "att-agent-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "main-result.txt",
          mimeType: "text/plain",
        },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(
      displayedAttachments.value.find((item) => item.attachmentId === "att-harness-1"),
    ).toMatchObject({
      owner: { type: "plugin" },
    });
    expect(
      displayedAttachments.value.find((item) => item.attachmentId === "att-agent-1"),
    ).toMatchObject({
      attachmentId: "att-agent-1",
    });
    expect(
      displayedAttachments.value.find((item) => item.attachmentId === "att-agent-1"),
    ).not.toHaveProperty("owner");
  });

  it("preserves plugin owner metadata carried by the message attachments", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-plan-text.txt",
          size: 1400,
          owner: { type: "plugin", id: "harness-plugin" },
        },
        {
          attachmentId: "report-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
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

  it("does not merge conflicting duplicate records inside one ordinary attachment fact list", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "report-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-acceptance-report.txt",
          size: 5600,
        },
        {
          attachmentId: "report-1",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-acceptance-report.txt",
          size: 5600,
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value[0]).not.toHaveProperty("owner");
    expect(displayedAttachments.value[1]).toMatchObject({
      attachmentId: "report-1",
      owner: { type: "plugin", id: "harness-plugin" },
    });
  });

  it("does not infer plugin ownership from persisted harness file names without owner metadata", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "plan-current",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-plan-text.txt",
          size: 1400,
        },
        {
          attachmentId: "report-current",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-acceptance-report.txt",
          size: 5600,
        },
      ],
    };

    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [messageItem],
    });

    expect(displayedAttachments.value).toHaveLength(2);
    expect(displayedAttachments.value).toEqual([
      expect.objectContaining({ attachmentId: "plan-current" }),
      expect.objectContaining({ attachmentId: "report-current" }),
    ]);
    expect(displayedAttachments.value.every((item) => !Object.hasOwn(item, "owner"))).toBe(true);
  });

  it("does not infer plugin ownership from harness-like generationSource alone", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "att-legacy-harness-name",
          sessionId: "session-1",
          attachmentSource: "test",
          name: "harness-named-file.txt",
          mimeType: "text/plain",
          generationSource: "harness_checklist",
        },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "att-legacy-harness-name",
    });
    expect(displayedAttachments.value[0]).not.toHaveProperty("owner");
  });
});
