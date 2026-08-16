/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage } from "../../../../../src/modules/chat/model/messageModel.js";

describe("messageModel attachment normalization", () => {
  it("preserves the canonical parsed-result relation for office attachments", () => {
    const viewMessage = buildViewMessage(
      {
        role: "user",
        sessionId: "session-a",
        attachments: [
          {
            attachmentId: "source-a",
            sessionId: "session-a",
            name: "AI 体系现状概览.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1407731,
            attachmentSource: "user",
            relations: [{
              relationType: "parsed_result",
              sourceIdentity: {
                attachmentId: "source-a",
                sessionId: "session-a",
                attachmentSource: "user",
              },
              targetIdentity: {
                attachmentId: "parsed-a",
                sessionId: "session-a",
                attachmentSource: "model",
              },
              name: "parsed-a.md",
              mimeType: "text/markdown",
              createdAt: "2026-01-01T00:00:00.000Z",
            }],
          },
        ],
      },
      { userId: "admin" },
    );

    expect(viewMessage.attachments).toHaveLength(1);
    expect(viewMessage.attachments[0]).toEqual(
      expect.objectContaining({
        attachmentId: "source-a",
        relations: [expect.objectContaining({
          relationType: "parsed_result",
          targetIdentity: {
            attachmentId: "parsed-a",
            sessionId: "session-a",
            attachmentSource: "model",
          },
        })],
      }),
    );
  });

  it("projects canonical tool result attachments that carry protocol nested identity", () => {
    const viewMessage = buildViewMessage(
      {
        role: "assistant",
        sessionId: "session-a",
        dialogProcessId: "dp-a",
        turnScopeId: "turn-a",
        toolTimeline: [
          {
            tool: "write_file",
            status: "completed",
            resultEvent: {
              attachments: [
                {
                  identity: {
                    attachmentId: "generated-a",
                    sessionId: "session-a",
                    attachmentSource: "model",
                  },
                  role: "primary",
                  name: "case036.txt",
                  mimeType: "text/plain",
                  size: 20,
                },
              ],
            },
          },
        ],
      },
      { userId: "admin" },
    );

    expect(viewMessage.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "generated-a",
        sessionId: "session-a",
        attachmentSource: "model",
        name: "case036.txt",
        mimeType: "text/plain",
        size: 20,
      }),
    ]);
  });
});
