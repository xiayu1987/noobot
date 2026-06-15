import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

import { SessionExecutionEngine } from "../../../../src/system-core/bot-manage/session/session-execution-engine.js";
import { AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS, AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS } from "../../../../src/system-core/bot-manage/session/run-config-plugin-preparer.js";

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
      injectedBy: "agent-plugin",
      frontendUserMessage: true,
    },
    "2026-06-04T00:00:00.000Z",
  );

  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "agent-plugin");
  assert.equal(normalized.frontendUserMessage, true);
});

test("SessionExecutionEngine injects mini-runner capabilityModelInvoker for plugin separate_model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-plugin-"));
  const engine = new SessionExecutionEngine({
    globalConfig: {},
    workspaceService: createWorkspaceService(basePath),
  });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
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
  assert.equal(prepared.plugins.agentPlugin.enabled, true);
  assert.equal(prepared.plugins.agentPlugin.basePath, basePath);
  assert.equal(prepared.plugins.agentPlugin.planningGuidanceMode, "separate_model");
  assert.equal(typeof prepared.plugins.agentPlugin.capabilityModelInvoker, "function");
  assert.equal(typeof prepared.hookManager.runtime?.agentPlugin, "object");
  assert.equal(prepared.hookManager.runtime.agentPlugin.mode, "on");
});

test("SessionExecutionEngine preserves explicit plugin capabilityModelInvoker", async () => {
  const explicitInvoker = async () => ({ output: "ok" });
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          capabilityModelInvoker: explicitInvoker,
        },
      },
    },
  });

  assert.equal(prepared.plugins.agentPlugin.capabilityModelInvoker, explicitInvoker);
});

test("SessionExecutionEngine agent plugin applies default denyToolNames policy", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        agentPlugin: { enabled: true, mode: "on" },
      },
    },
  });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["agentPlugin"],
      plugins: {
        agentPlugin: { enabled: true, mode: "on" },
      },
    },
  });

  assert.equal(prepared?.plugins?.agentPlugin?.enabled, true);
  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, [
    "plan_multi_task_collaboration",
    "task_summary",
  ]);
});

test("SessionExecutionEngine agent plugin can inject denyToolNames from agent plugin options", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        agentPlugin: { enabled: true, mode: "on", denyToolNames: ["plan_multi_task_collaboration"] },
      },
    },
  });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["agentPlugin"],
      plugins: {
        agentPlugin: { enabled: true, mode: "on" },
      },
    },
  });

  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, ["plan_multi_task_collaboration"]);
});

test("SessionExecutionEngine deep-merges plugin step model config", async () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        agentPlugin: {
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

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          mode: "on",
          stepModels: {
            planning: "planner_run",
            guidance: "guidance_run",
          },
        },
      },
    },
  });

  assert.deepEqual(prepared.plugins.agentPlugin.stepModels, {
    planning: "planner_run",
    summary: "summary_global",
    guidance: "guidance_run",
  });
});

test("SessionExecutionEngine defaults plugin miniRunnerMaxTurns to 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
        },
      },
    },
  });

  assert.equal(prepared.plugins.agentPlugin.miniRunnerMaxTurns, AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS);
});

test("SessionExecutionEngine caps plugin miniRunnerMaxTurns at 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: 99,
        },
      },
    },
  });

  assert.equal(prepared.plugins.agentPlugin.miniRunnerMaxTurns, AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS);
});

test("SessionExecutionEngine raises plugin timeoutMs for separate_model planning", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          timeoutMs: 1000,
        },
      },
    },
  });

  assert.equal(prepared.plugins.agentPlugin.timeoutMs, AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS);
});

test("SessionExecutionEngine injects bot plugin resolveModelMessages without plugin window config", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareBotPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        botPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const resolver = prepared.plugins.botPlugin.resolveModelMessages;
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
    { role: "system", content: "policy", summarized: false },
    { role: "user", content: "old", summarized: false },
    { role: "assistant", content: "a1", summarized: false },
    { role: "user", content: "current", summarized: false, frontendUserMessage: true },
  ]);
});

test("SessionExecutionEngine injects plugin resolveModelMessages without plugin window config", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const resolver = prepared.plugins.agentPlugin.resolveModelMessages;
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
    { role: "system", content: "policy", summarized: false },
    { role: "user", content: "u1", summarized: false },
    { role: "assistant", content: "a2", summarized: false },
    { role: "assistant", content: "a3", summarized: false },
    { role: "assistant", content: "a4", summarized: false },
  ]);
});

test("SessionExecutionEngine injects plugin resolveMessageBlock with main-flow filtering", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveMessageBlock;
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
  assert.deepEqual(historyResolved.map((item) => item.content), ["h1", "h2", "h3"]);
  assert.deepEqual(incrementalResolved.map((item) => item.content), ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(conversationResolved.map((item) => item.content), ["h1", "h2", "u1", "u2"]);
  assert.deepEqual(systemResolved.map((item) => item.content), ["policy"]);
});

test("SessionExecutionEngine injects plugin markMessagesSummarized aligned with agent summary policy", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const summarizer = prepared.plugins.agentPlugin.markMessagesSummarized;
  assert.equal(typeof summarizer, "function");

  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "task" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
    { role: "tool", content: '{"toolName":"task_summary","ok":true}' },
  ];
  const marked = await summarizer({ messages });
  assert.equal(marked, 3);
  assert.equal(messages[0].summarized, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, true);
  assert.equal(messages[3].summarized, true);
  assert.equal(messages[4].summarized, undefined);
});

test("SessionExecutionEngine markMessagesSummarized supports scoped marking", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const summarizer = prepared.plugins.agentPlugin.markMessagesSummarized;
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
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveModelMessages;
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

test("SessionExecutionEngine resolveModelMessages compacts semantic-transfer tool content", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveModelMessages;
  const attachmentMeta = {
    attachmentId: "att-agent-plugin",
    name: "result.md",
    mimeType: "text/markdown",
    size: 12,
    relativePath: "runtime/attach/scoped/s1/model/result.md",
  };
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/result.md",
    files: [{ filePath: "/workspace/result.md", attachmentMeta }],
  };
  const resolved = resolver({
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "echo" } }] },
      {
        role: "tool",
        tool_call_id: "c1",
        content: JSON.stringify({
          ok: true,
          transferEnvelope: envelope,
          transferEnvelopes: [envelope],
          attachmentMetas: [attachmentMeta],
        }),
      },
    ],
  });

  const compactedToolPayload = JSON.parse(resolved.find((item) => item.role === "tool").content);
  assert.equal("transferEnvelope" in compactedToolPayload, false);
  assert.equal("transferEnvelopes" in compactedToolPayload, false);
  assert.equal("attachmentMetas" in compactedToolPayload, false);
  assert.equal(compactedToolPayload.transferFiles[0].attachmentId, "att-agent-plugin");
});

test("SessionExecutionEngine resolveModelMessages filters injected messages from non-current dialog", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveModelMessages;
  const resolved = resolver({
    messages: [
      {
        role: "assistant",
        content: "current injected",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        dialogProcessId: "dlg_current",
      },
      {
        role: "assistant",
        content: "old injected",
        injectedMessage: true,
        injectedBy: "agent-plugin",
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
      injectedBy: "agent-plugin",
      dialogProcessId: "dlg_current",
    },
    { role: "assistant", content: "normal response", summarized: false },
  ]);
});

test("SessionExecutionEngine resolveModelMessages treats persisted harness summary relays as injected history", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveModelMessages;
  const resolved = resolver({
    messages: [{ role: "user", content: "当前增量" }],
    ctx: {
      dialogProcessId: "dlg_current",
      messageBlocks: {
        system: [],
        history: [
          { role: "user", content: "真实历史用户", dialogProcessId: "dlg_old" },
          {
            role: "user",
            content: "[来自harness外部模型输出/summary]\n历史小结一：不应作为实际用户历史",
            dialogProcessId: "dlg_old",
          },
          {
            role: "user",
            content: "[Relay from harness external model/summary]\nhistorical summary two",
            dialogProcessId: "dlg_old",
          },
          { role: "assistant", content: "历史最终回答", dialogProcessId: "dlg_old" },
        ],
        incremental: [
          { role: "user", content: "当前增量", dialogProcessId: "dlg_current" },
        ],
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => String(item.content || "")),
    ["真实历史用户", "历史最终回答", "当前增量"],
  );
});


test("SessionExecutionEngine resolveMessageBlock prefers current incremental dialog over stale ctx dialog", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const prepared = engine.runConfigPluginPreparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });
  const resolver = prepared.plugins.agentPlugin.resolveMessageBlock;

  const incrementalResolved = resolver({
    scope: "incremental",
    messages: [
      {
        role: "user",
        content: "old summary",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "current summary",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        dialogProcessId: "dlg_current",
      },
    ],
    ctx: { dialogProcessId: "dlg_old" },
  });

  assert.deepEqual(
    incrementalResolved.map((item) => item.content),
    ["current summary"],
  );

  const conversationResolved = resolver({
    scope: "conversation",
    messages: [
      {
        role: "user",
        content: "old summary",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "normal history",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "current planning",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        dialogProcessId: "dlg_current",
      },
    ],
    ctx: { dialogProcessId: "dlg_old" },
  });

  assert.deepEqual(
    conversationResolved.map((item) => item.content),
    ["normal history", "current planning"],
  );
});

test("SessionExecutionEngine bot plugin injects unified denyToolNames policy", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        botPlugin: { enabled: true, mode: "on" },
      },
    },
  });
  const prepared = engine.runConfigPluginPreparer.prepareBotPluginRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["botPlugin"],
      toolPolicy: {
        mode: "append_custom",
      },
      plugins: {
        botPlugin: { enabled: true, mode: "on" },
      },
    },
    userConfig: {},
  });

  assert.equal(prepared?.plugins?.botPlugin?.enabled, true);
  assert.equal(prepared?.plugins?.botPlugin?.mode, "on");
  assert.equal(prepared?.toolPolicy?.mode, "append_custom");
  assert.deepEqual(prepared?.toolPolicy?.denyToolNames, [
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
  ]);
});

test("SessionExecutionEngine bot plugin merges existing denyToolNames", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        botPlugin: { enabled: true, mode: "on" },
      },
    },
  });
  const prepared = engine.runConfigPluginPreparer.prepareBotPluginRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["botPlugin"],
      toolPolicy: {
        denyToolNames: ["request_help", "delegate_task_async"],
      },
      plugins: {
        botPlugin: { enabled: true, mode: "on" },
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

test("SessionExecutionEngine bot plugin denyToolNames comes from bot plugin options", () => {
  const engine = new SessionExecutionEngine({
    globalConfig: {
      plugins: {
        botPlugin: {
          enabled: true,
          mode: "on",
          denyToolNames: ["request_help"],
        },
      },
    },
  });
  const prepared = engine.runConfigPluginPreparer.prepareBotPluginRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["botPlugin"],
      plugins: {
        botPlugin: { enabled: true, mode: "on" },
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
    pluginName: "botPlugin",
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
