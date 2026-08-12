/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlanMultiTaskCollaborationTool } from "../../src/tools/collaboration/agent-collab/tool-plan-collab.js";

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function installFakeModel(runtime, content, onRequest = null) {
  runtime.globalConfig.defaultProvider = "fake";
  runtime.globalConfig.providers = {
    fake: {
      alias: "fake",
      model: "fake-model",
      format: "openai_compatible",
      providerId: "fake",
      adapterId: "openai-compatible",
    },
  };
  runtime.modelPort = {
    invoke: async (request) => {
      onRequest?.(request);
      return { output: { text: content }, text: content };
    },
  };
}

test("plan_multi_task_collaboration: JSON parse fallbacks write runtime-events with session context", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-plan-collab-"));
  const sessionDir = path.join(workspaceRoot, "u1", "runtime", "session", "s1");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, "session.json"),
    JSON.stringify({ sessionId: "s1" }),
    "utf8",
  );
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
  installFakeModel(runtime, 'not json\n```json\n{ "tasks": [\n```');
  const tool = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig: runtime.globalConfig,
    userConfig: runtime.userConfig,
  });

  await tool.invoke({ task: "split this task" });

  const records = await readJsonl(
    path.join(workspaceRoot, "u1", "runtime", "session", "s1", "events", "system.jsonl"),
  );
  const fallback = records.find(
    (item) => item.event === "agent.collab.planJsonParse.fallbackToMarkdown",
  );
  const markdownFailed = records.find(
    (item) => item.event === "agent.collab.planMarkdownJsonParse.failed",
  );

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

test("plan_multi_task_collaboration: JSON parse fallback without session writes routed system runtime event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-plan-collab-nosession-"));
  const runtime = {
    userId: "",
    globalConfig: { workspaceRoot },
    userConfig: {},
    systemRuntime: {},
  };
  installFakeModel(runtime, "not json");
  const tool = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig: runtime.globalConfig,
    userConfig: runtime.userConfig,
  });

  await tool.invoke({ task: "split this task" });

  const records = await readJsonl(
    path.join(workspaceRoot, "system", "runtime", "events", "system", "agent", "system.jsonl"),
  );
  const fallback = records.find(
    (item) => item.event === "agent.collab.planJsonParse.fallbackToMarkdown",
  );
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

test("plan_multi_task_collaboration: model invoke receives runtime abort signal", async () => {
  const abortController = new AbortController();
  let receivedRequest;

  const runtime = {
    abortSignal: abortController.signal,
    globalConfig: {},
    userConfig: {},
    systemRuntime: {},
  };
  installFakeModel(runtime, JSON.stringify({ tasks: [] }), (request) => {
    receivedRequest = request;
  });
  const tool = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig: runtime.globalConfig,
    userConfig: runtime.userConfig,
  });

  await tool.invoke({ task: "split this task" });

  assert.equal(receivedRequest?.options?.signal, abortController.signal);
  assert.equal(receivedRequest?.model?.model, "fake-model");
  assert.equal(receivedRequest?.model?.format, "openai_compatible");
  assert.equal(receivedRequest?.messages?.[0]?.role, "system");
  assert.equal(receivedRequest?.messages?.[1]?.role, "user");
});
