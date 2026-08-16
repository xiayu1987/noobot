/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper.js";

describe("useMessageFiles basic attachments", () => {
  it("keeps canonical parsed-result relations from attachments", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachments: [
        {
          attachmentId: "src-1",
          name: "source.pdf",
          sessionId: "session-1",
          attachmentSource: "user",
          relations: [
            {
              relationType: "parsed_result",
              sourceIdentity: {
                attachmentId: "src-1",
                sessionId: "session-1",
                attachmentSource: "user",
              },
              targetIdentity: {
                attachmentId: "parsed-1",
                sessionId: "session-1",
                attachmentSource: "model",
              },
              name: "source.md",
              mimeType: "text/markdown",
              createdAt: "2026-08-16T00:00:00.000Z",
            },
          ],
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
      relations: [
        expect.objectContaining({
          relationType: "parsed_result",
          targetIdentity: {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
        }),
      ],
    });
  });

  it("reads canonical message attachments", () => {
    const messageItem = {
      role: "user",
      dialogProcessId: "dp-1",
      content: "source",
      attachments: [{ attachmentId: "legacy-1", name: "legacy.pdf" }],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toEqual([{ attachmentId: "legacy-1", name: "legacy.pdf" }]);
  });
});
