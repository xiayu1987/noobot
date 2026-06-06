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

test("SessionExecutionEngine preserves injected flags in detached sub-session messages", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const normalized = engine._normalizeDetachedSubSessionMessage(
    {
      role: "user",
      content: "injected prompt",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      frontendUserMessage: true,
    },
    "2026-06-04T00:00:00.000Z",
  );

  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "harness-plugin");
  assert.equal(normalized.frontendUserMessage, true);
});

test("SessionExecutionEngine injects mini-runner capabilityModelInvoker for plugin separate_model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-plugin-"));
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
  assert.equal(typeof prepared.hookManager.runtime?.harness, "object");
  assert.equal(prepared.hookManager.runtime.harness.mode, "on");
});

test("SessionExecutionEngine preserves explicit plugin capabilityModelInvoker", async () => {
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

test("SessionExecutionEngine harness plugin does not force-inject denyToolNames by default", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        harness: { enabled: true, mode: "on" },
      },
    },
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: { enabled: true, mode: "on" },
      },
    },
  });

  assert.equal(prepared?.plugins?.harness?.enabled, true);
  assert.equal(prepared?.toolPolicy, undefined);
});

test("SessionExecutionEngine harness plugin can inject denyToolNames from harness options", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        harness: { enabled: true, mode: "on", denyToolNames: ["plan_multi_task_collaboration"] },
      },
    },
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: { enabled: true, mode: "on" },
      },
    },
  });

  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, ["plan_multi_task_collaboration"]);
});

test("SessionExecutionEngine deep-merges plugin step model config", async () => {
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

test("SessionExecutionEngine defaults plugin miniRunnerMaxTurns to 5", async () => {
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

test("SessionExecutionEngine caps plugin miniRunnerMaxTurns at 5", async () => {
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

test("SessionExecutionEngine raises plugin timeoutMs for separate_model planning", async () => {
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

test("SessionExecutionEngine injects workflow resolveModelMessages with recent window", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareWorkflowRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        workflow: {
          enabled: true,
          mode: "on",
          contextWindowRecentMessageLimit: 2,
        },
      },
    },
  });

  const resolver = prepared.plugins.workflow.resolveModelMessages;
  assert.equal(typeof resolver, "function");
  const resolved = resolver({
    messages: [
      { role: "system", content: "policy" },
      { role: "user", content: "old" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "current", frontendUserMessage: true },
    ],
  });

  assert.deepEqual(resolved, [
    { role: "user", content: "old", summarized: false },
    { role: "user", content: "current", summarized: false, frontendUserMessage: true },
  ]);
});

test("SessionExecutionEngine injects plugin resolveModelMessages with recent window", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          contextWindowRecentMessageLimit: 3,
        },
      },
    },
  });

  const resolver = prepared.plugins.harness.resolveModelMessages;
  assert.equal(typeof resolver, "function");

  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1", summarized: true },
    { role: "assistant", content: "a2" },
    { role: "assistant", content: "a3" },
    { role: "assistant", content: "a4" },
  ];
  const resolved = resolver({ messages });

  assert.equal(Array.isArray(resolved), true);
  assert.deepEqual(resolved, [
    { role: "user", content: "u1", summarized: false },
    { role: "assistant", content: "a3", summarized: false },
    { role: "assistant", content: "a4", summarized: false },
  ]);
});

test("SessionExecutionEngine injects plugin resolveMessageBlock for history/incremental unified filtering", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          contextWindowRecentMessageLimit: 2,
          incrementalRecentMessageLimit: 3,
        },
      },
    },
  });
  const resolver = prepared.plugins.harness.resolveMessageBlock;
  assert.equal(typeof resolver, "function");

  const historyResolved = resolver({
    scope: "history",
    messages: [
      { role: "assistant", content: "h1" },
      { role: "assistant", content: "h2" },
      { role: "assistant", content: "h3" },
    ],
    ctx: { dialogProcessId: "dlg1" },
  });
  const incrementalResolved = resolver({
    scope: "incremental",
    messages: [
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
      { role: "assistant", content: "a3" },
      { role: "assistant", content: "a4" },
    ],
    ctx: { dialogProcessId: "dlg1" },
  });
  const conversationResolved = resolver({
    scope: "conversation",
    messages: [
      { role: "assistant", content: "h1" },
      { role: "assistant", content: "h2" },
      { role: "user", content: "u1" },
      { role: "user", content: "u2" },
    ],
    ctx: { dialogProcessId: "dlg1" },
  });
  const systemResolved = resolver({
    scope: "system",
    messages: [
      { role: "system", content: "policy" },
      { role: "assistant", content: "a", summarized: true },
    ],
    ctx: { dialogProcessId: "dlg1" },
  });
  assert.deepEqual(historyResolved.map((item) => item.content), ["h2", "h3"]);
  assert.deepEqual(incrementalResolved.map((item) => item.content), ["a2", "a3", "a4"]);
  assert.deepEqual(conversationResolved.map((item) => item.content), ["u1", "u2"]);
  assert.deepEqual(systemResolved.map((item) => item.content), ["policy"]);
});

test("SessionExecutionEngine injects plugin markMessagesSummarized aligned with agent summary policy", async () => {
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
  const marked = await summarizer({ messages });
  assert.equal(marked, 4);
  assert.equal(messages[0].summarized, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, true);
  assert.equal(messages[3].summarized, true);
  assert.equal(messages[4].summarized, true);
});

test("SessionExecutionEngine markMessagesSummarized supports scoped marking", async () => {
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
  const messages = [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
    { role: "assistant", content: "", tool_calls: [{ id: "c2", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
  ];

  const marked = await summarizer({
    messages,
    summaryScope: {
      maxMessages: 2,
      limitToProvidedMessagesOnly: true,
    },
  });

  assert.equal(marked, 2);
  assert.equal(messages[0].summarized, true);
  assert.equal(messages[1].summarized, true);
  assert.equal(messages[2].summarized, undefined);
  assert.equal(messages[3].summarized, undefined);
});

test("SessionExecutionEngine resolveModelMessages normalizes LangChain messages for plugin model", async () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {},
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
  assert.equal(Array.isArray(resolved), true);
  assert.deepEqual(resolved, [
    { role: "user", content: "查找最适合组织的人", summarized: false },
    { role: "user", content: '[user_meta]\n{"sessionId":"s1","attachments":[]}\n[/user_meta]', summarized: false },
    { role: "assistant", content: "收到，准备规划", summarized: false },
  ]);
});

test("SessionExecutionEngine resolveModelMessages filters injected messages from non-current dialog", async () => {
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
  const resolver = prepared.plugins.harness.resolveModelMessages;
  const resolved = resolver({
    messages: [
      {
        role: "assistant",
        content: "current injected",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dlg_current",
      },
      {
        role: "assistant",
        content: "old injected",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dlg_old",
      },
      {
        role: "assistant",
        content: "normal response",
      },
    ],
    ctx: {
      dialogProcessId: "dlg_current",
    },
  });

  assert.deepEqual(resolved, [
    {
      role: "assistant",
      content: "current injected",
      summarized: false,
      injectedMessage: true,
      injectedBy: "harness-plugin",
    },
    { role: "assistant", content: "normal response", summarized: false },
  ]);
});

test("SessionExecutionEngine workflow plugin injects unified denyToolNames policy", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        workflow: { enabled: true, mode: "on" },
      },
    },
  });
  const prepared = engine._prepareWorkflowRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["workflow"],
      toolPolicy: {
        mode: "append_custom",
      },
      plugins: {
        workflow: { enabled: true, mode: "on" },
      },
    },
    userConfig: {},
  });

  assert.equal(prepared?.plugins?.workflow?.enabled, true);
  assert.equal(prepared?.plugins?.workflow?.mode, "on");
  assert.equal(prepared?.toolPolicy?.mode, "append_custom");
  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, [
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
  ]);
});

test("SessionExecutionEngine workflow plugin merges existing denyToolNames", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        workflow: { enabled: true, mode: "on" },
      },
    },
  });
  const prepared = engine._prepareWorkflowRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["workflow"],
      toolPolicy: {
        denyToolNames: ["request_help", "delegate_task_async"],
      },
      plugins: {
        workflow: { enabled: true, mode: "on" },
      },
    },
    userConfig: {},
  });

  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, [
    "request_help",
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
  ]);
});

test("SessionExecutionEngine workflow plugin denyToolNames comes from workflow plugin options", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        workflow: {
          enabled: true,
          mode: "on",
          denyToolNames: ["request_help"],
        },
      },
    },
  });
  const prepared = engine._prepareWorkflowRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["workflow"],
      plugins: {
        workflow: { enabled: true, mode: "on" },
      },
    },
    userConfig: {},
  });

  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, ["request_help"]);
});

test("SessionExecutionEngine plugin register api exposes unified policy helpers", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const pluginApi = engine._buildPluginRegisterApi({
    manager: { on: () => () => {} },
    pluginName: "workflow",
    options: { enabled: true, mode: "on" },
    runConfig: {
      toolPolicy: {
        mode: "append_custom",
      },
    },
  });

  assert.equal(typeof pluginApi?.policy?.appendDenyToolNames, "function");
  assert.equal(typeof pluginApi?.policy?.setToolPolicy, "function");
  assert.equal(typeof pluginApi?.policy?.getToolPolicy, "function");

  pluginApi.policy.appendDenyToolNames(["delegate_task_async"]);
  pluginApi.policy.setToolPolicy({ forceIncludeUserInteraction: false });
  const toolPolicy = pluginApi.policy.getToolPolicy();

  assert.equal(toolPolicy?.mode, "append_custom");
  assert.equal(toolPolicy?.forceIncludeUserInteraction, false);
  assert.deepEqual(toolPolicy?.denyToolNames, ["delegate_task_async"]);
});
