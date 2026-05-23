import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

import { SessionExecutionEngine } from "../session-execution-engine.js";

function createWorkspaceService(basePath) {
  return { getWorkspacePath: () => basePath };
}

test("SessionExecutionEngine injects mini-runner capabilityModelInvoker for harness separate_model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-harness-"));
  const engine = new SessionExecutionEngine({
    globalConfig: {},
    workspaceService: createWorkspaceService(basePath),
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: 2,
          miniRunnerToolAllowlist: ["call_service"],
        },
      },
    },
  });

  assert.equal(typeof prepared.hookManager?.emit, "function");
  assert.equal(prepared.plugins.harness.enabled, true);
  assert.equal(prepared.plugins.harness.basePath, basePath);
  assert.equal(prepared.plugins.harness.planningGuidanceMode, "separate_model");
  assert.equal(typeof prepared.plugins.harness.capabilityModelInvoker, "function");
});

test("SessionExecutionEngine preserves explicit harness capabilityModelInvoker", async () => {
  const explicitInvoker = async () => ({ output: "ok" });
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          capabilityModelInvoker: explicitInvoker,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.capabilityModelInvoker, explicitInvoker);
});

test("SessionExecutionEngine deep-merges harness step model config", async () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          stepModels: {
            planning: "planner_global",
            summary: "summary_global",
          },
        },
      },
    },
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          mode: "on",
          stepModels: {
            planning: "planner_run",
            guidance: "guidance_run",
          },
        },
      },
    },
  });

  assert.deepEqual(prepared.plugins.harness.stepModels, {
    planning: "planner_run",
    summary: "summary_global",
    guidance: "guidance_run",
  });
});

test("SessionExecutionEngine defaults harness miniRunnerMaxTurns to 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.miniRunnerMaxTurns, 5);
});

test("SessionExecutionEngine caps harness miniRunnerMaxTurns at 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: 99,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.miniRunnerMaxTurns, 5);
});

test("SessionExecutionEngine raises harness timeoutMs for separate_model planning", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          timeoutMs: 1000,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.timeoutMs, 180_000);
});

test("SessionExecutionEngine injects harness resolveModelMessages aligned with session.recentMessageLimit", async () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      session: {
        recentMessageLimit: 3,
      },
    },
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const resolver = prepared.plugins.harness.resolveModelMessages;
  assert.equal(typeof resolver, "function");

  const resolved = resolver({
    messages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1", summarized: true },
      { role: "assistant", content: "a2" },
      { role: "assistant", content: "a3" },
      { role: "assistant", content: "a4" },
    ],
  });

  assert.equal(Array.isArray(resolved), true);
  assert.equal(resolved.length, 3);
  assert.deepEqual(
    resolved.map((item = {}) => String(item?.content || "")),
    ["u1", "a3", "a4"],
  );
});

test("SessionExecutionEngine injects harness markMessagesSummarized aligned with agent summary policy", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const summarizer = prepared.plugins.harness.markMessagesSummarized;
  assert.equal(typeof summarizer, "function");

  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "task" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
    { role: "tool", content: '{"toolName":"task_summary","ok":true}' },
  ];
  const marked = summarizer({ messages });
  assert.equal(marked, 2);
  assert.equal(messages[0].summarized, undefined);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, true);
  assert.equal(messages[3].summarized, true);
  assert.equal(messages[4].summarized, undefined);
});

test("SessionExecutionEngine resolveModelMessages normalizes langchain messages and keeps current user input", async () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      session: {
        recentMessageLimit: 8,
      },
    },
  });
  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.harness.resolveModelMessages;
  const resolved = resolver({
    messages: [
      new HumanMessage("查找最适合组织的人"),
      new HumanMessage('[user_meta]\n{"sessionId":"s1","attachments":[]}\n[/user_meta]'),
      new AIMessage("收到，准备规划"),
    ],
    ctx: {
      agentContext: {
        execution: {
          controllers: {
            runtime: {
              systemRuntime: {
                currentTurnUserMessage: "查找最适合组织的人",
              },
            },
          },
        },
      },
    },
  });
  assert.deepEqual(
    resolved.map((item = {}) => ({ role: item.role, content: item.content })),
    [
      { role: "user", content: "查找最适合组织的人" },
      { role: "assistant", content: "收到，准备规划" },
    ],
  );
});
