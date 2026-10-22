/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  writeSessionArtifact,
  readSessionArtifactSnapshot,
} from "../../src/session/session-artifact-store.js";
import { canonicalMessages, withTemp } from "./session-artifact-store-v2.test-helpers.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";

test("snapshot reads legacy transfer reasons only after canonical Session migration", async () =>
  withTemp(async (root) => {
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId: "legacy-transfer-session",
        aggregateVersion: 0,
        messages: [
          {
            ...canonicalMessages([
              { role: "assistant", presentationMessageId: "pm_fx1", content: "parsed" },
            ])[0],
            transferEnvelopes: [
              {
                protocol: "noobot.semantic-transfer",
                version: TRANSFER_VERSION,
                transferId: "transfer:legacy-1",
                presentationMessageId: "message-legacy-1",
                identity: {
                  sessionId: "legacy-transfer-session",
                  producer: { type: "tool", id: "call-legacy" },
                },
                direction: "output",
                payload: {
                  mode: "attachment",
                  attachments: [
                    {
                      identity: {
                        attachmentId: "attachment-legacy-1",
                        sessionId: "legacy-transfer-session",
                        attachmentSource: "model",
                      },
                      role: "primary",
                      name: "parsed.md",
                      mimeType: "text/markdown",
                    },
                  ],
                },
                intent: {
                  source: "tool",
                  reason: "multimodal_parse_artifact",
                  scenario: "tool",
                  strategy: "tool_result_text",
                },
                meta: {},
              },
            ],
          },
        ],
      }),
    });
    const snapshot = await readSessionArtifactSnapshot({
      outputDir: root,
      includeExecutionLogs: false,
    });
    assert.equal(
      snapshot.sessionSummary.messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );
  }));
