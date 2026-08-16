/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintDiagnosticMessages,
  summarizeDiagnosticMessages,
} from "../src/assembly/context-diagnostics.js";

test("context diagnostics records compact role and dialog dimensions", () => {
  const summary = summarizeDiagnosticMessages(
    [
      { role: "user", content: "u1", dialogProcessId: "d1" },
      { role: "assistant", content: "a1", dialogProcessId: "d1" },
      { role: "user", content: "u2", dialogId: "d2", summarized: true },
      { role: "system", content: "system" },
    ],
    { limit: 1 },
  );

  assert.deepEqual(summary.roles, { user: 2, assistant: 1, system: 1 });
  assert.deepEqual(summary.dialogGroups, [
    { dialogProcessId: "d1", count: 2 },
    { dialogProcessId: "d2", count: 1 },
  ]);
  assert.equal(summary.missingDialogIdCount, 1);
  assert.equal(summary.summarizedCount, 1);
  assert.equal(summary.preview.length, 1);
  assert.equal(summary.preview[0].contentLength, 2);
  assert.equal(summary.evidence.length, 4);
  assert.deepEqual(
    summary.evidence.map(({ index, role, contentLength }) => ({ index, role, contentLength })),
    [
      { index: 0, role: "user", contentLength: 2 },
      { index: 1, role: "assistant", contentLength: 2 },
      { index: 2, role: "user", contentLength: 2 },
      { index: 3, role: "system", contentLength: 6 },
    ],
  );
  assert.equal(summary.evidence[0].contentPreview, undefined);
  assert.equal(summary.truncated, 3);
  assert.equal(summary.fingerprintProtocolVersion, 2);
  assert.equal(summary.fingerprints.length, 4);
  assert.match(summary.sequenceHash, /^[a-f0-9]{64}$/);
});

test("message fingerprints cover provider content and tool protocol without key-order noise", () => {
  const first = fingerprintDiagnosticMessages([
    { role: "user", content: [{ type: "text", text: "task" }], additional_kwargs: { b: 2, a: 1 } },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", name: "read_file", args: { path: "a" } }],
    },
    { role: "tool", content: "ok", tool_call_id: "call-1", toolName: "read_file" },
  ]);
  const reorderedKeys = fingerprintDiagnosticMessages([
    { additional_kwargs: { a: 1, b: 2 }, content: [{ text: "task", type: "text" }], role: "user" },
    {
      tool_calls: [{ args: { path: "a" }, name: "read_file", id: "call-1" }],
      content: "",
      role: "assistant",
    },
    { toolName: "read_file", tool_call_id: "call-1", content: "ok", role: "tool" },
  ]);
  const changedToolArgs = fingerprintDiagnosticMessages([
    { role: "user", content: [{ type: "text", text: "task" }], additional_kwargs: { a: 1, b: 2 } },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", name: "read_file", args: { path: "b" } }],
    },
    { role: "tool", content: "ok", tool_call_id: "call-1", toolName: "read_file" },
  ]);

  assert.deepEqual(first, reorderedKeys);
  assert.notEqual(first.fingerprints[1], changedToolArgs.fingerprints[1]);
  assert.notEqual(first.sequenceHash, changedToolArgs.sequenceHash);
});

test("message fingerprints exclude runtime metadata that providers never receive", () => {
  const original = fingerprintDiagnosticMessages([
    {
      role: "user",
      content: "stable input",
      summarized: false,
      additional_kwargs: {
        noobotMessageId: "message-1",
        dialogProcessId: "dialog-1",
        injectedMessageType: "separate_model_relay:phase_acceptance",
      },
    },
  ]);
  const runtimeStateChanged = fingerprintDiagnosticMessages([
    {
      role: "user",
      content: "stable input",
      summarized: true,
      additional_kwargs: {
        noobotMessageId: "message-1",
        dialogProcessId: "dialog-1",
        injectedMessageType: "separate_model_relay:phase_acceptance",
        checkpointRevision: 2,
      },
    },
  ]);

  assert.deepEqual(original, runtimeStateChanged);
});
