/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
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

test("snapshot reads the canonical Session artifact without read-time migration", async () =>
  withTemp(async (root) => {
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId: "legacy-transfer-session",
        aggregateVersion: 0,
        messages: [
          {
            ...canonicalMessages(
              [{ role: "assistant", presentationMessageId: "pm_fx1", content: "parsed" }],
              "legacy-transfer-session",
            )[0],
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

test("snapshot rejects a completed turn whose summary marks need canonical repair", async () =>
  withTemp(async (root) => {
    const required = createTestSessionRequiredFields();
    const turn = { dialogProcessId: "dialog-1", turnScopeId: "turn-1" };
    const messages = canonicalMessages(
      [
        { role: "user", content: "read it", ...turn },
        {
          role: "assistant",
          content: "",
          chatPresentation: false,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file" } }],
          ...turn,
        },
        { role: "tool", content: "file", tool_call_id: "call-1", toolName: "read_file", ...turn },
        { role: "assistant", content: "done", ...turn },
      ],
      "summary-marks-session",
    ).map((message) => ({ ...message, summarized: false }));
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: applySessionMessageFacts({
        ...required,
        sessionId: "summary-marks-session",
        aggregateVersion: 1,
        turnLifecycle: {
          ...required.turnLifecycle,
          turns: {
            "turn-1": {
              revision: 1,
              sequence: 1,
              ...turn,
              terminalStatus: { ...turn, status: "completed", reason: "run_completed" },
            },
          },
        },
        messages,
      }),
    });
    await assert.rejects(
      readSessionArtifactSnapshot({ outputDir: root, includeExecutionLogs: false }),
      { code: SESSION_ERROR_CODE.COMPLETION_SUMMARY_REPAIR_REQUIRED },
    );
  }));

test("snapshot rejects a missing Session artifact instead of returning null", async () =>
  withTemp(async (root) => {
    await assert.rejects(
      readSessionArtifactSnapshot({ outputDir: root, includeExecutionLogs: false }),
      { code: SESSION_ERROR_CODE.ARTIFACT_NOT_FOUND, statusCode: 404 },
    );
  }));
