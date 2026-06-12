/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCapabilityModelMessages } from "../src/capabilities/handlers/shared/model/utils.js";
import { invokeWithReasoningRetry } from "../src/capabilities/handlers/shared/model/invocation-utils.js";
import { buildModelMessagesWithStructuredEnvelope } from "../src/capabilities/handlers/shared/message/utils.js";
import { buildHarnessInjectedMessage } from "../src/capabilities/handlers/shared/message/injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "../src/capabilities/handlers/shared/runtime/dialog-process-id.js";

test("resolveCapabilityModelMessages respects empty array from resolver", () => {
  const result = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [],
      },
    },
    {
      messages: [{ role: "user", content: "should-not-fallback" }],
    },
  );
  assert.deepEqual(result, []);
});

test("buildHarnessInjectedMessage includes dialogProcessId when provided", () => {
  const message = buildHarnessInjectedMessage("relay text", {
    dialogProcessId: "dlg_1",
  });
  assert.equal(message.role, "system");
  assert.equal(message.injectedMessage, true);
  assert.equal(message.injectedBy, "harness-plugin");
  assert.equal(message.dialogProcessId, "dlg_1");
});

test("resolveDialogProcessIdFromContext reads nested execution dialogProcessId", () => {
  const dialogProcessId = resolveDialogProcessIdFromContext({
    agentContext: {
      execution: {
        dialogProcessId: "dlg_nested",
      },
    },
  });
  assert.equal(dialogProcessId, "dlg_nested");
});


test("resolveCapabilityModelMessages filters summarized messages from fallback and resolver", () => {
  const fallback = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "user", content: "keep" },
        { role: "assistant", content: "drop", summarized: true },
      ],
    },
  );
  assert.deepEqual(fallback.map((item) => item.content), ["keep"]);

  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [
          { role: "user", content: "keep-resolved" },
          { role: "assistant", content: "drop-resolved", lc_kwargs: { summarized: true } },
        ],
      },
    },
    { messages: [{ role: "user", content: "ignored" }] },
  );
  assert.deepEqual(resolved.map((item) => item.content), ["keep-resolved"]);
});

test("buildModelMessagesWithStructuredEnvelope filters summarized agent messages", () => {
  const output = buildModelMessagesWithStructuredEnvelope({
    locale: "zh-CN",
    agentMessages: [
      { role: "user", content: "keep" },
      { role: "assistant", content: "drop", summarized: true },
    ],
    task: "task",
  });

  assert.match(output[0].content, /keep/);
  assert.doesNotMatch(output[0].content, /drop/);
});

test("invokeWithReasoningRetry filters summarized messages before invoking capability model", async () => {
  let capturedMessages = null;
  const response = await invokeWithReasoningRetry({
    invoker: async ({ messages = [] } = {}) => {
      capturedMessages = messages;
      return { content: "ok" };
    },
    invokePayload: {
      messages: [
        { role: "user", content: "keep" },
        { role: "assistant", content: "drop", summarized: true },
      ],
    },
  });

  assert.equal(response.content, "ok");
  assert.deepEqual(capturedMessages.map((item) => item.content), ["keep"]);
});


test("resolveCapabilityModelMessages clips capability context window to latest 10 after filtering", () => {
  const result = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "assistant", content: "drop", summarized: true },
        ...Array.from({ length: 12 }, (_, index) => ({
          role: "user",
          content: `m${index + 1}`,
        })),
      ],
    },
  );

  assert.deepEqual(
    result.map((item) => item.content),
    ["m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"],
  );
});

test("buildModelMessagesWithStructuredEnvelope clips agent context to latest 10", () => {
  const output = buildModelMessagesWithStructuredEnvelope({
    locale: "zh-CN",
    agentMessages: Array.from({ length: 12 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
    })),
    task: "task",
  });

  const jsonText = String(output[0].content || "").match(/```json\n([\s\S]*?)\n```/)?.[1] || "[]";
  const agentContext = JSON.parse(jsonText);
  assert.deepEqual(
    agentContext.map((item) => item.content),
    ["m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"],
  );
  assert.equal(output.at(-1).content, "task");
});
