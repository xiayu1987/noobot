/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { TRANSFER_REASON, TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { buildViewMessage } from "../../../../../src/modules/chat/model/messageModel.js";

describe("messageModel attachment normalization", () => {
  it("preserves the canonical parsed-result relation for office attachments", () => {
    const viewMessage = buildViewMessage(
      {
        role: "user",
        content: "",
        sessionId: "session-a",
        attachments: [
          {
            attachmentId: "source-a",
            sessionId: "session-a",
            name: "AI 体系现状概览.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1407731,
            attachmentSource: "user",
            relations: [
              {
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
              },
            ],
          },
        ],
      },
      { sessionId: "session-a", userId: "admin" },
    );

    expect(viewMessage.attachments).toHaveLength(1);
    expect(viewMessage.attachments[0]).toEqual(
      expect.objectContaining({
        attachmentId: "source-a",
        relations: [
          expect.objectContaining({
            relationType: "parsed_result",
            targetIdentity: {
              attachmentId: "parsed-a",
              sessionId: "session-a",
              attachmentSource: "model",
            },
          }),
        ],
      }),
    );
  });

  it("projects tool output attachments from message-level transfer envelopes", () => {
    const viewMessage = buildViewMessage(
      {
        role: "assistant",
        content: "",
        sessionId: "session-a",
        dialogProcessId: "dp-a",
        turnScopeId: "turn-a",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer:assistant-a:tool:call-a:output",
            presentationMessageId: "assistant-a",
            identity: {
              sessionId: "session-a",
              turnScopeId: "turn-a",
              runId: "run-a",
              producer: { type: "tool", id: "call-a" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
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
            intent: {
              source: "tool",
              reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
              scenario: "tool",
              strategy: "tool_result_text",
            },
            meta: {},
          },
        ],
        toolTimeline: [
          { tool: "execute_script", status: "completed", resultEvent: { eventId: "result-a" } },
        ],
      },
      { sessionId: "session-a", userId: "admin" },
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
