/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper";

describe("useMessageFiles basic attachments", () => {
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
    const { displayedAttachments } = createMessageFiles({
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
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([
      { attachmentId: "legacy-1", name: "legacy.pdf" },
    ]);
  });
});
