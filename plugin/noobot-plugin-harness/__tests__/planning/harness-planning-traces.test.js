/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  exists,
  fs,
  os,
  path,
  readJsonl,
  registerNoobotPlugin,
  test,
  waitForFile,
} from "./helpers/harness-planning-helper.js";

test("harness writes capability model traces to dedicated jsonl artifact", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({
        content: '{"taskOwner":"Noobot","taskChecklist":[{"index":1,"task":"检查上下文","owner":"Noobot"}]}',
        output: '{"taskOwner":"Noobot","taskChecklist":[{"index":1,"task":"检查上下文","owner":"Noobot"}]}',
        finishedReason: "no_tool_call",
        turn: 1,
        traces: [
          {
            turn: 1,
            purpose: "planning",
            domain: "planning",
            locale: "zh-CN",
            toolCalls: [{ name: "call_service", id: "c1", status: "executed" }],
          },
        ],
      }),
    },
  );

  const ctx = {
    executionScope: "primary",
    userId: "u7",
    sessionId: "s7",
    dialogProcessId: "dp7",
    caller: "user",
    messages: [{ role: "user", content: "hello" }],
    agentContext: {
      payload: { messages: { system: [], history: [] } },
      execution: { controllers: { runtime: { basePath } } },
    },
  };
  await hookManager.emit("before_llm_call", ctx);

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp7");
  const traceFile = path.join(runDir, "capability-traces.jsonl");
  assert.equal(await waitForFile(traceFile), true);
  const [line] = (await fs.readFile(traceFile, "utf8")).trim().split("\n");
  const record = JSON.parse(line);
  assert.equal(record.event, "capability_model_trace");
  assert.equal(record.detail.purpose, "planning");
  assert.equal(record.detail.traces[0].toolCalls[0].status, "executed");

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.paths.capabilityTraces, traceFile);
});
