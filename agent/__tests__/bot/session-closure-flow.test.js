/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import test from "node:test";
import { projectAgentContextIdentity } from "../../src/context/agent-context-envelope-input.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createAcceptedRunIdentity } from "../helpers/accepted-run-identity.js";
import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";
import { BotManager } from "../../src/bot/index.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { createTestSessionRunPayload } from "../helpers/session-run-payload.js";

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-closure-flow-"));
test.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

test("service -> bot -> agent -> toolchain -> return -> persist: should form full closed loop", async () => {
  const acceptedTurn = {
    sessionId: randomUUID(),
    turnScopeId: "turn-closure",
    dialogProcessId: "dp-closure",
    parentDialogProcessId: "",
    content: "请切换模型并输出附件",
  };
  const persistedTurns = [];
  const appendedExecutionLogs = [];
  const upstreamEvents = [];
  let savedCurrentTurnTasksPayload = null;
  let capturedBuildContextInput = null;
  let capturedAgentContext = null;

  const session = {
    async getSessionBundle() {
      return { exists: false, session: { messages: [] } };
    },
    async createSession() {},
    async getExecutionTurnLogs() {
      return [...appendedExecutionLogs];
    },
    async locateSessionScope({ userId, sessionId }) {
      return {
        sessionDir: path.join(workspaceRoot, userId, "runtime", "session", sessionId),
        resolvedParentSessionId: "",
        indexed: true,
        registered: true,
      };
    },
    async saveExecutionReport() {},
    async appendExecutionLog(payload = {}) {
      appendedExecutionLogs.push(payload);
    },
    async appendTurns(payload = {}) {
      persistedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
    },
    async upsertTurnTiming() {},
    async getTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }) {
      return createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId });
    },
    async getSessionTurns() {
      return persistedTurns;
    },
    async assertReusedUserTurnIdentity(payload = {}) {
      const messageUid = `sm_${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: messageUid,
        userMessageId: messageUid,
        role: "user",
        type: "message",
        content: acceptedTurn.content,
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        parentDialogProcessId: acceptedTurn.parentDialogProcessId,
        turnScopeId: payload.turnScopeId,
        messageOrigin: "natural",
        attachments: [],
      };
      persistedTurns.push(userMessage);
      return {
        ...createTestSessionRequiredFields(),
        sessionId: payload.sessionId,
        userMessage,
        attachments: [],
        aggregateVersion: 1,
      };
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

  const engine = createTestSessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureDialogToShortMemory() {},
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
          path: attachment.path || path.join(workspaceRoot, `input-${index}`),
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
        return workspaceRoot;
      },
      getWorkspacePath() {
        return workspaceRoot;
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
        modelMessageId: "closure-assistant-message",
        traces: [{ event: "tool_chain_done" }],
        turnTasks: [{ taskId: "task-1", taskStatus: "completed" }],
        turnMessages: [
          {
            messageUid: "sm_closure-tool-call",
            modelMessageId: "closure-tool-call",
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
            messageUid: "sm_closure-tool-result",

            role: "tool",
            type: "tool_result",
            tool_call_id: "call_switch_model",
            content: '{"ok":true,"modelAlias":"anthropic"}',
          },
          {
            messageUid: "sm_closure-assistant-message",
            modelMessageId: "closure-assistant-message",
            role: "assistant",
            type: "message",
            content: "已切换模型并生成附件",
            modelAlias: "anthropic",
            modelName: "gpt-4.1-mini",
            attachments: [
              {
                attachmentId: "att-out-1",
                sessionId,
                attachmentSource: ATTACHMENT_SOURCE.MODEL,
                name: "result.png",
                mimeType: "image/png",
                size: 2048,
                path: path.join(workspaceRoot, "result.png"),
                relativePath: "result.png",
                generatedByModel: true,
              },
            ],
          },
        ],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  engine._buildContextBuilder = ({ runtimeIdentity, runConfig, userMessageAttachments }) => {
    const { sessionId } = runtimeIdentity;
    capturedBuildContextInput = { runConfig, userMessageAttachments };
    return {
      attachmentService: engine.attach,
      async buildNewSessionContext() {
        const [firstIncoming] = userMessageAttachments;
        return createTestAgentExecutionScope(
          createTestRuntimeContext({
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
                path: path.join(workspaceRoot, "input.png"),
                relativePath: "input.png",
              },
            ],
            identity: runtimeIdentity,
          }),
          {
            identity: projectAgentContextIdentity(
              { ...runtimeIdentity, rootSessionId: acceptedTurn.sessionId },
              runConfig,
            ),
            messageBlocks: {
              system: ["[PROMPT_PATCHED] 你现在处于审计模式"],
              history: [
                writeContextMessageMetadata(
                  { role: "user", content: "历史记录" },
                  { messageUid: createMessageUid() },
                ),
              ],
              incremental: [],
            },
            tools: [
              { name: "switch_model" },
              { name: "task_summary" },
              { name: "user_interaction" },
            ],
          },
        );
      },
      async buildExistingSessionContext() {
        return this.buildNewSessionContext();
      },
    };
  };

  const bot = Object.create(BotManager.prototype);
  bot.sessionRunner = engine;

  const { sessionId } = acceptedTurn;
  const result = await bot.runSession(
    createTestSessionRunPayload({
      dialogProcessId: acceptedTurn.dialogProcessId,
      runConfig: createAcceptedRunIdentity(acceptedTurn.turnScopeId, {
        commandId: acceptedTurn.turnScopeId,
      }),
      turnAcceptance: createTurnAcceptanceReceipt({
        ...createTestSessionRequiredFields(),
        commandId: acceptedTurn.turnScopeId,
        sessionId,
        turnScopeId: acceptedTurn.turnScopeId,
        dialogProcessId: acceptedTurn.dialogProcessId,
        messageUid: `sm_${acceptedTurn.turnScopeId}`,
        aggregateVersion: 1,
      }),
      userId: "u1",
      sessionId,
      persistenceScope: null,
      message: "请切换模型并输出附件",
      turnScopeId: acceptedTurn.turnScopeId,
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
      caller: SESSION_CALLER.USER,
      parentSessionId: "",
    }),
  );

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
  assert.equal("executionLogs" in result, false);
  assert.equal("executionSummary" in result, false);
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
  const acceptedTurn = {
    sessionId: randomUUID(),
    turnScopeId: "turn-existing-session",
    dialogProcessId: "dp-existing-session",
    parentDialogProcessId: "dp-parent-1",
    content: "continue run",
  };
  const parentRootSessionId = randomUUID();
  const persistedTurns = [];
  const persistedBatches = [];
  const upstreamEvents = [];
  let continueContextBuilt = false;
  let capturedRunConfig = null;

  const session = {
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
    async getExecutionTurnLogs() {
      return [];
    },
    async locateSessionScope({ userId, sessionId }) {
      return {
        sessionDir: path.join(workspaceRoot, userId, "runtime", "session", sessionId),
        resolvedParentSessionId: parentRootSessionId,
        indexed: true,
        registered: true,
      };
    },
    async saveExecutionReport() {},
    async appendExecutionLog() {},
    async appendTurns(payload = {}) {
      persistedBatches.push(payload);
      persistedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
    },
    async upsertTurnTiming() {},
    async getTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }) {
      return createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId });
    },
    async getSessionTurns() {
      return persistedTurns;
    },
    async assertReusedUserTurnIdentity(payload = {}) {
      const messageUid = `sm_${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: messageUid,
        userMessageId: messageUid,
        role: "user",
        type: "message",
        content: acceptedTurn.content,
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        parentDialogProcessId: acceptedTurn.parentDialogProcessId,
        turnScopeId: payload.turnScopeId,
        messageOrigin: "natural",
        attachments: [],
      };
      persistedTurns.push(userMessage);
      return { userMessage, attachments: userMessage.attachments, aggregateVersion: 1 };
    },
    async saveCurrentTurnTasks() {},
  };
  const sessionManager = createCanonicalMessageEventSessionManager({
    producerId: "session-closure-continue-flow",
  });

  const engine = createTestSessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureDialogToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {
      async ingest() {
        throw new Error("continue closed-loop carries no raw attachments");
      },
    },
    skill: {},
    configService: {
      async loadUserConfig() {
        return {};
      },
    },
    workspaceService: {
      async ensureUserWorkspace() {
        return workspaceRoot;
      },
      getWorkspacePath() {
        return workspaceRoot;
      },
    },
    errorLogger: {
      async log() {},
    },
    botManager: {},
    agentRunner: async () => ({
      output: "continue answer",
      modelMessageId: "continue-assistant-message",
      traces: [],
      turnTasks: [],
      turnMessages: [
        {
          messageUid: "sm_continue-assistant-message",
          modelMessageId: "continue-assistant-message",
          role: "assistant",
          type: "message",
          content: "continue answer",
          modelAlias: "openai",
          modelName: "gpt-4o",
        },
      ],
      modelLoopRound: 0,
      modelMessages: [],
    }),
  });

  engine._buildContextBuilder = ({ runtimeIdentity, runConfig }) => ({
    attachmentService: engine.attach,
    async buildNewSessionContext() {
      return createTestAgentExecutionScope(
        createTestRuntimeContext({
          sessionManager,
          runtimeModel: String(runConfig?.runtimeModel || ""),
          identity: runtimeIdentity,
        }),
        {
          identity: projectAgentContextIdentity(
            { ...runtimeIdentity, rootSessionId: parentRootSessionId },
            runConfig,
          ),
          messageBlocks: { system: ["initial"], history: [], incremental: [] },
        },
      );
    },
    async buildExistingSessionContext() {
      continueContextBuilt = true;
      capturedRunConfig = { ...runConfig };
      return createTestAgentExecutionScope(
        createTestRuntimeContext({
          sessionManager,
          identity: runtimeIdentity,
        }),
        {
          identity: projectAgentContextIdentity(
            { ...runtimeIdentity, rootSessionId: parentRootSessionId },
            runConfig,
          ),
          messageBlocks: {
            system: ["continue prompt"],
            history: [
              writeContextMessageMetadata(
                { role: "user", content: "history" },
                { messageUid: createMessageUid() },
              ),
            ],
            incremental: [],
          },
          tools: [{ name: "task_summary" }],
        },
      );
    },
  });

  const bot = Object.create(BotManager.prototype);
  bot.sessionRunner = engine;

  const { sessionId } = acceptedTurn;
  const result = await bot.runSession(
    createTestSessionRunPayload({
      dialogProcessId: acceptedTurn.dialogProcessId,
      runConfig: createAcceptedRunIdentity(acceptedTurn.turnScopeId, {
        commandId: acceptedTurn.turnScopeId,
      }),
      turnAcceptance: createTurnAcceptanceReceipt({
        ...createTestSessionRequiredFields(),
        commandId: acceptedTurn.turnScopeId,
        sessionId,
        turnScopeId: acceptedTurn.turnScopeId,
        dialogProcessId: acceptedTurn.dialogProcessId,
        messageUid: `sm_${acceptedTurn.turnScopeId}`,
        aggregateVersion: 1,
      }),
      userId: "u1",
      sessionId,
      parentSessionId: parentRootSessionId,
      persistenceScope: null,
      caller: SESSION_CALLER.BOT,
      parentDialogProcessId: acceptedTurn.parentDialogProcessId,
      message: acceptedTurn.content,
      turnScopeId: acceptedTurn.turnScopeId,
      attachments: [],
      eventListener: {
        onEvent(evt = {}) {
          upstreamEvents.push(evt);
        },
      },
    }),
  );

  assert.equal(continueContextBuilt, true, "continue 模式应走 buildExistingSessionContext");
  assert.equal(
    capturedRunConfig?.runtimeModel,
    "anthropic",
    "未显式传 runConfig.runtimeModel 时应回退到 session.modelAlias",
  );
  const userTurn = persistedTurns.find((turn) => turn.role === "user");
  const assistantTurn = persistedTurns.find((turn) => turn.role === "assistant");
  assert.ok(userTurn);
  assert.ok(assistantTurn);
  assert.ok(persistedBatches.length > 0);

  for (const batch of persistedBatches) {
    assert.equal(Object.hasOwn(batch, "parentSessionId"), false);
    for (const turn of batch.turns) assert.equal(Object.hasOwn(turn, "parentSessionId"), false);
  }
  assert.equal(result.parentSessionId, parentRootSessionId);
  assert.equal(result.parentDialogProcessId, "dp-parent-1");
  assert.equal(result.answer, "continue answer");
  assert.equal(upstreamEvents.length > 0, true);
});
