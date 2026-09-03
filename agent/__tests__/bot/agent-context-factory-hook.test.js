/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { AgentContextFactory } from "../../src/context/assembly/agent-context-factory.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("buildAgentContextFromBuilder triggers before/after context build hooks", async () => {
  const hookManager = createHookManager();
  const beforePayloads = [];
  const afterPayloads = [];

  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
    async (ctx = {}) => {
      beforePayloads.push(ctx);
    },
    { id: "test.context.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.AFTER_CONTEXT_BUILD,
    async (ctx = {}) => {
      afterPayloads.push(ctx);
    },
    { id: "test.context.after" },
  );

  const contextBuilder = {
    async buildInitialContext() {
      return createTestAgentExecutionScope(
        { hookManager },
        {
          messageBlocks: {
            history: [
              { role: "user", content: "a" },
              { role: "assistant", content: "b" },
            ],
          },
        },
      );
    },
    async buildContinueContext() {
      throw new Error("should not be called");
    },
  };

  const factory = new AgentContextFactory({});
  const result = await factory.buildAgentContextFromBuilder({
    mode: "new_session",
    userId: "u_ctx_1",
    sessionId: "s_ctx_1",
    caller: "user",
    parentSessionId: "p_ctx_1",
    dialogProcessId: "dp_ctx_1",
    runConfig: { hookManager },
    contextBuilder,
  });

  assert.ok(result);
  assert.equal(beforePayloads.length, 1);
  assert.equal(afterPayloads.length, 1);
  assert.equal(beforePayloads[0].mode, "new_session");
  assert.equal(beforePayloads[0].userId, "u_ctx_1");
  assert.equal(beforePayloads[0].sessionId, "s_ctx_1");
  assert.equal(beforePayloads[0].caller, "user");
  assert.equal(beforePayloads[0].parentSessionId, "p_ctx_1");
  assert.equal(beforePayloads[0].dialogProcessId, "dp_ctx_1");
  assert.equal(typeof beforePayloads[0].startedAt, "string");
  assert.equal(afterPayloads[0].messageCount, 2);
  assert.equal(afterPayloads[0].status, "success");
  assert.equal(typeof afterPayloads[0].startedAt, "string");
  assert.equal(typeof afterPayloads[0].endedAt, "string");
  assert.equal(Number.isFinite(afterPayloads[0].durationMs), true);
  assert.equal(afterPayloads[0].durationMs >= 0, true);
});

test("buildAgentContextFromBuilder triggers context_build_error hook on failure", async () => {
  const hookManager = createHookManager();
  const calls = [];
  const errorPayloads = [];

  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
    async (ctx = {}) => {
      assert.equal(ctx.sessionId, "s_ctx_2");
      calls.push("before");
    },
    { id: "test.context-error.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.CONTEXT_BUILD_ERROR,
    async (ctx = {}) => {
      calls.push(`error:${ctx?.error?.message || ""}`);
      errorPayloads.push(ctx);
    },
    { id: "test.context-error.observe" },
  );

  const contextBuilder = {
    async buildInitialContext() {
      throw new Error("context build failed");
    },
    async buildContinueContext() {
      throw new Error("should not be called");
    },
  };

  const factory = new AgentContextFactory({});
  await assert.rejects(
    () =>
      factory.buildAgentContextFromBuilder({
        mode: "new_session",
        userId: "u_ctx_2",
        sessionId: "s_ctx_2",
        caller: "user",
        parentSessionId: "p_ctx_2",
        dialogProcessId: "dp_ctx_2",
        runConfig: { hookManager },
        contextBuilder,
      }),
    /context build failed/,
  );

  assert.deepEqual(calls, ["before", "error:context build failed"]);
  assert.equal(errorPayloads.length, 1);
  assert.equal(errorPayloads[0].status, "error");
  assert.equal(errorPayloads[0].mode, "new_session");
  assert.equal(errorPayloads[0].userId, "u_ctx_2");
  assert.equal(errorPayloads[0].caller, "user");
  assert.equal(errorPayloads[0].parentSessionId, "p_ctx_2");
  assert.equal(errorPayloads[0].dialogProcessId, "dp_ctx_2");
  assert.equal(Number.isFinite(errorPayloads[0].durationMs), true);
  assert.equal(errorPayloads[0].durationMs >= 0, true);
});

test("buildAgentContextFromBuilder rejects unknown context modes", async () => {
  const factory = new AgentContextFactory({});
  await assert.rejects(
    () =>
      factory.buildAgentContextFromBuilder({
        mode: "typo_mode",
        sessionId: "s1",
        contextBuilder: {},
      }),
    (error) => error?.errorCode === "INVALID_CONTEXT_MODE",
  );
});
