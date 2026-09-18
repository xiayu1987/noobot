/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildSessionArtifactFileMap,
  persistSessionArtifactSnapshot,
  readSessionArtifactSnapshot,
} from "../../src/session/session-artifact-store.js";
import { canonicalMessages, withTemp } from "./session-artifact-store-v2.test-helpers.js";

test("snapshot reads legacy transfer reasons only after canonical Session migration", async () =>
  withTemp(async (root) => {
    await persistSessionArtifactSnapshot({
      outputDir: root,
      sessionPayload: {
        sessionId: "legacy-transfer-session",
        messages: [
          {
            ...canonicalMessages([{ role: "assistant", content: "parsed" }])[0],
            transferEnvelopes: [
              {
                protocol: "noobot.semantic-transfer",
                version: 2,
                transferId: "transfer:legacy-1",
                messageId: "message-legacy-1",
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
      },
    });
    const files = buildSessionArtifactFileMap(root);
    const summary = JSON.parse(await readFile(files.sessionSummary, "utf8"));
    summary.messages[0].transferEnvelopes[0].intent.reason = "multimodal_parse_tool";
    await writeFile(files.sessionSummary, JSON.stringify(summary), "utf8");
    const snapshot = await readSessionArtifactSnapshot({
      outputDir: root,
      includeExecutionLogs: false,
    });
    assert.equal(
      snapshot.sessionSummary.messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );
  }));
