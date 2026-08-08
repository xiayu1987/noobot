/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../src/session/index.js";
import { readSessionArtifact, writeSessionArtifact } from "../../src/session/session-artifact-store.js";
import {
  buildSessionDisplaySummary,
  SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
} from "../../src/session/session-summary-builders.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "noobot-session-boundary-"),
  );
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("session display summary should keep canonical attachment fields", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-attachments",
    messages: [
      {
        role: "assistant",
        content: "canonical attachment",
        chatPresentation: true,
        messageId: "assistant-canonical",
        presentationMessageId: "assistant-canonical",
        turnScopeId: "turn-canonical",
        attachments: [{ attachmentId: "att-canonical", name: "canonical.txt", mimeType: "text/plain" }],
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
    sessionId: "s-rich-attachments",
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
            parsedResult: {
              attachmentId: "att-parsed",
              name: "report.md",
              mimeType: "text/markdown",
              path: "/workspace/report.md",
              relativePath: "runtime/attach/s-rich-attachments/model/report.md",
            },
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
    parsedResult: {
      attachmentId: "att-parsed",
      name: "report.md",
      path: "/workspace/report.md",
      relativePath: "runtime/attach/s-rich-attachments/model/report.md",
      mimeType: "text/markdown",
    },
    downloadUrl: "/api/attachments/att-rich/download",
    previewUrl: "/api/attachments/att-rich/preview",
  });
});

test("session display summary derives attachments from transfer envelopes", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-transfer-attachments",
    messages: [
      {
        role: "assistant",
        content: "transfer only attachment",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: 2,
            transferId: "transfer:message-transfer-attachments:plugin:harness-plugin:output:tool_result_text:structured",
            messageId: "message-transfer-attachments",
            identity: {
              sessionId: "s-transfer-attachments",
              turnScopeId: "turn-transfer-attachments",
              runId: "run-transfer-attachments",
              producer: { type: "plugin", id: "harness-plugin" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [{
                identity: {
                  attachmentId: "att-transfer-1",
                  sessionId: "s-transfer-attachments",
                  attachmentSource: "model",
                },
                role: "primary",
                name: "result.md",
                mimeType: "text/markdown",
                size: 44,
              }],
            },
            intent: { source: "plugin", reason: "semantic_transfer_tool_result", scenario: "tool", strategy: "tool_result_text" },
            meta: { persisted: true },
          },
        ],
      },
    ],
  });

  assert.equal(summary.stats.attachmentCount, 1);
  assert.equal(summary.messages[0].attachments, undefined);
  assert.equal(summary.messages[0].transferEnvelopes[0].payload.attachments[0].identity.attachmentId, "att-transfer-1");
});

test("session display summary binds completed tool artifacts to one explicit assistant turn", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-tool-artifacts",
    messages: [
      {
        id: "assistant-one",
        role: "assistant",
        content: "first result",
        turnScopeId: "turn-one",
        dialogProcessId: "dialog-one",
        toolTimeline: [{
          key: "call:call-one",
          toolCallId: "call-one",
          tool: "execute_script",
          status: "completed",
          resultEvent: {
            eventId: "event-one",
            transferEnvelopes: [{
              protocol: "noobot.semantic-transfer", version: 2,
              transferId: "transfer:assistant-one:tool:call-one:output:tool_result_text:artifact",
              messageId: "assistant-one",
              identity: { sessionId: "s-tool-artifacts", turnScopeId: "turn-one", runId: "run-one", producer: { type: "tool", id: "call-one" } },
              direction: "output",
              payload: { mode: "attachment", attachments: [{ identity: { attachmentId: "artifact-one", sessionId: "s-tool-artifacts", attachmentSource: "tool" }, role: "primary", name: "stdout.txt", mimeType: "text/plain" }] },
              intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_result_text" }, meta: { persisted: true },
            }],
          },
        }],
      },
      {
        id: "assistant-two",
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
        turnScopeId: "turn-one",
        dialogProcessId: "dialog-one",
        transferEnvelopes: [{
          protocol: "noobot.semantic-transfer", version: 2,
          transferId: "transfer:assistant-one:tool:call-one:output:tool_result_text:artifact",
          messageId: "assistant-one",
          identity: { sessionId: "s-tool-artifacts", turnScopeId: "turn-one", runId: "run-one", producer: { type: "tool", id: "call-one" } },
          direction: "output",
          payload: { mode: "attachment", attachments: [{ identity: { attachmentId: "artifact-one", sessionId: "s-tool-artifacts", attachmentSource: "tool" }, role: "primary", name: "stdout.txt", mimeType: "text/plain" }] },
          intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_result_text" }, meta: { persisted: true },
        }],
      },
    ],
  });

  const first = summary.messages.find((item) => item.id === "assistant-one");
  const second = summary.messages.find((item) => item.id === "assistant-two");
  assert.equal("toolLogSummaries" in summary, false);
  assert.equal(first.toolTimeline.length, 1);
  assert.equal(first.toolTimeline[0].resultEvent.attachments[0].identity.attachmentId, "artifact-one");
  assert.equal("writtenFiles" in first.toolTimeline[0].resultEvent, false);
  assert.equal(second.toolTimeline, undefined);
  assert.equal(summary.stats.displayToolLogCount, 1);
  assert.equal(summary.stats.unassignedToolArtifactCount, 0);
  assert.equal(summary.stats.attachmentCount, 1);
});

test("session display summary does not guess ownership for an unmatched tool artifact turn", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-unmatched-artifact",
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
        transferEnvelopes: [{
          protocol: "noobot.semantic-transfer", version: 2,
          transferId: "transfer:other:tool:call-other:output:tool_result_text:artifact",
          messageId: "other", identity: { sessionId: "s-unmatched-artifact", turnScopeId: "turn-other", runId: "run-other", producer: { type: "tool", id: "call-other" } },
          direction: "output",
          payload: { mode: "attachment", attachments: [{ identity: { attachmentId: "artifact-other", sessionId: "s-unmatched-artifact", attachmentSource: "tool" }, role: "primary", name: "other.txt", mimeType: "text/plain" }] },
          intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_result_text" }, meta: { persisted: true },
        }],
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
    const result = await writeSessionArtifact({
      sessionDir,
      depth: 1,
      now: () => "2026-05-14T00:00:00.000Z",
      sessionPayload: {
        sessionId: "s-attachments",
        caller: "user",
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
      },
    });

    const persistedSession = await readSessionArtifact({ sessionDir });
    const persistedSummary = JSON.parse(await readFile(result.files.sessionSummary, "utf8"));
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
