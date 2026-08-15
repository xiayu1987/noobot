/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage } from "../../../../../src/modules/chat/model/messageModel.js";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 2,
  transferId: "transfer-model-1",
  messageId: "message-model-1",
  identity: {
    sessionId: "test-session",
    turnScopeId: "turn-1",
    runId: "run-1",
    producer: { type: "tool", id: "call-1" },
  },
  direction: "output",
  payload: {
    mode: "attachment",
    attachments: [
      {
        identity: { attachmentId: "att-1", sessionId: "test-session", attachmentSource: "test" },
        role: "primary",
        name: "report.md",
        mimeType: "text/markdown",
      },
    ],
  },
  intent: {
    source: "tool",
    reason: "semantic_transfer_tool_result",
    scenario: "tool",
    strategy: "tool_result_text",
  },
  meta: { persisted: true },
};

describe("messageModel attachments and semantic transfer", () => {
  it("projects attachment identity from its owning message before live updates", () => {
    const message = buildViewMessage({
      role: "user",
      sessionId: "session-1",
      attachments: [
        {
          attachmentId: "source-att",
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
    });

    expect(message.attachments[0]).toMatchObject({
      attachmentId: "source-att",
      sessionId: "session-1",
      attachmentSource: "user",
    });
  });

  it("projects ordinary attachments independently from semantic transfer envelopes", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      attachments: [
        {
          attachmentId: "ordinary-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "input.md",
          mimeType: "text/plain",
        },
      ],
      transferEnvelopes: [envelope],
    });
    expect(message.transferEnvelopes).toHaveLength(1);
    expect(message.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attachmentId: "ordinary-1", name: "input.md" }),
        expect.objectContaining({ attachmentId: "att-1", name: "report.md" }),
      ]),
    );
  });

  it("restores V2 transfer attachment identity after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done after refresh",
      transferEnvelopes: [envelope],
    });
    expect(message.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-1",
        name: "report.md",
        sessionId: "test-session",
      }),
    ]);
  });

  it("rejects path-based transfer payloads without rebuilding an attachment", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      transferEnvelopes: [{ ...envelope, filePath: "/legacy/result.md" }],
    });
    expect(message.transferEnvelopes).toEqual([]);
    expect(message.attachments).toEqual([]);
  });

  it("normalizes parsed result metadata from attachments", () => {
    const message = buildViewMessage(
      {
        role: "user",
        content: "source",
        attachments: [
          {
            attachmentId: "src-1",
            sessionId: "s1",
            attachmentSource: "test",
            name: "source.pdf",
            mimeType: "application/pdf",
            parsedResult: {
              attachmentId: "parsed-1",
              sessionId: "s1",
              attachmentSource: "test",
              relativePath: "runtime/attach/parsed/source.md",
            },
          },
        ],
      },
      { userId: "admin" },
    );

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "src-1",
      parsedResult: {
        attachmentId: "parsed-1",
        relativePath: "runtime/attach/parsed/source.md",
      },
      parsedResultName: "source.md",
    });
    expect(message.attachments[0].parsedResultUrl).toContain("parsed-1");
  });

  it("normalizes attachment url from compatible id/session/source fields", () => {
    const message = buildViewMessage(
      {
        role: "assistant",
        content: "generated file",
        attachments: [
          {
            id: "att-alias-1",
            name: "result.md",
            session_id: "session-1",
            source: "model",
          },
        ],
      },
      { userId: "admin" },
    );

    expect(message.attachments[0]).toMatchObject({
      attachmentId: "att-alias-1",
      sessionId: "session-1",
      attachmentSource: "model",
    });
    expect(message.attachments[0].url).toBe(
      "/api/internal/attachment/admin/att-alias-1?sessionId=session-1&attachmentSource=model",
    );
  });

  it("keeps canonical attachments after refresh", () => {
    const message = buildViewMessage({
      role: "user",
      content: "source",
      attachments: [
        {
          attachmentId: "legacy-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "legacy.pdf",
        },
      ],
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      attachmentId: "legacy-1",
      name: "legacy.pdf",
    });
  });

  it("does not restore attachment metadata from legacy snake_case attachment_metas", () => {
    const message = buildViewMessage({
      role: "user",
      content: "source",
      attachment_metas: [
        {
          attachmentId: "snake-1",
          sessionId: "s1",
          attachmentSource: "test",
          name: "snake.pdf",
        },
      ],
    });

    expect(message.attachments).toEqual([]);
  });

});
