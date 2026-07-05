import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlanMultiTaskCollaborationTool } from "../../../src/system-core/tools/collaboration/agent-collab/tool-plan-collab.js";
import { resetModelAdapter, setModelAdapter } from "../../../src/system-core/model/index.js";

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function installFakeModel(content) {
  setModelAdapter({
    resolveDefaultModelSpec: () => ({ alias: "fake", model: "fake-model" }),
    createChatModel: () => ({
      invoke: async () => ({ content }),
    }),
  });
}

afterEach(() => {
  resetModelAdapter();
});

test("plan_multi_task_collaboration: JSON parse fallbacks write runtime-events with session context", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-plan-collab-"));
  installFakeModel('not json\n```json\n{ "tasks": [\n```');

  const runtime = {
    userId: "u1",
    globalConfig: { workspaceRoot },
    userConfig: {},
    systemRuntime: {
      sessionId: "s1",
      dialogProcessId: "dp1",
      turnScopeId: "turn1",
    },
  };
  const tool = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig: runtime.globalConfig,
    userConfig: runtime.userConfig,
  });

  await tool.invoke({ task: "split this task" });

  const records = await readJsonl(path.join(workspaceRoot, "u1", "runtime", "session", "s1", "events", "system.jsonl"));
  const fallback = records.find((item) => item.event === "agent.collab.planJsonParse.fallbackToMarkdown");
  const markdownFailed = records.find((item) => item.event === "agent.collab.planMarkdownJsonParse.failed");

  for (const record of [fallback, markdownFailed]) {
    assert.ok(record);
    assert.equal(record.source, "agent");
    assert.equal(record.channel, "direct");
    assert.equal(record.category, "system");
    assert.equal(record.userId, "u1");
    assert.equal(record.sessionId, "s1");
    assert.equal(record.dialogProcessId, "dp1");
    assert.equal(record.turnScopeId, "turn1");
    assert.equal(record.data.toolName, "plan_multi_task_collaboration");
    assert.equal(record.data.hasMarkdownBlock, true);
    assert.ok(record.data.error);
  }
});

test("plan_multi_task_collaboration: JSON parse fallback without session writes routed system telemetry", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-plan-collab-nosession-"));
  installFakeModel("not json");

  const runtime = {
    userId: "",
    globalConfig: { workspaceRoot },
    userConfig: {},
    systemRuntime: {},
  };
  const tool = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig: runtime.globalConfig,
    userConfig: runtime.userConfig,
  });

  await tool.invoke({ task: "split this task" });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "system",
    "runtime",
    "events",
    "system",
    "agent",
    "system.jsonl",
  ));
  const fallback = records.find((item) => item.event === "agent.collab.planJsonParse.fallbackToMarkdown");
  for (const record of [fallback]) {
    assert.ok(record);
    assert.equal(record.source, "agent");
    assert.equal(record.channel, "direct");
    assert.equal(record.category, "system");
    assert.equal(record.userId, undefined);
    assert.equal(record.sessionId, undefined);
    assert.equal(record.data.toolName, "plan_multi_task_collaboration");
  }
});
