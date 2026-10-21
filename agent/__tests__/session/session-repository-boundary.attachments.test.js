/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  readSessionArtifact,
  writeSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import {
  buildSessionDisplaySummary,
  SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
} from "../../src/session/session-summary-builders.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("session display summary should keep canonical attachment fields", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "s-attachments",
    aggregateVersion: 0,
    messages: [
      {
        role: "assistant",
        content: "canonical attachment",
        chatPresentation: true,
        messageId: "assistant-canonical",
        presentationMessageId: "assistant-canonical",
        turnScopeId: "turn-canonical",
        attachments: [
          {
            attachmentId: "att-canonical",
            sessionId: "s-attachments",
            attachmentSource: "model",
            name: "canonical.txt",
            mimeType: "text/plain",
          },
        ],
      },
    ],
  });

  assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(summary.messages[0].attachments[0].attachmentId, "att-canonical");
  assert.equal(summary.messages[0].attachments[0].name, "canonical.txt");
  assert.equal(summary.stats.attachmentCount, 1);
});

test("session display summary keeps rich attachment fields for preview and parsed result", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "s-rich-attachments",
    aggregateVersion: 0,
    messages: [
      {
        role: "user",
        content: "rich attachment",
        attachments: [
          {
            attachmentId: "att-rich",
            name: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 123,
            sessionId: "s-rich-attachments",
            attachmentSource: "user",
            path: "/workspace/report.docx",
            relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
            sandboxPath: "/sandbox/report.docx",
            previewUrl: "/api/attachments/att-rich/preview",
            downloadUrl: "/api/attachments/att-rich/download",
            relations: [
              {
                relationType: "parsed_result",
                sourceIdentity: {
                  attachmentId: "att-rich",
                  sessionId: "s-rich-attachments",
                  attachmentSource: "user",
                },
                targetIdentity: {
                  attachmentId: "att-parsed",
                  sessionId: "s-rich-attachments",
                  attachmentSource: "model",
                },
                name: "report.md",
                mimeType: "text/markdown",
                createdAt: "2026-08-16T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(summary.messages[0].attachments[0], {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    attachmentSource: "user",
    sessionId: "s-rich-attachments",
    relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
    sandboxPath: "/sandbox/report.docx",
    path: "/workspace/report.docx",
    relations: [
      {
        relationType: "parsed_result",
        sourceIdentity: {
          attachmentId: "att-rich",
          sessionId: "s-rich-attachments",
          attachmentSource: "user",
        },
        targetIdentity: {
          attachmentId: "att-parsed",
          sessionId: "s-rich-attachments",
          attachmentSource: "model",
        },
        name: "report.md",
        mimeType: "text/markdown",
        createdAt: "2026-08-16T00:00:00.000Z",
      },
    ],
    downloadUrl: "/api/attachments/att-rich/download",
    previewUrl: "/api/attachments/att-rich/preview",
  });
});

test("session display summary derives attachments from transfer envelopes", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "s-transfer-attachments",
    aggregateVersion: 0,
    messages: [
      {
        role: "assistant",
        content: "transfer only attachment",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId:
              "transfer:message-transfer-attachments:plugin:harness-plugin:output:tool_result_text:structured",
            presentationMessageId: "message-transfer-attachments",
            identity: {
              sessionId: "s-transfer-attachments",
              turnScopeId: "turn-transfer-attachments",
              runId: "run-transfer-attachments",
              producer: { type: "plugin", id: "harness-plugin" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: {
                    attachmentId: "att-transfer-1",
                    sessionId: "s-transfer-attachments",
                    attachmentSource: "model",
                  },
                  role: "primary",
                  name: "result.md",
                  mimeType: "text/markdown",
                  size: 44,
                },
              ],
            },
            intent: {
              source: "plugin",
              reason: "semantic_transfer_tool_result",
              scenario: "tool",
              strategy: "tool_result_text",
            },
            meta: { persisted: true },
          },
        ],
      },
    ],
  });

  assert.equal(summary.stats.attachmentCount, 1);
  assert.equal(summary.messages[0].attachments, undefined);
  assert.equal(
    summary.messages[0].transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att-transfer-1",
  );
});

test("session display summary binds completed tool artifacts to one explicit assistant turn", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "s-tool-artifacts",
    aggregateVersion: 0,
    messages: [
      {
        messageId: "assistant-one",
        role: "assistant",
        content: "first result",
        turnScopeId: "turn-one",
        dialogProcessId: "dialog-one",
        toolTimeline: [
          {
            key: "call:call-one",
            toolCallId: "call-one",
            tool: "execute_script",
            status: "completed",
            resultEvent: { eventId: "event-one" },
          },
        ],
      },
      {
        messageId: "assistant-two",
        role: "assistant",
        content: "second result",
        turnScopeId: "turn-two",
        dialogProcessId: "dialog-two",
      },
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call-one",
        toolName: "execute_script",
        ts: "2026-01-01T00:00:00.000Z",
        turnScopeId: "turn-one",
        dialogProcessId: "dialog-one",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer:assistant-one:tool:call-one:output:tool_result_text:artifact",
            presentationMessageId: "assistant-one",
            identity: {
              sessionId: "s-tool-artifacts",
              turnScopeId: "turn-one",
              runId: "run-one",
              producer: { type: "tool", id: "call-one" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: {
                    attachmentId: "artifact-one",
                    sessionId: "s-tool-artifacts",
                    attachmentSource: "tool",
                  },
                  role: "primary",
                  name: "stdout.txt",
                  mimeType: "text/plain",
                },
              ],
            },
            intent: {
              source: "tool",
              reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
              scenario: "tool",
              strategy: "tool_result_text",
            },
            meta: { persisted: true },
          },
        ],
      },
    ],
  });

  const first = summary.messages.find((item) => item.messageId === "assistant-one");
  const second = summary.messages.find((item) => item.messageId === "assistant-two");
  assert.equal("toolLogSummaries" in summary, false);
  assert.equal(first.toolTimeline.length, 1);
  assert.equal(
    first.toolTimeline[0].resultEvent.attachments[0].identity.attachmentId,
    "artifact-one",
  );
  assert.equal("writtenFiles" in first.toolTimeline[0].resultEvent, false);
  assert.equal(first.toolTimeline[0].tool, "execute_script");
  assert.equal(first.toolTimeline[0].resultEvent.timestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(second.toolTimeline, undefined);
  assert.equal(summary.stats.displayToolLogCount, 1);
  assert.equal(summary.stats.unassignedToolArtifactCount, 0);
  assert.equal(summary.stats.attachmentCount, 1);
});

test("session display summary does not guess ownership for an unmatched tool artifact turn", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "s-unmatched-artifact",
    aggregateVersion: 0,
    messages: [
      {
        id: "assistant-one",
        role: "assistant",
        content: "first result",
        turnScopeId: "turn-one",
        dialogProcessId: "dialog-one",
      },
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call-other",
        turnScopeId: "turn-other",
        dialogProcessId: "dialog-other",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer:other:tool:call-other:output:tool_result_text:artifact",
            presentationMessageId: "other",
            identity: {
              sessionId: "s-unmatched-artifact",
              turnScopeId: "turn-other",
              runId: "run-other",
              producer: { type: "tool", id: "call-other" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: {
                    attachmentId: "artifact-other",
                    sessionId: "s-unmatched-artifact",
                    attachmentSource: "tool",
                  },
                  role: "primary",
                  name: "other.txt",
                  mimeType: "text/plain",
                },
              ],
            },
            intent: {
              source: "tool",
              reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
              scenario: "tool",
              strategy: "tool_result_text",
            },
            meta: { persisted: true },
          },
        ],
      },
    ],
  });

  assert.equal(summary.messages[0].toolTimeline, undefined);
  assert.equal(summary.stats.displayToolLogCount, 0);
  assert.equal(summary.stats.unassignedToolArtifactCount, 1);
  assert.equal(summary.stats.attachmentCount, 0);
});

test("session artifact persistence should normalize attachment fields before writing", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sessionDir = path.join(workspaceRoot, "u1", "runtime", "session", "s-attachments");
    await writeSessionArtifact({
      sessionDir,
      depth: 1,
      now: () => "2026-05-14T00:00:00.000Z",
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId: "s-attachments",
        aggregateVersion: 0,
        caller: SESSION_CALLER.USER,
        messages: [
          {
            messageUid: "sm_attachment_user",
            role: "user",
            content: "canonical survives",
            dialogProcessId: "dialog-attachments",
            turnScopeId: "turn-attachments",
            attachments: [
              {
                attachmentId: "att-canonical",
                sessionId: "s-attachments",
                attachmentSource: "user",
                name: "canonical.txt",
                mimeType: "text/plain",
              },
            ],
            attachmentMetas: [{ attachmentId: "att-legacy-meta" }],
            attachment_metas: [{ attachmentId: "att-legacy-snake" }],
          },
          {
            messageUid: "sm_attachment_assistant",
            role: "assistant",
            content: "legacy only is ignored",
            dialogProcessId: "dialog-attachments",
            turnScopeId: "turn-attachments",
            attachmentMetas: [{ attachmentId: "att-legacy-only" }],
            attachment_metas: [{ attachmentId: "att-legacy-only-snake" }],
          },
        ],
      }),
    });

    const persistedSession = await readSessionArtifact({ sessionDir });
    const persistedSummary = buildSessionDisplaySummary(persistedSession);
    const sessionJson = JSON.stringify(persistedSession);
    const summaryJson = JSON.stringify(persistedSummary);

    assert.equal(persistedSession.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSession.messages[1], false);
    assert.equal(sessionJson.includes("attachmentMetas"), false);
    assert.equal(sessionJson.includes("attachment_metas"), false);
    assert.equal(persistedSummary.depth, undefined);
    assert.equal(persistedSummary.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSummary.messages[1], false);
    assert.equal(summaryJson.includes("attachmentMetas"), false);
    assert.equal(summaryJson.includes("attachment_metas"), false);
  });
});
