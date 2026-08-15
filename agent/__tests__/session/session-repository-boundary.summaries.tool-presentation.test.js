/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */


import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";

test("session summary projects attachment identities without object stringification", () => {
  const attachmentIdentity = {
    attachmentId: "att-summary-1",
    sessionId: "summary-session",
    attachmentSource: "model",
  };
  const summary = buildSessionDisplaySummary({
    sessionId: "summary-session",
    messages: [
      {
        id: "assistant-1",
        messageId: "assistant-1",
        messageUid: "sm-summary-1",
        presentationMessageId: "assistant-1",
        dialogProcessId: "dialog-summary-1",
        role: "assistant",
        type: "message",
        content: "done",
        chatPresentation: true,
        turnScopeId: "turn-1",
        toolTimeline: [
          {
            key: "call:read-1",
            toolCallId: "read-1",
            tool: "read_file",
            status: "completed",
            args: { filePath: attachmentIdentity },
            result: JSON.stringify({
              toolName: "read_file",
              ok: true,
              path: { view: "attachment", identity: attachmentIdentity },
              fileName: "report.json",
            }),
            call: { eventId: "call-event" },
            resultEvent: { eventId: "result-event" },
          },
        ],
      },
    ],
  });

  const timeline = summary.messages[0].toolTimeline[0];
  assert.equal(timeline.call.summary, "read_file · attachment:att-summary-1");
  assert.equal(timeline.resultEvent.summary, "read_file · attachment:att-summary-1");
  assert.doesNotMatch(JSON.stringify(timeline), /\[object Object\]/);
});

test("session summary uses the canonical tool presentation protocol", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "tool-summary-session",
    messages: [
      {
        id: "assistant-tool-summary",
        messageId: "assistant-tool-summary",
        messageUid: "sm-tool-summary",
        presentationMessageId: "assistant-tool-summary",
        dialogProcessId: "dialog-tool-summary",
        role: "assistant",
        type: "message",
        content: "done",
        chatPresentation: true,
        turnScopeId: "turn-tool-summary",
        toolTimeline: [
          {
            key: "call:patch-1",
            toolCallId: "patch-1",
            tool: "patch_file",
            status: "completed",
            args: { format: "apply_patch", dryRun: true, patch: "*** Begin Patch" },
            result: JSON.stringify({
              ok: true,
              dryRun: true,
              changes: [{ path: { view: "workspace", path: "src/index.js" } }],
            }),
            call: { eventId: "patch-call-event" },
            resultEvent: { eventId: "patch-result-event" },
          },
          {
            key: "call:native-1",
            toolCallId: "native-1",
            tool: "execute_native_script",
            status: "completed",
            args: { inputs: [{ source: "src/index.js" }], arguments: { phase: "probe" } },
            result: JSON.stringify({
              ok: true,
              output_file_count: 1,
              output_bytes: 10,
              transferEnvelopes: [{ payload: { attachments: [{ name: "result.txt" }] } }],
            }),
            call: { eventId: "native-call-event" },
            resultEvent: { eventId: "native-result-event" },
          },
        ],
      },
    ],
  });

  const [patch, native] = summary.messages[0].toolTimeline;
  assert.equal(patch.call.summary, "patch_file · apply_patch · dry-run");
  assert.equal(patch.resultEvent.summary, "patch_file · src/index.js · dry-run");
  assert.equal(native.call.summary, "execute_native_script · 1 input · phase=probe");
  assert.equal(native.resultEvent.summary, "execute_native_script · result.txt · 10 B");
});

