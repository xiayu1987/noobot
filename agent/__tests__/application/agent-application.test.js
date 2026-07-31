/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_APPLICATION_EVENT,
  AGENT_CLIENT_KIND,
  createAgentApplication,
} from "../../src/application/index.js";

test("Agent Application exposes transport-neutral client and event contracts", () => {
  assert.equal(AGENT_CLIENT_KIND.SERVICE, "service");
  assert.equal(AGENT_CLIENT_KIND.CLI, "cli");
  assert.equal(AGENT_APPLICATION_EVENT.INTERACTION_REQUESTED, "interaction.requested");
});

test("Agent Application delegates execution without exposing BotManager", async () => {
  const calls = [];
  const application = createAgentApplication({
    runtime: {
      async resolveExecutionIntent(input) {
        return { executionId: `agent:${input.turnScopeId}`, executionKind: "agent" };
      },
      async runSession(input) {
        calls.push(input);
        return { answer: "ok", sessionId: input.sessionId };
      },
    },
  });
  const input = { userId: "u1", sessionId: "s1", message: "hello" };
  assert.deepEqual(await application.run(input), { answer: "ok", sessionId: "s1" });
  assert.deepEqual(calls, [input]);
  assert.deepEqual(await application.resolveExecutionIntent({ turnScopeId: "turn-1" }), {
    executionId: "agent:turn-1",
    executionKind: "agent",
  });
  assert.equal("runtime" in application, false);
});

test("Agent Application rejects an incomplete runtime", () => {
  assert.throws(() => createAgentApplication({ runtime: {} }), /runtime\.runSession/);
  assert.throws(
    () => createAgentApplication({ runtime: { runSession() {} } }),
    /runtime\.resolveExecutionIntent/,
  );
});
