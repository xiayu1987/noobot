/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createToolNameBinding, TOOL_CALL_NAME_BINDING } from "@noobot/model-protocol";
import { getToolNameBinding } from "@noobot/model-protocol/tool-binding-scope-node";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { tTool } from "../../../src/tools/core/tool-i18n.js";
import { executeToolCallInTurn } from "../../../src/runtime/tool-execution/tool-runner.js";
import { executeToolCall } from "./tool-runner.test-helpers.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

for (const fail of [false, true]) {
  test(`request binding covers execution hooks and result finalization (failure=${fail})`, async () => {
    const hookManager = createHookManager();
    const runtime = createTestRuntimeContext({
      globalConfig: { tools: { bindings: { read_file: { bindingName: "old_read" } } } },
      userConfig: { tools: { maxToolResultChars: 512 } },
      runConfig: { hookManager },
    });
    const binding = createToolNameBinding({
      tools: [{ name: "read_file" }],
      bindings: runtime.globalConfig.tools.bindings,
    });
    const phases = [];
    const expected = binding.renderReferences("{{tool:read_file}}");
    for (const point of [
      HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
      HOOK_POINT.AGENT.TOOL_CALL_ERROR,
      HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    ]) {
      hookManager.on(
        point,
        () => {
          assert.equal(getToolNameBinding(), binding);
          assert.match(tTool(runtime, "tools.result.readFileSourceReferenceOverflow"), /old_read/);
          phases.push(point);
        },
        { id: `binding-${point}` },
      );
    }
    const result = await executeToolCall({
      runtime,
      call: {
        id: `lifecycle-${fail}`,
        name: "read_file",
        args: {},
        [TOOL_CALL_NAME_BINDING]: binding,
      },
      tool: {
        name: "read_file",
        async invoke() {
          runtime.globalConfig.tools.bindings.read_file.bindingName = "new_read";
          await Promise.resolve();
          if (fail) throw new Error("intentional invocation failure");
          return {
            ok: true,
            toolName: "read_file",
            path: { view: "workspace", path: "large.txt" },
            fileName: "large.txt",
            startLine: 1,
            endLine: 1,
            totalLines: 1,
            numberedContent: "x".repeat(
              LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars + 1,
            ),
          };
        },
      },
    });
    assert.equal(result.success, !fail);
    if (fail) assert.match(result.toolResultText, /intentional invocation failure/);
    else {
      const output = JSON.parse(result.toolResultText);
      assert.equal(output.overflowed, true);
      assert.match(output.message, new RegExp(expected));
      assert.doesNotMatch(output.message, /new_read/);
    }
    assert.deepEqual(phases, [
      HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
      ...(fail ? [HOOK_POINT.AGENT.TOOL_CALL_ERROR] : []),
      HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    ]);
    assert.equal(getToolNameBinding(), undefined);
  });
}

test("model execution refuses a call without its request binding before invoking the tool", async () => {
  let invoked = false;
  await assert.rejects(
    executeToolCallInTurn({
      call: { id: "missing-binding", name: "read_file", args: {} },
      runtime: createTestRuntimeContext(),
      tool: {
        invoke() {
          invoked = true;
        },
      },
    }),
    /request name binding/,
  );
  assert.equal(invoked, false);
});
