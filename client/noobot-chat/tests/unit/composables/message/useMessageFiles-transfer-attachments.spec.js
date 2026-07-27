/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper.js";

describe("useMessageFiles transfer attachments", () => {
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
    const { displayedAttachments } = createMessageFiles({
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

  it("renders refreshed tool-result attachments from the canonical timeline", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      dialogProcessId: "dp-1",
      turnScopeId: "client-turn:1",
      content: "done",
      pending: false,
      completedToolLogs: [],
      toolTimeline: [
        {
          key: "call:search-1",
          toolCallId: "search-1",
          tool: "search",
          status: "completed",
          resultEvent: {
            sequence: 2,
            attachments: [
              {
                attachmentId: "attachment-1",
                name: "search.tool-result.json",
                mimeType: "application/json",
                sessionId: "session-1",
                owner: {
                  sessionId: "session-1",
                  turnScopeId: "client-turn:1",
                },
              },
            ],
            log: {
              event: "tool_result",
              type: "tool_result",
              toolCallId: "search-1",
              sessionId: "session-1",
              turnScopeId: "client-turn:1",
            },
          },
        },
      ],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "attachment-1",
      name: "search.tool-result.json",
      owner: {
        sessionId: "session-1",
        turnScopeId: "client-turn:1",
      },
    });
  });

  it("renders refreshed write-file results from the canonical timeline", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-1",
      dialogProcessId: "dp-1",
      turnScopeId: "client-turn:1",
      content: "done",
      pending: false,
      completedToolLogs: [],
      toolTimeline: [
        {
          key: "call:write-1",
          toolCallId: "write-1",
          tool: "write_file",
          status: "completed",
          resultEvent: {
            sequence: 2,
            writtenFiles: [
              {
                toolName: "write_file",
                resolvedPath: "/workspace/admin/runtime/result.txt",
                fileName: "result.txt",
                isSandbox: true,
              },
            ],
            log: {
              event: "tool_result",
              type: "tool_result",
              toolCallId: "write-1",
              sessionId: "session-1",
              turnScopeId: "client-turn:1",
            },
          },
        },
      ],
    };
    const { writtenFiles } = createMessageFiles({
      getMessageItem: () => messageItem,
    });

    expect(writtenFiles.value).toEqual([
      expect.objectContaining({
        toolName: "write_file",
        resolvedPath: "/workspace/admin/runtime/result.txt",
        relativePath: "runtime/result.txt",
        fileName: "result.txt",
        isSandbox: true,
      }),
    ]);
  });
});
