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

import { createAgentHookManager } from "../../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin } from "../src/index.js";
import { normalizeHookContextProtocol } from "../src/core/context.js";
import { injectPrompt, resolvePolicyPromptSelection } from "../src/tracing/buffer-manager.js";
import { buildDefaultPolicyPrompt } from "../src/tracing/policy-prompt-matrix.js";
import {
  applyDynamicPolicyPromptFromText,
  buildDynamicPolicyPromptProtocolInstruction,
} from "../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../src/capabilities/handlers/shared/constants.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("harness plugin rejects illegal FSM transitions and audits state commits", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    { basePath, promptPolicy: false, manifestDebounceMs: 0 },
  );

  await hookManager.emit("before_tool_calls", {
    userId: "u-fsm",
    sessionId: "s-fsm",
    dialogProcessId: "dp-fsm",
  });
  await hookManager.emit("on_error", {
    userId: "u-fsm",
    sessionId: "s-fsm",
    dialogProcessId: "dp-fsm",
    error: new Error("forced"),
  });

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp-fsm");
  await waitForFile(path.join(runDir, "events.jsonl"));
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "failed");

  const commits = await readJsonl(path.join(runDir, "events.jsonl"));
  assert.equal(commits.some((item) => item.kind === "fsm" && item.type === "fsm_transition_rejected"), true);
  assert.equal(commits.some((item) => item.kind === "fsm" && item.type === "fsm_transition" && item.to === "failed"), true);
});

test("harness plugin can resume FSM from manifest checkpoint", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp-resume");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "harness-run.json"),
    JSON.stringify(
      {
        status: "running",
        fsmStatus: "planning",
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  {
    const hookManager = createAgentHookManager();
    registerNoobotPlugin(
      { hookManager },
      { basePath, promptPolicy: false, manifestDebounceMs: 0 },
    );
    await hookManager.emit("after_llm_call", {
      userId: "u-resume",
      sessionId: "s-resume",
      dialogProcessId: "dp-resume",
      agentContext: {
        payload: {
          harness: {
            taskChecklist: [{ index: 1, task: "t1" }],
          },
        },
      },
    });
  }

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "planned");
  assert.equal(manifest.fsm?.resumedFromCheckpoint, true);

  await waitForFile(path.join(runDir, "events.jsonl"));
  const commits = await readJsonl(path.join(runDir, "events.jsonl"));
  assert.equal(commits.some((item) => item.kind === "fsm" && item.type === "fsm_resume"), true);
  assert.equal(commits.some((item) => item.kind === "fsm" && item.type === "fsm_transition" && item.to === "planned"), true);
});

test("harness FSM transition matrix (table-driven)", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  const runId = "dp-fsm-matrix";
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      manifestDebounceMs: 0,
      jsonlBatchSize: 1,
      jsonlFlushIntervalMs: 0,
    },
  );
  const runDir = path.join(basePath, "runtime", "harness", "runs", runId);
  const manifestPath = path.join(runDir, "harness-run.json");
  const eventsPath = path.join(runDir, "events.jsonl");

  const cases = [
    {
      name: "idle -> planning",
      point: "before_turn",
      ctx: {},
      expectedState: "planning",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "planning -> planned",
      point: "after_llm_call",
      ctx: {
        agentContext: {
          payload: {
            harness: {
              taskChecklist: [{ index: 1, task: "拆解任务" }],
            },
          },
        },
      },
      expectedState: "planned",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "planned -> executing",
      point: "before_tool_calls",
      ctx: {},
      expectedState: "executing",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "executing -> verifying",
      point: "before_final_output",
      ctx: { result: { output: "ok" } },
      expectedState: "verifying",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "verifying -> done",
      point: "after_turn",
      ctx: {},
      expectedState: "done",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "done -X-> executing should be rejected",
      point: "before_tool_calls",
      ctx: {},
      expectedState: "done",
      expectedAccepted: false,
      expectedCommitType: "fsm_transition_rejected",
      expectedAttemptedTo: "executing",
    },
  ];

  let seenCommits = 0;
  for (const item of cases) {
    await hookManager.emit(item.point, {
      userId: "u-fsm-matrix",
      sessionId: "s-fsm-matrix",
      dialogProcessId: runId,
      ...item.ctx,
    });

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.fsmStatus, item.expectedState, item.name);

    await waitForFile(eventsPath);
    const commits = await readJsonl(eventsPath);
    assert.equal(commits.length > seenCommits, true, `${item.name}: no new state commit`);
    const last = commits.findLast((commit) => commit.kind === "fsm" && commit.type === item.expectedCommitType);
    seenCommits = commits.length;

    assert.ok(last, `${item.name}: missing ${item.expectedCommitType}`);
    assert.equal(last.type, item.expectedCommitType, item.name);
    assert.equal(last.accepted, item.expectedAccepted, item.name);
    if (item.expectedAccepted) {
      assert.equal(last.to, item.expectedState, item.name);
    } else {
      assert.equal(last.from, "done", item.name);
      assert.equal(last.to, item.expectedAttemptedTo, item.name);
    }
  }
});

test("harness FSM remains planning when checklist is absent", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      manifestDebounceMs: 0,
      jsonlBatchSize: 1,
      jsonlFlushIntervalMs: 0,
    },
  );
  const runId = "dp-fsm-stay";
  const runDir = path.join(basePath, "runtime", "harness", "runs", runId);

  await hookManager.emit("before_turn", {
    userId: "u-fsm-stay",
    sessionId: "s-fsm-stay",
    dialogProcessId: runId,
  });
  await hookManager.emit("after_llm_call", {
    userId: "u-fsm-stay",
    sessionId: "s-fsm-stay",
    dialogProcessId: runId,
    ai: { content: "先读取上下文" },
    agentContext: {
      payload: {
        harness: {
          taskChecklist: [],
        },
      },
    },
  });

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "planning");
  const commits = await readJsonl(path.join(runDir, "events.jsonl"));
  assert.equal(commits.some((item) => item.kind === "fsm" && item.type === "fsm_transition" && item.to === "planned"), false);
});

