/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function historicalMultimodalParseEnvelope(overrides = {}) {
  return {
    protocol: "noobot.semantic-transfer",
    version: 3,
    transferId: "transfer:multimodal-parse-1",
    presentationMessageId: "msg_presentation-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: {
            attachmentId: "attachment-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
          role: "primary",
          name: "result.multimodal-parse.multimodal_model.md",
          mimeType: "text/markdown",
          size: 10,
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "multimodal_parse_tool",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true, attributes: { mode: "multimodal_model" } },
    ...overrides,
  };
}
