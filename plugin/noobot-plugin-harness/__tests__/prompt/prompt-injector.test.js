/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  injectSystemMessages,
  isHarnessPromptAlreadyInjected,
} from "../../src/prompt/prompt-injector.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../../src/capabilities/handlers/shared/constants.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { replaceMessageProjection } from "../../src/core/message-store.js";

test("injectSystemMessages skips already injected prompt IDs and injects missing ones", () => {
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: {
        system: [
          {
            role: "system",
            content: "policy",
            [HARNESS_PROMPT_INJECTION_ID_FIELD]: "noobot-harness-policy",
          },
        ],
        history: [],
        incremental: [{ role: "user", content: "hello" }],
      },
    },
  );
  const messages = ctx.modelContext.messages;
  const changed = injectSystemMessages(ctx, {
    prompts: [
      { id: "noobot-harness-policy", content: "policy", priority: 100, mode: "prepend" },
      { id: "noobot-harness-final-response", content: "final", priority: 80, mode: "prepend" },
    ],
  });

  assert.equal(changed, true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-policy"), true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-final-response"), true);
  assert.equal(
    messages.filter((item) => item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy")
      .length,
    1,
  );
  assert.equal(
    messages.filter(
      (item) => item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-final-response",
    ).length,
    1,
  );
  assert.equal(
    messages.some((item) => String(item.content || "").includes("noobot-harness-final-response")),
    false,
  );
});

test("replace mode refreshes cache after removing old harness prompts", () => {
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: {
        system: [
          {
            role: "system",
            content: "policy",
            [HARNESS_PROMPT_INJECTION_ID_FIELD]: "noobot-harness-policy",
          },
          {
            role: "system",
            content: "final",
            [HARNESS_PROMPT_INJECTION_ID_FIELD]: "noobot-harness-final-response",
          },
        ],
        history: [],
        incremental: [{ role: "user", content: "hi" }],
      },
    },
  );
  const messages = ctx.modelContext.messages;
  const changed = injectSystemMessages(ctx, {
    prompts: [
      { id: "noobot-harness-replaced", content: "replaced", mode: "replace", priority: 90 },
    ],
  });
  assert.equal(changed, true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-policy"), false);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-final-response"), false);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-replaced"), true);
});

test("after_system mode preserves leading system messages", () => {
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: {
        system: [{ role: "system", content: "system context" }],
        history: [],
        incremental: [{ role: "user", content: "user task" }],
      },
    },
  );
  const messages = ctx.modelContext.messages;
  const changed = injectSystemMessages(ctx, {
    prompts: [
      { id: "noobot-harness-policy", content: "policy", mode: "after_system", priority: 90 },
    ],
  });

  assert.equal(changed, true);
  assert.equal(messages[0]?.content, "system context");
  assert.equal(messages[1]?.[HARNESS_PROMPT_INJECTION_ID_FIELD], "noobot-harness-policy");
  assert.equal(String(messages[1]?.content || ""), "policy");
  assert.equal(messages[2]?.content, "user task");
});

test("injectSystemMessages writes back through message store", () => {
  const userMessage = { role: "user", content: "user task" };
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: {
        system: [{ role: "system", content: "system context" }],
        history: [],
        incremental: [userMessage],
      },
    },
  );

  const changed = injectSystemMessages(ctx, {
    prompts: [
      { id: "noobot-harness-policy", content: "policy", mode: "after_system", priority: 90 },
    ],
  });

  assert.equal(changed, true);
  assert.ok(ctx.modelContext.messages[1]?.additional_kwargs?.noobotMessageId);
  assert.equal(ctx.modelContext.messages[2], ctx.modelContext.messageBlocks.incremental[0]);
  assert.equal(ctx.modelContext.messageBlocks.incrementalIds, undefined);
});

test("injectSystemMessages syncs system block arrays through message store", () => {
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [{ role: "user", content: "user task" }],
      },
    },
  );

  const changed = injectSystemMessages(ctx, {
    prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "prepend", priority: 90 }],
    systemBlockIds: new Set(["noobot-harness-policy"]),
    syncMessageBlocksSystem: true,
  });

  assert.equal(changed, true);
  assert.equal(ctx.modelContext.messageBlocks.system.length, 1);
  assert.equal(ctx.modelContext.messageBlocks.system[0], ctx.modelContext.messages[0]);
  assert.ok(ctx.modelContext.messages[0].additional_kwargs.noobotMessageId);
  assert.equal(ctx.modelContext.messageBlocks.systemIds, undefined);
});

test("injectSystemMessages keeps tool results that merely mention a prompt marker", () => {
  const markerText = "<" + "!-- noobot-harness-policy --" + ">";
  const user = { role: "user", content: "user task" };
  const assistant = new AIMessage({
    content: "",
    tool_calls: [
      { id: "call_a", name: "read_file", args: {} },
      { id: "call_b", name: "read_file", args: {} },
    ],
  });
  const toolWithMarker = new ToolMessage({
    content: `source: ${markerText}`,
    tool_call_id: "call_a",
  });
  const toolPlain = new ToolMessage({ content: "plain", tool_call_id: "call_b" });
  const incremental = [user, assistant, toolWithMarker, toolPlain];
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: { system: [], history: [], incremental: [...incremental] },
    },
  );

  const changed = injectSystemMessages(ctx, {
    prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "prepend", priority: 90 }],
    systemBlockIds: new Set(["noobot-harness-policy"]),
    syncMessageBlocksSystem: true,
  });

  assert.equal(changed, true);
  const blocks = ctx.modelContext.messageBlocks;
  assert.equal(blocks.incremental.length, 4);
  assert.equal(
    blocks.incremental.some((message) => String(message.content).includes(markerText)),
    true,
  );
  assert.equal(blocks.system.length, 1);
  assert.equal(ctx.modelContext.messages.length, 5);
});

test("injectSystemMessages does not prune fact blocks to the model projection", () => {
  const user = { role: "user", content: "user task" };
  const orphanAssistant = new AIMessage({
    content: "",
    tool_calls: [{ id: "call_aborted", name: "patch_file", args: {} }],
  });
  const ctx = createTestHookContext(
    {},
    {
      messageBlocks: { system: [], history: [], incremental: [user, orphanAssistant] },
    },
  );
  replaceMessageProjection(ctx, [ctx.modelContext.messageBlocks.incremental[0]]);
  assert.equal(ctx.modelContext.messages.length, 1);

  const changed = injectSystemMessages(ctx, {
    prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "prepend", priority: 90 }],
    systemBlockIds: new Set(["noobot-harness-policy"]),
    syncMessageBlocksSystem: true,
  });

  assert.equal(changed, true);
  const blocks = ctx.modelContext.messageBlocks;
  assert.equal(blocks.incremental.length, 2);
  assert.equal(blocks.incremental[1]?.tool_calls?.[0]?.id, "call_aborted");
  assert.equal(blocks.system.length, 1);
  assert.equal(ctx.modelContext.messages.length, 2);
  assert.equal(ctx.modelContext.messages[0], blocks.system[0]);
});
