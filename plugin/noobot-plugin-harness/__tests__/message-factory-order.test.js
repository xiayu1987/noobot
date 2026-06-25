import test from "node:test";
import assert from "node:assert/strict";

import { buildCapabilityProtocolModelMessages } from "../src/capabilities/handlers/shared/model/message-factory.js";

test("capability protocol model messages keep system block before agent conversation", () => {
  const messages = buildCapabilityProtocolModelMessages({
    agentMessages: [
      { role: "user", content: "current user" },
      { role: "system", content: "agent system" },
      { role: "assistant", content: "history assistant" },
    ],
    contextMessages: ["planning context"],
    protocolPrompt: "planning protocol",
    workflowPolicyPrompt: "workflow policy",
    responsibilityPrompt: "please plan",
  });

  assert.deepEqual(
    messages.map((item) => `${item.role}:${item.content}`),
    [
      "system:agent system",
      "system:planning context",
      "system:planning protocol",
      "system:workflow policy",
      "user:current user",
      "assistant:history assistant",
      "user:please plan",
    ],
  );
});
