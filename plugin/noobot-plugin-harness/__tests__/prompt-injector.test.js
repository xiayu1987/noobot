import test from "node:test";
import assert from "node:assert/strict";

import {
  injectSystemMessages,
  isHarnessPromptAlreadyInjected,
  markPromptAsInjected,
} from "../src/prompt/prompt-injector.js";

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
  const policyCount = messages.filter((item) => String(item.content || "").includes("noobot-harness-policy")).length;
  const finalCount = messages.filter((item) =>
    String(item.content || "").includes("noobot-harness-final-response"),
  ).length;
  assert.equal(policyCount, 1);
  assert.equal(finalCount, 1);
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
  assert.match(String(messages[1]?.content || ""), /noobot-harness-policy/);
  assert.equal(messages[2]?.content, "user task");
});
