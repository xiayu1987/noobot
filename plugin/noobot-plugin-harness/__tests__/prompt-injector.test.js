import test from "node:test";
import assert from "node:assert/strict";

import {
  injectSystemMessages,
  isHarnessPromptAlreadyInjected,
  markPromptAsInjected,
} from "../src/prompt/prompt-injector.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../src/capabilities/handlers/shared/constants.js";

test("injectSystemMessages skips already injected prompt IDs and injects missing ones", () => {
  const messages = [
    { role: "system", content: "<!-- noobot-harness-policy -->\npolicy" },
    { role: "user", content: "hello" },
  ];
  const changed = injectSystemMessages(
    { messages },
    {
      prompts: [
        { id: "noobot-harness-policy", content: "policy", priority: 100, mode: "prepend" },
        { id: "noobot-harness-final-response", content: "final", priority: 80, mode: "prepend" },
      ],
    },
  );

  assert.equal(changed, true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-policy"), true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-final-response"), true);
  assert.equal(
    messages.filter((item) => item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-final-response").length,
    1,
  );
  assert.equal(
    messages.some((item) => String(item.content || "").includes("noobot-harness-final-response")),
    false,
  );
});

test("markPromptAsInjected updates cache without rescanning", () => {
  const messages = [{ role: "user", content: "hello" }];
  markPromptAsInjected(messages, "test-id");
  assert.equal(isHarnessPromptAlreadyInjected(messages, "test-id"), true);
});

test("replace mode refreshes cache after removing old harness prompts", () => {
  const messages = [
    { role: "system", content: "<!-- noobot-harness-policy -->\npolicy" },
    { role: "system", content: "<!-- noobot-harness-final-response -->\nfinal" },
    { role: "user", content: "hi" },
  ];
  const changed = injectSystemMessages(
    { messages },
    {
      prompts: [{ id: "noobot-harness-replaced", content: "replaced", mode: "replace", priority: 90 }],
    },
  );
  assert.equal(changed, true);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-policy"), false);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-final-response"), false);
  assert.equal(isHarnessPromptAlreadyInjected(messages, "noobot-harness-replaced"), true);
});

test("after_system mode preserves leading system messages", () => {
  const messages = [
    { role: "system", content: "system context" },
    { role: "user", content: "user task" },
  ];
  const changed = injectSystemMessages(
    { messages },
    {
      prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "after_system", priority: 90 }],
    },
  );

  assert.equal(changed, true);
  assert.equal(messages[0]?.content, "system context");
  assert.equal(messages[1]?.[HARNESS_PROMPT_INJECTION_ID_FIELD], "noobot-harness-policy");
  assert.equal(String(messages[1]?.content || ""), "policy");
  assert.equal(messages[2]?.content, "user task");
});

test("injectSystemMessages writes back through message store", () => {
  const userMessage = { role: "user", content: "user task" };
  const messages = [
    { role: "system", content: "system context" },
    userMessage,
  ];
  const ctx = {
    messages,
    messageBlocks: {
      system: [{ role: "system", content: "system context" }],
      history: [],
      incremental: [userMessage],
    },
  };

  const changed = injectSystemMessages(ctx, {
    prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "after_system", priority: 90 }],
  });

  assert.equal(changed, true);
  assert.ok(ctx.messages[1]?.additional_kwargs?.noobotMessageId);
  assert.equal(ctx.messages[2], ctx.messageBlocks.incremental[0]);
  assert.deepEqual(ctx.messageBlocks.incrementalIds, [
    ctx.messages[2].additional_kwargs.noobotMessageId,
  ]);
});

test("injectSystemMessages syncs system block ids through message store", () => {
  const ctx = {
    messages: [{ role: "user", content: "user task" }],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "user task" }],
    },
  };

  const changed = injectSystemMessages(ctx, {
    prompts: [{ id: "noobot-harness-policy", content: "policy", mode: "prepend", priority: 90 }],
    systemBlockIds: new Set(["noobot-harness-policy"]),
    syncMessageBlocksSystem: true,
  });

  assert.equal(changed, true);
  assert.equal(ctx.messageBlocks.system.length, 1);
  assert.equal(ctx.messageBlocks.system[0], ctx.messages[0]);
  assert.deepEqual(ctx.messageBlocks.systemIds, [
    ctx.messages[0].additional_kwargs.noobotMessageId,
  ]);
});
