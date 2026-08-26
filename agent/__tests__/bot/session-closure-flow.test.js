/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { BotManager } from "../../src/bot/index.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";

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
    async resolveSessionScope({ userId, sessionId }) {
      return { sessionDir: path.join("/tmp/noobot-test", userId, "runtime", "session", sessionId) };
    },
    async appendExecutionLog(payload = {}) {
      appendedExecutionLogs.push(payload);
    },
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
    },
    async commitTurn(payload = {}) {
      const messageUid = `sm_${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: payload.messageId || messageUid,
        messageId: payload.messageId || messageUid,
        role: "user",
        type: "message",
        content: payload.content,
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        parentDialogProcessId: payload.parentDialogProcessId,
        turnScopeId: payload.turnScopeId,
        messageOrigin: payload.messageOrigin || "natural",
        userMetaMaterialized: payload.userMetaMaterialized === true,
        attachments: [],
      };
      persistedTurns.push(userMessage);
      return { sessionId: payload.sessionId, userMessage, attachments: [], aggregateVersion: 1 };
    },
    async bindTurnAttachments(payload = {}) {
      const index = persistedTurns.findIndex(
        (message) => message.messageUid === payload.messageUid,
      );
      const userMessage = { ...persistedTurns[index], attachments: payload.attachments };
      persistedTurns[index] = userMessage;
      return {
        session: { sessionId: payload.sessionId },
        userMessage,
        attachments: payload.attachments,
        aggregateVersion: 2,
      };
    },
    async saveCurrentTurnTasks(payload = {}) {
      savedCurrentTurnTasksPayload = payload;
    },
  };
  const sessionManager = createCanonicalMessageEventSessionManager({
    producerId: "session-closure-flow",
  });

  const engine = new SessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureSessionToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {
      async ingest({ sessionId, attachments = [] } = {}) {
        return attachments.map((attachment, index) => ({
          attachmentId: attachment.attachmentId || attachment.id || `input-${index}`,
          sessionId,
          attachmentSource: "user",
          name: attachment.name || "input",
          mimeType: attachment.mimeType || attachment.type || "application/octet-stream",
          path: attachment.path || `/tmp/noobot-test/input-${index}`,
        }));
      },
    },
    skill: {},
    configService: {
      async loadUserConfig() {
        return {
          scenarios: {
            default: "programming",
            definitions: {
              programming: {
                model: "gpt-4.1-mini",
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
    agentRunner: async ({ agentContext, currentUserMessage }) => {
      capturedAgentContext = agentContext;
      assert.equal(currentUserMessage.content, "请切换模型并输出附件");
      assert.equal(currentUserMessage.messageUid, "sm_turn-closure");
      assert.equal(
        agentContext?.bindings?.runtime?.runtimeModel,
        "",
        "场景默认模型不应写入 runtimeModel",
      );
      assert.equal(Array.isArray(agentContext?.context?.modelContext?.messageBlocks?.system), true);
      assert.equal(
        agentContext.context.modelContext.messageBlocks.system[0],
        "[PROMPT_PATCHED] 你现在处于审计模式",
        "中途 context 提示应生效",
      );
      const toolNames = (agentContext?.bindings?.tools || []).map((toolItem) =>
        String(toolItem?.name || ""),
      );
      assert.deepEqual(
        toolNames,
        ["task_summary", "user_interaction"],
        "工具链应按内置编程场景策略收敛",
      );
      return {
        output: "已切换模型并生成附件",
        assistantMessageId: "closure-assistant-message",
        traces: [{ event: "tool_chain_done" }],
        turnTasks: [{ taskId: "task-1", taskStatus: "completed" }],
        turnMessages: [
          {
            messageId: "closure-tool-call",
            role: "assistant",
            type: "tool_call",
            content: "",
            tool_calls: [
              {
                id: "call_switch_model",
                function: { name: "switch_model", arguments: '{"modelName":"gpt-4.1-mini"}' },
              },
            ],
          },
          {
            messageId: "closure-tool-result",
            role: "tool",
            type: "tool_result",
            tool_call_id: "call_switch_model",
            content: '{"ok":true,"modelAlias":"anthropic"}',
          },
          {
            messageId: "closure-assistant-message",
            role: "assistant",
            type: "message",
            content: "已切换模型并生成附件",
            modelAlias: "anthropic",
            modelName: "gpt-4.1-mini",
            attachments: [
              {
                attachmentId: "att-out-1",
                sessionId,
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
    userMessageAttachments = [],
    attachments = [],
    sessionId = "",
    parentSessionId = "",
    caller = "user",
  } = {}) => {
    capturedBuildContextInput = {
      runConfig,
      userMessageAttachments,
      attachments,
      sessionId,
      parentSessionId,
      caller,
    };
    return {
      async buildInitialContext({ dialogProcessId = "" } = {}) {
        const effectiveAttachments =
          Array.isArray(userMessageAttachments) && userMessageAttachments.length
            ? userMessageAttachments
            : attachments;
        const firstIncoming = Array.isArray(effectiveAttachments)
          ? effectiveAttachments[0] || {}
          : {};
        return createTestAgentExecutionScope(
          {
            currentTurnMessages: createCurrentTurnMessagesStore(),
            sessionManager,
            runtimeModel: String(runConfig?.runtimeModel || ""),
            userMessageAttachments: [
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
            attachments: [],
            systemRuntime: {
              dialogProcessId,
            },
          },
          {
            identity: {
              sessionId,
              parentSessionId,
              dialogProcessId,
              turnScopeId: runConfig.turnScopeId,
            },
            messageBlocks: {
              system: ["[PROMPT_PATCHED] 你现在处于审计模式"],
              history: [{ role: "user", content: "历史记录" }],
            },
            tools: [
              { name: "switch_model" },
              { name: "task_summary" },
              { name: "user_interaction" },
            ],
          },
        );
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
    turnScopeId: "turn-closure",
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
  assert.equal(capturedBuildContextInput?.runConfig?.runtimeModel, undefined);
  assert.equal(capturedBuildContextInput?.runConfig?.scenarioProfile?.model, "gpt-4.1-mini");
  assert.deepEqual(capturedBuildContextInput?.runConfig?.contextPolicy?.promptSections, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "long_memory",
    "services",
    "mcp_servers",
  ]);
  assert.equal(
    capturedBuildContextInput?.userMessageAttachments?.[0]?.name,
    "input.png",
    "入口附件应透传到 context 构建阶段",
  );

  assert.equal(persistedTurns.length >= 4, true, "至少应落盘 user + toolchain 3 条");
  const userTurn = persistedTurns.find((turn) => turn.role === "user");
  assert.ok(userTurn);
  assert.equal(userTurn.content, "请切换模型并输出附件");
  assert.equal(userTurn.attachments?.[0]?.attachmentId, "input-0");

  const finalAssistantTurn = [...persistedTurns]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.type === "message");
  assert.ok(finalAssistantTurn);
  assert.equal(finalAssistantTurn.modelAlias, "anthropic");
  assert.equal(finalAssistantTurn.modelName, "gpt-4.1-mini");
  assert.equal(finalAssistantTurn.attachments?.[0]?.attachmentId, "att-out-1");
  assert.equal(finalAssistantTurn.transferEnvelopes, undefined);

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
  assert.equal(typeof fullTurnLog?.data?.content?.length, "number");
  assert.equal(typeof fullTurnLog?.data?.content?.preview, "string");
  assert.equal(fullTurnLog?.data?.artifactRef?.source, "session.messages");
  assert.equal(upstreamEvents.length > 0, true, "应向上游持续回传事件");
  assert.deepEqual(
    upstreamEvents.find((event) => event?.event === "turn_committed")?.data?.userMessage
      ?.attachments || [],
    [],
    "turn_committed 应只回传已持久化的用户消息",
  );
  assert.equal(
    upstreamEvents.find((event) => event?.event === "turn_attachments_bound")?.data?.userMessage,
    userTurn,
    "turn_attachments_bound 应回传绑定 canonical 附件后的唯一持久化用户消息",
  );
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
    async resolveSessionScope({ userId, sessionId }) {
      return { sessionDir: path.join("/tmp/noobot-test", userId, "runtime", "session", sessionId) };
    },
    async appendExecutionLog() {},
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
    },
    async commitTurn(payload = {}) {
      const messageUid = `sm_${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: payload.messageId || messageUid,
        messageId: payload.messageId || messageUid,
        role: "user",
        type: "message",
        content: payload.content,
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        parentDialogProcessId: payload.parentDialogProcessId,
        turnScopeId: payload.turnScopeId,
        messageOrigin: payload.messageOrigin || "natural",
        userMetaMaterialized: payload.userMetaMaterialized === true,
        attachments: payload.attachments || [],
      };
      persistedTurns.push(userMessage);
      return { userMessage, attachments: userMessage.attachments, aggregateVersion: 1 };
    },
    async saveCurrentTurnTasks() {},
  };
  const sessionManager = createCanonicalMessageEventSessionManager({
    producerId: "session-closure-continue-flow",
  });

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
      assistantMessageId: "continue-assistant-message",
      traces: [],
      turnTasks: [],
      turnMessages: [
        {
          messageId: "continue-assistant-message",
          role: "assistant",
          type: "message",
          content: "continue answer",
          modelAlias: "openai",
          modelName: "gpt-4o",
        },
      ],
    }),
  });

  engine._buildContextBuilder = ({ sessionId = "", runConfig = {} } = {}) => ({
    async buildInitialContext({ dialogProcessId = "" } = {}) {
      return createTestAgentExecutionScope(
        {
          currentTurnMessages: createCurrentTurnMessagesStore(),
          sessionManager,
          runtimeModel: String(runConfig?.runtimeModel || ""),
          attachmentMetas: [],
          systemRuntime: { dialogProcessId },
        },
        {
          identity: { sessionId, dialogProcessId, turnScopeId: runConfig.turnScopeId },
          messageBlocks: { system: ["initial"], history: [] },
        },
      );
    },
    async buildContinueContext({ dialogProcessId = "" } = {}) {
      continueContextBuilt = true;
      capturedRunConfig = { ...runConfig };
      return createTestAgentExecutionScope(
        {
          currentTurnMessages: createCurrentTurnMessagesStore(),
          sessionManager,
          runtimeModel: "",
          attachmentMetas: [],
          systemRuntime: { dialogProcessId, sessionId },
        },
        {
          identity: { sessionId, dialogProcessId, turnScopeId: runConfig.turnScopeId },
          messageBlocks: {
            system: ["continue prompt"],
            history: [{ role: "user", content: "history" }],
          },
          tools: [{ name: "task_summary" }],
        },
      );
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
    turnScopeId: "turn-existing-session",
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
