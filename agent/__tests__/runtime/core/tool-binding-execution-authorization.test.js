/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createToolNameBinding, TOOL_CALL_NAME_BINDING } from "@noobot/model-protocol";
import {
  getToolNameBinding,
  runWithToolNameBinding,
} from "@noobot/model-protocol/tool-binding-scope-node";
import { structuredTool } from "../../../src/tools/core/structured-tool.js";
import {
  executeToolCall,
  startToolCallInTurn,
} from "../../../src/runtime/tool-execution/tool-runner.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

for (const mode of ["denied", "unrelated", "historical"]) {
  test(`structured tool refuses ${mode} identity before running`, async () => {
    let invoked = false;
    const runtime = createTestRuntimeContext({
      runConfig: { hookManager: null, toolPolicy: { denyToolNames: ["blocked"] } },
    });
    const tool = structuredTool(
      runtime,
      () => {
        invoked = true;
        return "executed";
      },
      { name: "blocked", description: "test", schema: z.object({}) },
      { bindings: { tools: [{ name: "blocked" }] } },
    );
    const invoke = () => tool.invoke({});
    const binding = createToolNameBinding({
      tools: mode === "unrelated" ? [{ name: "other" }] : [],
      historyToolIds: mode === "historical" ? ["blocked"] : [],
    });
    await assert.rejects(
      mode === "denied" ? invoke : () => runWithToolNameBinding(binding, invoke),
      /undeclared tool identity: blocked/,
    );
    assert.equal(invoked, false);
    assert.equal(getToolNameBinding(), undefined);
  });
}

test("structured tool executes an active renamed identity within its original scope", async () => {
  const runtime = createTestRuntimeContext();
  const binding = createToolNameBinding({
    tools: [{ name: "allowed" }],
    bindings: { allowed: { bindingName: "bound_allowed" } },
  });
  const tool = structuredTool(
    runtime,
    () => {
      assert.equal(getToolNameBinding(), binding);
      return "executed";
    },
    { name: "allowed", description: "test", schema: z.object({}) },
  );
  assert.equal(await runWithToolNameBinding(binding, () => tool.invoke({})), "executed");
  assert.equal(getToolNameBinding(), undefined);
});

for (const mode of ["inactive", "mismatch", "missing-identity", "denied-context"]) {
  test(`execution entry points reject ${mode} before hooks, argument repair and events`, async () => {
    const effects = [];
    const hookManager = createHookManager();
    hookManager.on(HOOK_POINT.AGENT.BEFORE_TOOL_CALL, () => effects.push("hook"), {
      id: "authorization-test",
    });
    const runtime = createTestRuntimeContext({
      runConfig: { hookManager, toolPolicy: { denyToolNames: ["blocked"] } },
      eventListener: () => effects.push("event"),
    });
    const tool = {
      ...(mode === "missing-identity" ? {} : { name: mode === "mismatch" ? "other" : "blocked" }),
      get schema() {
        effects.push("schema");
        return z.object({});
      },
      invoke() {
        effects.push("invoke");
      },
    };
    const binding = createToolNameBinding({
      tools: mode === "inactive" ? [{ name: "other" }] : [{ name: "blocked" }],
    });
    const call = {
      id: "authorization-test",
      name: "blocked",
      args: {},
      [TOOL_CALL_NAME_BINDING]: binding,
    };
    const options = { call, tool, runtime };
    const expected = /undeclared tool identity|tool execution identity mismatch/;
    if (mode === "denied-context") {
      delete call[TOOL_CALL_NAME_BINDING];
      options.agentContext = { bindings: { tools: [tool] } };
      await assert.rejects(executeToolCall(options), expected);
    } else {
      await assert.rejects(executeToolCall(options), expected);
      await assert.rejects(startToolCallInTurn(options), expected);
    }
    assert.deepEqual(effects, []);
    assert.equal(getToolNameBinding(), undefined);
  });
}
