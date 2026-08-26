/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestModelResponse } from "../helpers/public-runtime-fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCapabilityModelMessages } from "../../src/capabilities/handlers/shared/model/utils.js";
import { invokeCapabilityModel } from "../../src/capabilities/handlers/shared/model/invocation-utils.js";
import { clearAuxiliarySnapshotsForContext } from "../../src/capabilities/handlers/shared/model/auxiliary-snapshot-store.js";
import { buildCapabilityModelMessages } from "../../src/capabilities/handlers/shared/model/message-factory.js";
import {
  AUXILIARY_SEQUENCE_IDENTITY_FIELD,
  resolveAuxiliarySequenceIdentity,
} from "@noobot/context-protocol/assembly/auxiliary-sequence";
import { buildModelMessagesWithStructuredEnvelope } from "../../src/capabilities/handlers/shared/message/utils.js";
import { buildHarnessInjectedMessage } from "../../src/capabilities/handlers/shared/message/injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "../../src/capabilities/handlers/shared/runtime/dialog-process-id.js";
import { markHarnessTurnLifecycle } from "../../src/capabilities/handlers/shared/runtime/lifecycle-utils.js";

function withoutNoScriptConstraint(messages = []) {
  return messages.filter(
    (item = {}) => !String(item?.content || "").includes("禁止直接输出可执行脚本或命令"),
  );
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

test("resolveDialogProcessIdFromContext reads the explicit hook identity", () => {
  const dialogProcessId = resolveDialogProcessIdFromContext({
    dialogProcessId: "dlg_explicit",
  });
  assert.equal(dialogProcessId, "dlg_explicit");
});

test("resolveCapabilityModelMessages preserves authoritative resolver output without plugin-side filtering", () => {
  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [
          { role: "user", content: "keep-resolved" },
          { role: "assistant", content: "summarized-resolved", lc_kwargs: { summarized: true } },
        ],
      },
    },
    { ctx: { modelContext: { protocolVersion: 3 } } },
  );
  assert.deepEqual(
    resolved.map((item) => item.content),
    ["keep-resolved", "summarized-resolved"],
  );
});

test("resolveCapabilityModelMessages delegates the authoritative modelContext to the injected resolver", () => {
  let capturedPayload = null;
  const resolved = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: (payload = {}) => {
          capturedPayload = payload;
          return [
            ...(payload.ctx?.modelContext?.messageBlocks?.history || []),
            ...(payload.ctx?.modelContext?.messageBlocks?.incremental || []),
          ];
        },
      },
    },
    {
      ctx: {
        modelContext: {
          protocolVersion: 3,
          messageBlocks: {
            history: [{ role: "user", content: "history-from-block" }],
            incremental: [{ role: "assistant", content: "incremental-from-block" }],
          },
        },
      },
      purpose: "phase_acceptance",
    },
  );

  assert.equal(Object.hasOwn(capturedPayload, "messages"), false);
  assert.deepEqual(
    resolved.map((item) => item.content),
    ["history-from-block", "incremental-from-block"],
  );
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

test("invokeCapabilityModel preserves provided messages before invoking capability model", async () => {
  let capturedMessages = null;
  const response = await invokeCapabilityModel({
    invoker: async ({ messages = [] } = {}) => {
      capturedMessages = messages;
      return createTestModelResponse("ok");
    },
    ctx: { modelContext: { checkpointRevision: 0 } },
    invokePayload: {
      messages: buildCapabilityModelMessages({
        agentMessages: [
          { role: "user", content: "keep", messageUid: "keep-1" },
          { role: "assistant", content: "drop", summarized: true, messageUid: "drop-1" },
        ],
      }),
    },
  });

  assert.equal(response.output.text, "ok");
  assert.equal(capturedMessages[0]?.role, "system");
  assert.match(capturedMessages[0]?.content, /禁止直接输出可执行脚本或命令/);
  assert.deepEqual(
    capturedMessages.slice(1).map((item) => item.content),
    ["keep", "drop"],
  );
});

test("invokeCapabilityModel advances one checkpoint append-only auxiliary sequence", async () => {
  const captured = [];
  const ctx = { sessionId: "auxiliary-sequence", modelContext: { checkpointRevision: 0 } };
  const policies = [];
  const invoker = async ({ messages = [], contextSequencePolicy = "" } = {}) => {
    captured.push(withoutNoScriptConstraint(messages));
    policies.push(contextSequencePolicy);
    return createTestModelResponse("ok");
  };

  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: buildCapabilityModelMessages({
        agentMessages: [{ role: "user", content: "u1", messageUid: "u1" }],
        constraints: ["sys"],
        task: "analysis-request-1",
      }),
    },
  });

  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: {
      purpose: "analysis",
      messages: buildCapabilityModelMessages({
        agentMessages: [
          { role: "user", content: "u1", messageUid: "u1" },
          {
            role: "assistant",
            content: "",
            messageUid: "assistant-tool-call-1",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          {
            role: "tool",
            content: "file-content",
            tool_call_id: "call-1",
            messageUid: "tool-result-1",
          },
        ],
        constraints: ["sys"],
        task: "analysis-request-2",
      }),
    },
  });

  assert.deepEqual(
    captured[0].map((item) => item.content),
    ["sys", "u1", "analysis-request-1"],
  );
  assert.deepEqual(
    captured[1].map((item) => item.role),
    ["system", "user", "user", "user", "assistant", "user"],
  );
  assert.match(captured[1][3].content, /read_file/);
  assert.equal(captured[1][4].content, "file-content");
  assert.equal(
    captured[1].some((item) => item.content === "analysis-request-1"),
    true,
  );
  assert.deepEqual(policies, ["checkpoint_append_only", "checkpoint_append_only"]);
  clearAuxiliarySnapshotsForContext(ctx);
});

test("invokeCapabilityModel rebuilds from authoritative Context after checkpoint revision", async () => {
  const captured = [];
  const ctx = {
    sessionId: "auxiliary-checkpoint-rebuild",
    modelContext: { checkpointRevision: 0 },
  };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(withoutNoScriptConstraint(messages).map((message) => message.content));
    return createTestModelResponse("ok");
  };
  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      messages: buildCapabilityModelMessages({
        agentMessages: [{ role: "user", content: "before checkpoint", messageUid: "before" }],
        task: "request before",
      }),
    },
  });
  ctx.modelContext.checkpointRevision = 1;
  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: {
      messages: buildCapabilityModelMessages({
        agentMessages: [{ role: "user", content: "summary baseline", messageUid: "summary" }],
        task: "request after",
      }),
    },
  });
  assert.deepEqual(captured, [
    ["before checkpoint", "request before"],
    ["summary baseline", "request after"],
  ]);
  clearAuxiliarySnapshotsForContext(ctx);
});

test("Harness auxiliary snapshots isolate purposes and require an explicit session key", async () => {
  const captured = [];
  const ctx = { sessionId: "auxiliary-purpose-isolation", modelContext: { checkpointRevision: 0 } };
  const invoker = async ({ purpose = "", messages = [] } = {}) => {
    captured.push({
      purpose,
      contents: withoutNoScriptConstraint(messages).map((item) => item.content),
    });
    return createTestModelResponse("ok");
  };
  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: { purpose: "analysis", messages: buildCapabilityModelMessages({ task: "a1" }) },
  });
  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "summary",
    invokePayload: { purpose: "summary", messages: buildCapabilityModelMessages({ task: "s1" }) },
  });
  const noSessionCtx = { modelContext: { checkpointRevision: 0 } };
  await invokeCapabilityModel({
    invoker,
    ctx: noSessionCtx,
    purpose: "analysis",
    invokePayload: { purpose: "analysis", messages: buildCapabilityModelMessages({ task: "n1" }) },
  });
  await invokeCapabilityModel({
    invoker,
    ctx: noSessionCtx,
    purpose: "analysis",
    invokePayload: { purpose: "analysis", messages: buildCapabilityModelMessages({ task: "n2" }) },
  });
  assert.deepEqual(captured, [
    { purpose: "analysis", contents: ["a1"] },
    { purpose: "summary", contents: ["s1"] },
    { purpose: "analysis", contents: ["n1"] },
    { purpose: "analysis", contents: ["n2"] },
  ]);
  clearAuxiliarySnapshotsForContext(ctx);
});

test("Harness turn completion releases every auxiliary purpose snapshot for the session", async () => {
  const captured = [];
  const ctx = {
    sessionId: "auxiliary-turn-completion",
    dialogProcessId: "dialog-1",
    modelContext: { checkpointRevision: 0 },
    agentContext: {
      payload: { harness: { state: { flags: {}, signals: {} } } },
    },
  };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(withoutNoScriptConstraint(messages).map((message) => message.content));
    return createTestModelResponse("ok");
  };
  await invokeCapabilityModel({
    invoker,
    ctx,
    purpose: "analysis",
    invokePayload: { messages: buildCapabilityModelMessages({ task: "old request" }) },
  });
  markHarnessTurnLifecycle("agent.after_turn", ctx);
  const nextCtx = { ...ctx, dialogProcessId: "dialog-2" };
  markHarnessTurnLifecycle("agent.before_turn", nextCtx);
  await invokeCapabilityModel({
    invoker,
    ctx: nextCtx,
    purpose: "analysis",
    invokePayload: { messages: buildCapabilityModelMessages({ task: "new request" }) },
  });
  assert.deepEqual(captured, [["old request"], ["new request"]]);
  clearAuxiliarySnapshotsForContext(ctx);
});

test("invokeCapabilityModel strips internal source markers from each authoritative projection", async () => {
  const captured = [];
  const ctx = {
    sessionId: "authoritative-projection-source-id",
    modelContext: { checkpointRevision: 0 },
  };
  const invoker = async ({ messages = [] } = {}) => {
    captured.push(
      withoutNoScriptConstraint(messages).map((item = {}) => ({
        content: item.content,
        keys: Object.keys(item).sort(),
        origin: item[AUXILIARY_SEQUENCE_IDENTITY_FIELD],
      })),
    );
    return createTestModelResponse("ok");
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

  await invokeCapabilityModel({
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
  await invokeCapabilityModel({
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

  assert.deepEqual(
    captured.map((items) => items.map((item) => item.content)),
    [
      ["first source", "request-v1"],
      ["first source", "request-v1", "second source", "request-v2"],
    ],
  );
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
});

test("buildCapabilityModelMessages assigns protocol-owned identity to every capability message", () => {
  const messages = buildCapabilityModelMessages({
    agentMessages: [
      {
        role: "assistant",
        content: "",
        messageUid: "call-message-1",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      { role: "tool", content: "tool result", tool_call_id: "call_1", messageUid: "result-1" },
      { role: "user", content: "plain user", messageUid: "user-1" },
    ],
    constraints: ["constraint"],
    task: "task",
    postTaskMessages: ["responsibility"],
  });

  assert.equal(messages.length, 6);
  assert.ok(messages.every((message) => resolveAuxiliarySequenceIdentity(message)));
  assert.deepEqual(
    messages.map((message) => resolveAuxiliarySequenceIdentity(message).kind),
    ["stable_protocol", "context", "context", "context", "request", "request"],
  );
});

test("resolveCapabilityModelMessages requires the authoritative resolver", () => {
  assert.throws(
    () => resolveCapabilityModelMessages({}, { ctx: {} }),
    /authoritative modelContext resolver/,
  );
});

test("resolveCapabilityModelMessages does not filter resolver output or use payload fallback", () => {
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
        modelContext: {
          protocolVersion: 3,
          messageBlocks: { system: [], history: [], incremental: [] },
        },
      },
      purpose: "analysis",
    },
  );
  assert.deepEqual(
    resolved.map((item) => item.content),
    ["drop-resolver", "keep-resolver"],
  );

  assert.throws(
    () =>
      resolveCapabilityModelMessages(
        {},
        {
          ctx: {
            agentContext: {
              payload: { messages: { history: [{ role: "user", content: "payload" }] } },
            },
          },
          purpose: "phase_acceptance",
        },
      ),
    /authoritative modelContext resolver/,
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
    [
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
      "m12",
      "m13",
      "m14",
      "m15",
      "m16",
      "m17",
      "m18",
      "m19",
      "m20",
      "m21",
      "m22",
    ],
  );
  assert.equal(output.at(-1).content, "task");
});
