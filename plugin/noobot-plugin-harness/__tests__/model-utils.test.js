/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCapabilityModelMessages } from "../src/capabilities/handlers/shared/model/utils.js";
import { invokeWithReasoningRetry } from "../src/capabilities/handlers/shared/model/invocation-utils.js";
import {
  clearIncrementalCapabilityMessageCacheForContext,
  resolveIncrementalCapabilityMessages,
} from "../src/capabilities/handlers/shared/model/incremental-message-cache.js";
import { buildCapabilityModelMessages } from "../src/capabilities/handlers/shared/model/message-factory.js";
import {
  HARNESS_MESSAGE_ORIGIN_FIELD,
  markMessageAsContext,
  markMessageAsProtocol,
  resolveMessageOrigin,
} from "../src/capabilities/handlers/shared/model/message-metadata.js";
import { buildModelMessagesWithStructuredEnvelope } from "../src/capabilities/handlers/shared/message/utils.js";
import { buildHarnessInjectedMessage } from "../src/capabilities/handlers/shared/message/injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "../src/capabilities/handlers/shared/runtime/dialog-process-id.js";
import { markHarnessTurnLifecycle } from "../src/capabilities/handlers/shared/runtime/lifecycle-utils.js";

function contextMessage(message = {}, key = "") {
  return markMessageAsContext(message, key);
}

function protocolMessage(message = {}, key = "") {
  return markMessageAsProtocol(message, key);
}

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


test("resolveCapabilityModelMessages preserves fallback messages and resolver output without plugin-side filtering", () => {
  const fallback = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "user", content: "keep" },
        { role: "assistant", content: "summarized-fallback", summarized: true },
      ],
    },
  );
  assert.deepEqual(fallback.map((item) => item.content), ["keep", "summarized-fallback"]);

  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [
          { role: "user", content: "keep-resolved" },
          { role: "assistant", content: "summarized-resolved", lc_kwargs: { summarized: true } },
        ],
      },
    },
    { messages: [{ role: "user", content: "ignored" }] },
  );
  assert.deepEqual(resolved.map((item) => item.content), ["keep-resolved", "summarized-resolved"]);
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

test("invokeWithReasoningRetry reuses previous capability messages and appends current increment", async () => {
  const captured = [];
  const ctx = { sessionId: "incremental-cache-session-1" };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
      ],
    },
  });

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [
        { role: "assistant", content: "a2" },
        { role: "user", content: "protocol-v2" },
      ],
    },
  });

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [
        { role: "assistant", content: "a3" },
      ],
    },
  });

  assert.deepEqual(captured, [
    ["sys", "u1"],
    ["sys", "u1", "a2", "protocol-v2"],
    ["sys", "u1", "a2", "protocol-v2", "a3"],
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache can be cleared for summary reset", async () => {
  const captured = [];
  const ctx = { sessionId: "incremental-cache-session-2" };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
      ],
    },
  });
  clearIncrementalCapabilityMessageCacheForContext(ctx);
  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u2-after-summary" },
      ],
    },
  });

  assert.deepEqual(captured, [
    ["sys", "u1"],
    ["sys", "u2-after-summary"],
  ]);
});

test("incremental capability message cache is cleared when agent turn ends", async () => {
  const captured = [];
  const ctx = {
    sessionId: "incremental-cache-turn-end",
    dialogProcessId: "turn-end-dialog-1",
    agentContext: {
      payload: {
        sessionId: "incremental-cache-turn-end",
        harness: {
          state: {
            flags: {},
            signals: {},
          },
        },
      },
    },
  };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "old-turn-context" },
      ],
    },
  });

  markHarnessTurnLifecycle("after_turn", ctx);
  const nextCtx = { ...ctx, dialogProcessId: "turn-end-dialog-2" };
  markHarnessTurnLifecycle("before_turn", nextCtx);

  await invokeWithReasoningRetry({
    invoker,
    ctx: nextCtx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "new-turn-context" },
      ],
    },
  });

  assert.deepEqual(captured, [
    ["sys", "old-turn-context"],
    ["sys", "new-turn-context"],
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache keeps purpose lanes isolated", async () => {
  const captured = [];
  const ctx = { sessionId: "incremental-cache-purpose-isolation" };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [{ role: "system", content: "summary-sys" }],
    },
  });
  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: [{ role: "user", content: "analysis-only" }],
    },
  });

  assert.deepEqual(captured, [
    ["summary-sys"],
    ["analysis-only"],
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache keeps sessions isolated", async () => {
  const captured = [];
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx: { sessionId: "incremental-cache-session-a" },
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [{ role: "system", content: "session-a-sys" }],
    },
  });
  await invokeWithReasoningRetry({
    invoker,
    ctx: { sessionId: "incremental-cache-session-b" },
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [{ role: "user", content: "session-b-only" }],
    },
  });

  assert.deepEqual(captured, [
    ["session-a-sys"],
    ["session-b-only"],
  ]);
  clearIncrementalCapabilityMessageCacheForContext({ sessionId: "incremental-cache-session-a" });
  clearIncrementalCapabilityMessageCacheForContext({ sessionId: "incremental-cache-session-b" });
});

test("incremental capability message cache is disabled when session id is missing", async () => {
  const captured = [];
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => item.content));
    return { content: "ok" };
  };

  await invokeWithReasoningRetry({
    invoker,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [{ role: "system", content: "sys-without-session" }],
    },
  });
  await invokeWithReasoningRetry({
    invoker,
    purpose: "summary",
    invokePayload: {
      purpose: "summary",
      messages: [{ role: "user", content: "current-without-session" }],
    },
  });

  assert.deepEqual(captured, [
    ["sys-without-session"],
    ["current-without-session"],
  ]);
});

test("incremental capability message cache accepts full rebuilds with common prefix without duplicating", () => {
  const ctx = { sessionId: "incremental-cache-full-rebuild" };

  const first = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      { role: "system", content: "stable-sys" },
      { role: "user", content: "u1" },
    ],
  });
  const second = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      { role: "system", content: "stable-sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "protocol-v2" },
    ],
  });

  assert.deepEqual(first.map((item) => item.content), ["stable-sys", "u1"]);
  assert.deepEqual(second.map((item) => item.content), [
    "stable-sys",
    "u1",
    "a2",
    "protocol-v2",
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache rebuilds when system prefix changes", () => {
  const ctx = { sessionId: "incremental-cache-system-change" };

  resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      { role: "system", content: "old-sys" },
      { role: "user", content: "old-u1" },
    ],
  });
  const rebuilt = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      { role: "system", content: "new-sys" },
      { role: "user", content: "new-u1" },
    ],
  });

  assert.deepEqual(rebuilt.map((item) => item.content), ["new-sys", "new-u1"]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache stores clones instead of returned message references", () => {
  const ctx = { sessionId: "incremental-cache-clone-safety" };

  const first = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "summary",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
    ],
  });
  first[0].content = "mutated-outside-cache";

  const second = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "summary",
    messages: [
      { role: "assistant", content: "a2" },
    ],
  });

  assert.deepEqual(second.map((item) => item.content), ["sys", "u1", "a2"]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache prefers explicit source ids over positional matching", () => {
  const ctx = { sessionId: "incremental-cache-explicit-source-id" };

  resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      protocolMessage({ role: "system", content: "protocol-v1" }, "protocol-v1"),
      contextMessage({ role: "user", content: "old source" }, "m1"),
      protocolMessage({ role: "user", content: "request-v1" }, "request-v1"),
    ],
  });
  const resolved = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      protocolMessage({ role: "system", content: "protocol-v2" }, "protocol-v2"),
      contextMessage({ role: "user", content: "old source moved" }, "m1"),
      contextMessage({ role: "assistant", content: "new source" }, "m2"),
      protocolMessage({ role: "user", content: "request-v2" }, "request-v2"),
    ],
  });

  assert.deepEqual(resolved.map((item) => item.content), [
    "protocol-v1",
    "old source",
    "request-v1",
    "new source",
    "protocol-v2",
    "request-v2",
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache skips repeated system protocol but appends current flow user messages", () => {
  const ctx = { sessionId: "incremental-cache-system-protocol-dedupe" };

  resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "summary",
    messages: [
      protocolMessage({ role: "system", content: "stable protocol" }, "stable-protocol"),
      protocolMessage({ role: "system", content: "stable policy" }, "stable-policy"),
      contextMessage({ role: "user", content: "u1" }, "u1"),
      protocolMessage({ role: "user", content: "flow user 1" }, "flow-user-1"),
    ],
  });
  const resolved = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "summary",
    messages: [
      protocolMessage({ role: "system", content: "stable protocol" }, "stable-protocol"),
      protocolMessage({ role: "system", content: "stable policy" }, "stable-policy"),
      contextMessage({ role: "assistant", content: "a2" }, "a2"),
      protocolMessage({ role: "user", content: "flow user 2" }, "flow-user-2"),
    ],
  });

  assert.deepEqual(resolved.map((item) => `${item.role}:${item.content}`), [
    "system:stable protocol",
    "system:stable policy",
    "user:u1",
    "user:flow user 1",
    "assistant:a2",
    "user:flow user 2",
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("incremental capability message cache keeps origin-marked tool execution context", () => {
  const ctx = { sessionId: "incremental-cache-origin-tool-context" };

  resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      contextMessage({ role: "user", content: "first source" }, "m1"),
      protocolMessage({ role: "user", content: "request-v1" }, "request-v1"),
    ],
  });
  const resolved = resolveIncrementalCapabilityMessages({
    ctx,
    purpose: "analysis",
    messages: [
      contextMessage({ role: "user", content: "first source moved" }, "m1"),
      contextMessage({ role: "assistant", content: "工具调用：read_file /project/client/App.vue" }, "tool-call-1"),
      contextMessage({ role: "assistant", content: "工具结果：读取到了 memoryModel 相关配置" }, "tool-result-1"),
      protocolMessage({ role: "user", content: "request-v2" }, "request-v2"),
    ],
  });

  assert.deepEqual(resolved.map((item) => item.content), [
    "first source",
    "request-v1",
    "工具调用：read_file /project/client/App.vue",
    "工具结果：读取到了 memoryModel 相关配置",
    "request-v2",
  ]);
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("invokeWithReasoningRetry uses non-enumerable source markers and strips them before invoke", async () => {
  const captured = [];
  const ctx = { sessionId: "incremental-cache-nonenumerable-source-id" };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(messages.map((item = {}) => ({
      content: item.content,
      keys: Object.keys(item).sort(),
      origin: item[HARNESS_MESSAGE_ORIGIN_FIELD],
    })));
    return { content: "ok" };
  };
  const firstSource = {
    role: "user",
    content: "first source",
    additional_kwargs: { noobotMessageId: "source-1" },
  };
  const secondSource = {
    role: "assistant",
    content: "second source",
    additional_kwargs: { noobotMessageId: "source-2" },
  };

  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: buildCapabilityModelMessages({
        agentMessages: [firstSource],
        task: "request-v1",
      }),
    },
  });
  await invokeWithReasoningRetry({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: buildCapabilityModelMessages({
        agentMessages: [firstSource, secondSource],
        task: "request-v2",
      }),
    },
  });

  assert.deepEqual(captured.map((items) => items.map((item) => item.content)), [
    ["first source", "request-v1"],
    ["first source", "request-v1", "second source", "request-v2"],
  ]);
  assert.deepEqual(
    captured.flat().map((item) => ({
      keys: item.keys,
      origin: item.origin,
    })),
    [
      { keys: ["content", "role"], origin: undefined },
      { keys: ["content", "role"], origin: undefined },
      { keys: ["content", "role"], origin: undefined },
      { keys: ["content", "role"], origin: undefined },
      { keys: ["content", "role"], origin: undefined },
      { keys: ["content", "role"], origin: undefined },
    ],
  );
  clearIncrementalCapabilityMessageCacheForContext(ctx);
});

test("buildCapabilityModelMessages assigns origin to every capability message", () => {
  const messages = buildCapabilityModelMessages({
    agentMessages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      { role: "tool", content: "tool result", tool_call_id: "call_1" },
      { role: "user", content: "plain user" },
    ],
    constraints: ["constraint"],
    task: "task",
    postTaskMessages: ["responsibility"],
  });

  assert.equal(messages.length, 6);
  assert.ok(messages.every((message) => resolveMessageOrigin(message)));
  assert.deepEqual(messages.map((message) => resolveMessageOrigin(message).kind), [
    "protocol",
    "context",
    "context",
    "context",
    "protocol",
    "protocol",
  ]);
});


test("resolveCapabilityModelMessages fallback preserves provided messages without clipping", () => {
  const result = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "assistant", content: "summarized", summarized: true },
        ...Array.from({ length: 22 }, (_, index) => ({
          role: "user",
          content: `m${index + 1}`,
        })),
      ],
    },
  );

  assert.deepEqual(
    result.map((item) => item.content),
    ["summarized", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22"],
  );
});

test("resolveCapabilityModelMessages does not filter and does not use payload fallback", () => {
  const explicit = resolveCapabilityModelMessages(
    {},
    {
      messages: [
        { role: "assistant", content: "drop-explicit", summarized: true },
        { role: "tool", content: "drop-lc", lc_kwargs: { summarized: true } },
        { role: "user", content: "keep-explicit" },
      ],
    },
  );
  assert.deepEqual(explicit.map((item) => item.content), ["drop-explicit", "drop-lc", "keep-explicit"]);

  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [
          { role: "assistant", content: "drop-resolver", summarized: true },
          { role: "user", content: "keep-resolver" },
        ],
      },
    },
    {
      ctx: {
        messages: [
          { role: "assistant", content: "drop-source", summarized: true },
          { role: "user", content: "keep-source" },
        ],
      },
      purpose: "analysis",
    },
  );
  assert.deepEqual(resolved.map((item) => item.content), ["drop-resolver", "keep-resolver"]);

  const payloadFallback = resolveCapabilityModelMessages(
    {},
    {
      ctx: {
        agentContext: {
          payload: {
            messages: {
              history: [
                { role: "assistant", content: "drop-payload", summarized: true },
                { role: "user", content: "keep-payload" },
              ],
            },
          },
        },
      },
      purpose: "phase_acceptance",
    },
  );
  assert.deepEqual(payloadFallback.map((item) => item.content), []);
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
