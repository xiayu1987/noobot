import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";
import { BotManager } from "../../../src/system-core/bot-manage/index.js";

test("service -> bot -> agent -> toolchain -> return -> persist: should form full closed loop", async () => {
  const persistedTurns = [];
  const appendedExecutionLogs = [];
  const upstreamEvents = [];
  let savedCurrentTurnTasksPayload = null;
  let capturedBuildContextInput = null;
  let capturedAgentContext = null;

  const session = {
    async upsertSessionTree() {},
    async getSessionBundle() {
      return { exists: false, session: { messages: [] } };
    },
    async createSession() {},
    async getExecutionBundle() {
      return { logs: [...appendedExecutionLogs] };
    },
    async appendExecutionLog(payload = {}) {
      appendedExecutionLogs.push(payload);
    },
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
    },
    async saveCurrentTurnTasks(payload = {}) {
      savedCurrentTurnTasksPayload = payload;
    },
  };

  const engine = new SessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureSessionToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {},
    skill: {},
    configService: {
      async loadUserConfig() {
        return {
          scenarios: {
            default: "programming",
            definitions: {
              programming: {
                model: "gpt-4.1-mini",
                // 内置编程情景只允许覆盖 model；其它字段即使配置也会被忽略。
                tools: ["switch_model", "task_summary"],
                context: ["base_prompt", "attachments"],
              },
            },
          },
        };
      },
    },
    workspaceService: {
      async ensureUserWorkspace() {
        return "/tmp/noobot-test";
      },
    },
    errorLogger: {
      async log() {},
    },
    botManager: {},
    agentRunner: async ({ agentContext, userMessage }) => {
      capturedAgentContext = agentContext;
      assert.equal(userMessage, "请切换模型并输出附件");
      assert.equal(
        agentContext?.execution?.controllers?.runtime?.runtimeModel,
        "gpt-4.1-mini",
        "场景应把 runtimeModel 切到目标模型",
      );
      assert.equal(
        Array.isArray(agentContext?.payload?.messages?.system),
        true,
      );
      assert.equal(
        agentContext.payload.messages.system[0],
        "[PROMPT_PATCHED] 你现在处于审计模式",
        "中途 context 提示应生效",
      );
      const toolNames = (agentContext?.payload?.tools?.registry || []).map(
        (toolItem) => String(toolItem?.name || ""),
      );
      assert.deepEqual(
        toolNames,
        ["task_summary"],
        "工具链应按内置编程场景策略收敛",
      );
      return {
        output: "已切换模型并生成附件",
        traces: [{ event: "tool_chain_done" }],
        turnTasks: [{ taskId: "task-1", taskStatus: "completed" }],
        turnMessages: [
          {
            role: "assistant",
            type: "tool_call",
            content: "",
            tool_calls: [
              {
                id: "call_switch_model",
                function: { name: "switch_model", arguments: "{\"modelName\":\"gpt-4.1-mini\"}" },
              },
            ],
          },
          {
            role: "tool",
            type: "tool_result",
            tool_call_id: "call_switch_model",
            content: "{\"ok\":true,\"modelAlias\":\"anthropic\"}",
          },
          {
            role: "assistant",
            type: "message",
            content: "已切换模型并生成附件",
            modelAlias: "anthropic",
            modelName: "gpt-4.1-mini",
            attachmentMetas: [
              {
                attachmentId: "att-out-1",
                sessionId: "",
                attachmentSource: "model_generated",
                name: "result.png",
                mimeType: "image/png",
                size: 2048,
                path: "/tmp/noobot-test/result.png",
                relativePath: "result.png",
                generatedByModel: true,
              },
            ],
          },
        ],
      };
    },
  });

  engine._buildContextBuilder = ({
    runConfig = {},
    attachmentMetas = [],
    sessionId = "",
    parentSessionId = "",
    caller = "user",
  } = {}) => {
    capturedBuildContextInput = {
      runConfig,
      attachmentMetas,
      sessionId,
      parentSessionId,
      caller,
    };
    return {
      async buildInitialContext({ dialogProcessId = "" } = {}) {
        const firstIncoming = Array.isArray(attachmentMetas) ? attachmentMetas[0] || {} : {};
        return {
          execution: {
            controllers: {
              runtime: {
                runtimeModel: String(runConfig?.runtimeModel || ""),
                attachmentMetas: [
                  {
                    attachmentId: "att-in-1",
                    sessionId,
                    attachmentSource: "user",
                    name: String(firstIncoming?.name || "input.png"),
                    mimeType: String(firstIncoming?.mimeType || "image/png"),
                    size: Number(firstIncoming?.size || 0),
                    path: "/tmp/noobot-test/input.png",
                    relativePath: "input.png",
                  },
                ],
                systemRuntime: {
                  dialogProcessId,
                },
              },
            },
          },
          payload: {
            messages: {
              system: ["[PROMPT_PATCHED] 你现在处于审计模式"],
              history: [{ role: "user", content: "历史记录" }],
            },
            tools: {
              registry: [
                { name: "switch_model" },
                { name: "task_summary" },
                { name: "user_interaction" },
              ],
            },
          },
        };
      },
      async buildContinueContext({ dialogProcessId = "" } = {}) {
        return this.buildInitialContext({ dialogProcessId });
      },
    };
  };

  const bot = Object.create(BotManager.prototype);
  bot.sessionRunner = engine;

  const sessionId = randomUUID();
  const result = await bot.runSession({
    userId: "u1",
    sessionId,
    message: "请切换模型并输出附件",
    attachments: [
      {
        name: "input.png",
        mimeType: "image/png",
        size: 1024,
      },
    ],
    eventListener: {
      onEvent(evt = {}) {
        upstreamEvents.push(evt);
      },
    },
    caller: "user",
    parentSessionId: "",
  });

  assert.equal(capturedBuildContextInput?.runConfig?.scenario, "programming");
  assert.equal(capturedBuildContextInput?.runConfig?.runtimeModel, "gpt-4.1-mini");
  assert.deepEqual(
    capturedBuildContextInput?.runConfig?.contextPolicy?.includeContextKeys,
    ["scenario", "system_runtime", "base_prompt", "services", "mcp_servers"],
  );
  assert.equal(
    capturedBuildContextInput?.attachmentMetas?.[0]?.name,
    "input.png",
    "入口附件应透传到 context 构建阶段",
  );

  assert.equal(persistedTurns.length >= 4, true, "至少应落盘 user + toolchain 3 条");
  const userTurn = persistedTurns.find((turn) => turn.role === "user");
  assert.ok(userTurn);
  assert.equal(userTurn.content, "请切换模型并输出附件");
  assert.equal(userTurn.attachmentMetas?.[0]?.attachmentId, "att-in-1");

  const finalAssistantTurn = [...persistedTurns]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.type === "message");
  assert.ok(finalAssistantTurn);
  assert.equal(finalAssistantTurn.modelAlias, "anthropic");
  assert.equal(finalAssistantTurn.modelName, "gpt-4.1-mini");
  assert.equal(finalAssistantTurn.attachmentMetas?.[0]?.attachmentId, "att-out-1");

  assert.equal(savedCurrentTurnTasksPayload?.currentTurnTasks?.length, 1);
  assert.equal(result.answer, "已切换模型并生成附件");
  assert.equal(Array.isArray(result.messages), true);
  assert.equal(result.messages.length, 3);
  assert.equal(Array.isArray(result.executionLogs), true);
  assert.equal(result.executionLogs.length > 0, true, "应返回执行日志闭环");
  const fullTurnLog = appendedExecutionLogs.find(
    (logItem) => String(logItem?.event || "") === "session_turn_full",
  );
  assert.ok(fullTurnLog, "完整 turn 记录应写入 execution 日志");
  assert.equal(typeof fullTurnLog?.data?.role, "string");
  assert.equal("content" in (fullTurnLog?.data || {}), true);
  assert.equal(upstreamEvents.length > 0, true, "应向上游持续回传事件");
  assert.ok(capturedAgentContext, "agent 应收到构建后的完整上下文");
});

test("continue mode closed-loop: should build continue context and persist parent session linkage", async () => {
  const persistedTurns = [];
  const upstreamEvents = [];
  let continueContextBuilt = false;
  let capturedRunConfig = null;

  const session = {
    async upsertSessionTree() {},
    async getSessionBundle() {
      return {
        exists: true,
        session: {
          modelAlias: "anthropic",
          messages: [{ role: "user", content: "history" }],
        },
      };
    },
    async createSession() {},
    async getExecutionBundle() {
      return { logs: [] };
    },
    async appendExecutionLog() {},
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
    },
    async saveCurrentTurnTasks() {},
  };

  const engine = new SessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureSessionToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {},
    skill: {},
    configService: {
      async loadUserConfig() {
        return {};
      },
    },
    workspaceService: {
      async ensureUserWorkspace() {
        return "/tmp/noobot-test";
      },
    },
    errorLogger: {
      async log() {},
    },
    botManager: {},
    agentRunner: async () => ({
      output: "continue answer",
      traces: [],
      turnTasks: [],
      turnMessages: [
        {
          role: "assistant",
          type: "message",
          content: "continue answer",
          modelAlias: "openai",
          modelName: "gpt-4o",
        },
      ],
    }),
  });

  engine._buildContextBuilder = ({
    sessionId = "",
    runConfig = {},
  } = {}) => ({
    async buildInitialContext({ dialogProcessId = "" } = {}) {
      return {
        execution: {
          controllers: {
            runtime: {
              runtimeModel: String(runConfig?.runtimeModel || ""),
              attachmentMetas: [],
              systemRuntime: { dialogProcessId },
            },
          },
        },
        payload: { messages: { system: ["initial"], history: [] }, tools: { registry: [] } },
      };
    },
    async buildContinueContext({ dialogProcessId = "" } = {}) {
      continueContextBuilt = true;
      capturedRunConfig = { ...runConfig };
      return {
        execution: {
          controllers: {
            runtime: {
              runtimeModel: "",
              attachmentMetas: [],
              systemRuntime: { dialogProcessId, sessionId },
            },
          },
        },
        payload: {
          messages: {
            system: ["continue prompt"],
            history: [{ role: "user", content: "history" }],
          },
          tools: { registry: [{ name: "task_summary" }] },
        },
      };
    },
  });

  const bot = Object.create(BotManager.prototype);
  bot.sessionRunner = engine;

  const sessionId = randomUUID();
  const parentSessionId = randomUUID();
  const result = await bot.runSession({
    userId: "u1",
    sessionId,
    parentSessionId,
    caller: "bot",
    parentDialogProcessId: "dp-parent-1",
    message: "continue run",
    attachments: [],
    eventListener: {
      onEvent(evt = {}) {
        upstreamEvents.push(evt);
      },
    },
  });

  assert.equal(continueContextBuilt, true, "continue 模式应走 buildContinueContext");
  assert.equal(
    capturedRunConfig?.runtimeModel,
    "anthropic",
    "未显式传 runConfig.runtimeModel 时应回退到 session.modelAlias",
  );
  const userTurn = persistedTurns.find((turn) => turn.role === "user");
  const assistantTurn = persistedTurns.find((turn) => turn.role === "assistant");
  assert.ok(userTurn);
  assert.ok(assistantTurn);
  assert.equal(userTurn.parentSessionId, parentSessionId);
  assert.equal(assistantTurn.parentSessionId, parentSessionId);
  assert.equal(result.parentSessionId, parentSessionId);
  assert.equal(result.parentDialogProcessId, "dp-parent-1");
  assert.equal(result.answer, "continue answer");
  assert.equal(upstreamEvents.length > 0, true);
});
