/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { appendUserInterjectionMessage } from "../../src/runtime/turn/turn-context-message-appender.js";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { resolveModelHistoryMessages } from "@noobot/context-protocol/policy/window";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";

test("session execution preserves every user interjection into the next model history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-user-interjection-e2e-"));
  const sessionId = randomUUID();
  const persistedTurns = [];
  const dialogProcessId = "dialog-user-interjection-e2e";
  const turnScopeId = "turn-user-interjection-e2e";
  const interjections = [
    {
      messageUid: "user-interjection:e2e:first",
      message: "retain the first user instruction",
      interjectionSequence: 1,
    },
    {
      messageUid: "user-interjection:e2e:second",
      message: "retain the second user instruction",
      interjectionSequence: 2,
    },
  ];
  const sessionManager = createCanonicalMessageEventSessionManager({
    producerId: "user-interjection-history-e2e",
  });

  const session = {
    async upsertSessionTree() {},
    async getSessionBundle() {
      return { exists: false, session: { messages: [] } };
    },
    async createSession() {},
    async getExecutionBundle() {
      return { logs: [] };
    },
    async resolveSessionScope({ userId, sessionId: resolvedSessionId }) {
      return { sessionDir: path.join(root, userId, "runtime", "session", resolvedSessionId) };
    },
    async appendExecutionLog() {},
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
      return payload;
    },
    async appendTurns({ turns = [] } = {}) {
      persistedTurns.push(...turns);
      return turns;
    },
    async getSessionTurns() {
      return persistedTurns;
    },
    async commitTurn(payload = {}) {
      const messageUid = `user:${payload.turnScopeId}`;
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
        messageOrigin: "natural",
        summarized: false,
      };
      persistedTurns.push(userMessage);
      return { userMessage, attachments: [], aggregateVersion: 1 };
    },
    async commitTurnSummaryCheckpoint() {
      return { committed: true, markedCount: 1, checkpointRevision: 1 };
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
      async ensureUserWorkspace(userId) {
        return path.join(root, userId);
      },
      getWorkspacePath(userId) {
        return path.join(root, userId);
      },
    },
    errorLogger: { async log() {} },
    botManager: {},
    agentRunner: async ({ agentContext, currentUserMessage }) => {
      const runtime = agentContext.bindings.runtime;
      const modelContext = agentContext.context.modelContext;
      for (const interjection of interjections) {
        appendUserInterjectionMessage({
          runtime,
          loopState: { modelContext, dialogProcessId },
          interjection: {
            ...interjection,
            receivedAt: `2026-09-18T00:00:0${interjection.interjectionSequence}.000Z`,
          },
        });
      }
      await runtime.commitSummaryCheckpoint({
        summaryCompletion: {
          source: "e2e.task_summary",
          summarizedMessageIds: [currentUserMessage.messageUid],
        },
      });
      runtime.currentTurnMessages.push({
        messageUid: "assistant:e2e:final",
        messageId: "assistant:e2e:final",
        role: "assistant",
        type: "message",
        content: "completed",
        dialogProcessId,
        turnScopeId,
        summarized: false,
      });
      return {
        output: "completed",
        assistantMessageId: "assistant:e2e:final",
        traces: [],
        turnTasks: [],
        turnMessages: runtime.currentTurnMessages.toArray(),
        modelMessages: modelContext.messageBlocks.incremental,
        currentUserMessage,
      };
    },
  });

  const originalBuildContextBuilder = engine._buildContextBuilder.bind(engine);
  engine._buildContextBuilder = (options = {}) => {
    const builder = originalBuildContextBuilder(options);
    const bindSessionManager = async (build) => {
      const scope = await build();
      scope.context.modelContext = createModelContext({
        activeTurnIdentity: { dialogProcessId, turnScopeId },
        messageBlocks: scope.context.modelContext.messageBlocks,
      });
      scope.bindings.runtime.sessionManager = sessionManager;
      return scope;
    };
    return {
      ...builder,
      buildNewSessionContext: (payload) =>
        bindSessionManager(() => builder.buildNewSessionContext(payload)),
      buildExistingSessionContext: (payload) =>
        bindSessionManager(() => builder.buildExistingSessionContext(payload)),
    };
  };

  try {
    await engine.runSession({
      userId: "admin",
      sessionId,
      message: "start task",
      dialogProcessId,
      turnScopeId,
      runConfig: {
        executionId: `agent:${turnScopeId}`,
        executionKind: "agent",
        rootExecutionId: `agent:${turnScopeId}`,
      },
    });

    for (const expected of interjections) {
      const interjection = persistedTurns.find(
        (message) => message.messageUid === expected.messageUid,
      );
      assert.ok(interjection, "the interjection must be persisted by the full session pipeline");
      assert.equal(interjection.injectedMessage, true);
      assert.equal(interjection.injectedMessageType, "noobot.user_interjection");
      assert.equal(interjection.noobotInternalMessageType, "noobot.user_interjection");
      assert.equal(interjection.summarized, false);
    }

    const nextHistory = resolveModelHistoryMessages({ sourceMessages: persistedTurns });
    assert.deepEqual(
      [
        ...new Set(
          nextHistory
            .filter((message) => message.injectedMessageType === "noobot.user_interjection")
            .map((message) => message.messageUid),
        ),
      ],
      interjections.map(({ messageUid }) => messageUid),
      "the next model history must contain every user interjection",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
