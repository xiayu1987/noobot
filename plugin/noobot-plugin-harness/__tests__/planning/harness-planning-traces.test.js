/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  createTestModelResponse,
  exists,
  fs,
  os,
  path,
  readJsonl,
  registerHarnessCore,
  test,
  waitForFile,
} from "../helpers/harness-planning-helper.js";

test("harness writes capability model traces to dedicated jsonl artifact", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () =>
        createTestModelResponse(
          '{"taskOwner":"Noobot","taskChecklist":[{"index":1,"task":"检查上下文","owner":"Noobot"}]}',
          { toolCalls: [{ name: "call_service", id: "c1", status: "executed" }] },
        ),
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
  await hookManager.emit("agent.before_llm_call", ctx);

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp7");
  const traceFile = path.join(runDir, "capability-traces.jsonl");
  assert.equal(await waitForFile(traceFile), true);
  const [line] = (await fs.readFile(traceFile, "utf8")).trim().split("\n");
  const record = JSON.parse(line);
  assert.equal(record.event, "capability_model_trace");
  assert.equal(typeof record.traceId, "string");
  assert.equal(record.traceId.length > 0, true);
  assert.equal(record.detail.purpose, "planning");
  assert.equal(record.detail.modelAttempts[0].output.toolCalls[0].status, "executed");

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.paths.capabilityTraces, traceFile);
});
