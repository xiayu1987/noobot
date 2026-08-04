/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import {
  resolveRuntimeHookManager,
  runAgentRuntimeHook,
  withHookRuntimeMeta,
} from "../../../src/extensions/hooks/index.js";

test("agent adapter resolves only the canonical hookManager field", () => {
  const hookManager = createHookManager();
  assert.equal(resolveRuntimeHookManager({ hookManager }), hookManager);
  assert.equal(resolveRuntimeHookManager({ hooks: hookManager }), null);
});

test("agent adapter executes protocol hooks and emits a summary", async () => {
  const hookManager = createHookManager();
  const events = [];
  const context = {};
  hookManager.on(HOOK_POINT.AGENT.AFTER_TURN, (hookContext) => {
    hookContext.observed = true;
  }, { id: "test.agent-adapter.summary" });

  const result = await runAgentRuntimeHook({
    runtime: { hookManager },
    point: HOOK_POINT.AGENT.AFTER_TURN,
    context,
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(result.executed, true);
  assert.equal(result.failures.length, 0);
  assert.equal(context.observed, true);
  assert.equal(events[0]?.event, "hook_summary");
  assert.equal(events[0]?.data?.point, HOOK_POINT.AGENT.AFTER_TURN);
});

test("agent adapter returns a canonical empty result when no manager exists", async () => {
  const context = { value: 1 };
  const result = await runAgentRuntimeHook({
    runtime: {},
    point: HOOK_POINT.AGENT.AFTER_TURN,
    context,
  });
  assert.equal(result.executed, false);
  assert.equal(result.context, context);
  assert.deepEqual(result.outcomes, []);
  assert.deepEqual(result.failures, []);
});

test("agent adapter exposes the sanitized plugin event capability", async () => {
  const hookManager = createHookManager();
  const events = [];
  hookManager.on(HOOK_POINT.AGENT.AFTER_TURN, (context) => {
    context.emitHookClientEvent("plugin_failed", {
      plugin: "harness",
      status: "failed",
      message: "failed",
      agentContext: { secret: true },
    });
  }, { id: "test.agent-adapter.client-event" });

  await runAgentRuntimeHook({
    runtime: { hookManager },
    point: HOOK_POINT.AGENT.AFTER_TURN,
    context: {},
    eventListener: { onEvent: (event) => events.push(event) },
  });

  const pluginEvent = events.find((event) => event?.event === "hook_plugin_progress");
  assert.equal(pluginEvent?.data?.data?.plugin, "harness");
  assert.equal(Object.hasOwn(pluginEvent?.data?.data || {}, "agentContext"), false);
});

test("withHookRuntimeMeta projects the canonical runtime identity", () => {
  const context = withHookRuntimeMeta({
    systemRuntime: {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "p1",
      dialogProcessId: "d1",
      caller: "user",
    },
  }, { phase: "turn" });
  assert.deepEqual(context, {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    dialogProcessId: "d1",
    caller: "user",
    phase: "turn",
  });
});
