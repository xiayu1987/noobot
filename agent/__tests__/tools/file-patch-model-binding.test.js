/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  test,
  assert,
  fs,
  os,
  path,
  createFileTool,
  buildAgentContext,
  executeToolCall,
} from "./helpers/file-script-length-guards-helper.js";
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import { createBoundLlmToolChoiceInvoker } from "../../src/runtime/turn/tool-invoke-strategy.js";
import { createCapabilityModelStep } from "../../src/runtime/capability-runner/model-step.js";

for (const flow of ["main", "capability"]) {
  test(`${flow} binds request-visible reads through actual patch execution and isolates later requests`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-model-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const agentContext = buildAgentContext(root);
    const runtime = agentContext.bindings.runtime;
    const tools = new Map(createFileTool({ agentContext }).map((tool) => [tool.name, tool]));
    await fs.writeFile(path.join(root, "a"), "old\n");
    const result = await tools.get("read_file").invoke({ filePath: "a", riskLevel: "low" });
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "read-1", name: "read_file", args: { filePath: "a" } }],
      },
      { role: "tool", tool_call_id: "read-1", content: result },
    ];
    const spec = normalizeRuntimeModelSpec({
      model: "test-model",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
    });
    const modelPort = {
      async invoke(request) {
        assert.equal(request.messages.length, messages.length);
        return {
          toolNameBindings: {},
          output: {
            text: "",
            toolCalls: [
              {
                id: "patch-1",
                name: "patch_file",
                args: {
                  patch: "*** Begin Patch\n*** Update File: a\n@@ L1\n-old\n+new\n*** End Patch",
                  riskLevel: "low",
                },
              },
            ],
          },
        };
      },
    };
    runtime.modelHost = { modelPort };
    const invoke =
      flow === "main"
        ? createBoundLlmToolChoiceInvoker({
            adaptedBinding: {},
            boundTools: [...tools.values()],
            messages,
            modelState: { activeModelSpec: spec, modelPort },
            runtime,
          })
        : async () =>
            (
              await createCapabilityModelStep({
                runtime,
                model: spec,
                identity: { headers: {}, invocation: {} },
                activity: null,
                streaming: false,
              })(messages)
            ).response.output;
    const output = await invoke();
    messages.length = 0;
    const isolated = await invoke();
    const execute = (call) =>
      executeToolCall({
        call,
        tool: tools.get("patch_file"),
        runtime,
        agentContext,
        executionScope: flow,
        turn: 1,
        errorLogger: null,
      });
    const rejected = await execute(isolated.toolCalls[0]);
    assert.equal(rejected.success, false);
    assert.match(rejected.toolResultText, /read these files again/);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "old\n");
    const applied = await execute(output.toolCalls[0]);
    assert.equal(applied.success, true, applied.toolResultText);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "new\n");
  });
}
