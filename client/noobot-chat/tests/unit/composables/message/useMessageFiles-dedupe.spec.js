/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper";

describe("useMessageFiles dedupe", () => {
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

    const { displayedAttachments, writtenFiles } = createMessageFiles({
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

    const { displayedAttachments, writtenFiles } = createMessageFiles({
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

    const { displayedAttachments, writtenFiles } = createMessageFiles({
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
