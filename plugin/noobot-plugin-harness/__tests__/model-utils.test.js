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


test("resolveCapabilityModelMessages preserves fallback messages and trusts injected resolver output", () => {
  const fallback = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "user", content: "keep" },
        { role: "assistant", content: "drop", summarized: true },
      ],
    },
  );
  assert.deepEqual(fallback.map((item) => item.content), ["keep", "drop"]);

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
  assert.deepEqual(resolved.map((item) => item.content), ["keep-resolved", "drop-resolved"]);
});

test("resolveCapabilityModelMessages lets injected resolver use messageBlocks when messages are not explicit", () => {
  let capturedPayload = null;
  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: (payload = {}) => {
          capturedPayload = payload;
          return [
            ...(payload.ctx?.messageBlocks?.history || []),
            ...(payload.ctx?.messageBlocks?.incremental || []),
          ];
        },
      },
    },
    {
      ctx: {
        messages: [{ role: "user", content: "history-only" }],
        messageBlocks: {
          history: [{ role: "user", content: "history-from-block" }],
          incremental: [{ role: "assistant", content: "incremental-from-block" }],
        },
      },
      purpose: "phase_acceptance",
    },
  );

  assert.deepEqual(capturedPayload.messages, []);
  assert.deepEqual(resolved.map((item) => item.content), [
    "history-from-block",
    "incremental-from-block",
  ]);
});

test("buildModelMessagesWithStructuredEnvelope preserves provided agent messages without plugin-side filtering", () => {
  const output = buildModelMessagesWithStructuredEnvelope({
    locale: "zh-CN",
    agentMessages: [
      { role: "user", content: "keep" },
      { role: "assistant", content: "drop", summarized: true },
    ],
    task: "task",
  });

  assert.match(output[0].content, /keep/);
  assert.match(output[0].content, /drop/);
});

test("invokeWithReasoningRetry preserves provided messages before invoking capability model", async () => {
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
  assert.deepEqual(capturedMessages.map((item) => item.content), ["keep", "drop"]);
});


test("resolveCapabilityModelMessages fallback preserves messages without filtering or clipping", () => {
  const result = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "assistant", content: "drop", summarized: true },
        ...Array.from({ length: 22 }, (_, index) => ({
          role: "user",
          content: `m${index + 1}`,
        })),
      ],
    },
  );

  assert.deepEqual(
    result.map((item) => item.content),
    ["drop", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22"],
  );
});

test("buildModelMessagesWithStructuredEnvelope does not clip agent context in plugin structured envelope", () => {
  const output = buildModelMessagesWithStructuredEnvelope({
    locale: "zh-CN",
    agentMessages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
    })),
    task: "task",
  });

  const jsonText = String(output[0].content || "").match(/```json\n([\s\S]*?)\n```/)?.[1] || "[]";
  const agentContext = JSON.parse(jsonText);
  assert.deepEqual(
    agentContext.map((item) => item.content),
    ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22"],
  );
  assert.equal(output.at(-1).content, "task");
});
