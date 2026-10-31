/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper.js";
import { collectSessionAttachments } from "../../../../../../src/modules/chat/composables/message/useMessageFiles.js";

describe("useMessageFiles basic attachments", () => {
  it("collects a pending upload with preceding canonical assistant attachments", () => {
    const canonical = {
      attachmentId: "result-1",
      sessionId: "session-1",
      attachmentSource: "model",
      name: "result.txt",
    };
    const draft = { clientAttachmentId: "draft-1", name: "upload.txt" };
    const assistant = {
      role: "assistant",
      sessionId: "session-1",
      presentationMessageId: "pm-1",
      attachments: [canonical],
    };
    const user = {
      role: "user",
      sessionId: "session-1",
      userMessageId: "um-1",
      attachments: [draft],
    };
    const allMessages = [assistant, user];
    expect(collectSessionAttachments(allMessages, user, [draft])).toEqual([canonical, draft]);
    const persisted = {
      ...draft,
      attachmentId: "upload-1",
      sessionId: "session-1",
      attachmentSource: "user",
    };
    expect(collectSessionAttachments(allMessages, user, [persisted])).toEqual([
      canonical,
      persisted,
    ]);
    expect(() => collectSessionAttachments(allMessages, user, [{ name: "invalid.txt" }])).toThrow(
      "invalid_attachment_id",
    );
  });

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
    });

    expect(displayedAttachments.value).toEqual([{ attachmentId: "legacy-1", name: "legacy.pdf" }]);
  });
});
