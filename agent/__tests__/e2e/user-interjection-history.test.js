/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";
import { appendUserInterjectionMessage } from "../../src/runtime/turn/turn-context-message-appender.js";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { resolveModelHistoryMessages } from "@noobot/context-protocol/policy/window";
import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";
import { createAcceptedRunIdentity } from "../helpers/accepted-run-identity.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { createTestSessionRunPayload } from "../helpers/session-run-payload.js";
import { createTestAttachmentService } from "../helpers/test-runtime-context.js";
import { TEST_MODEL_GLOBAL_CONFIG } from "../helpers/test-model-config.js";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { turnRecord } from "../helpers/turn-record.js";

test("session execution preserves every user interjection into the next model history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-user-interjection-e2e-"));
  const sessionId = randomUUID();
  const persistedTurns = [];
  const dialogProcessId = "dialog-user-interjection-e2e";
  const turnScopeId = "turn-user-interjection-e2e";
  const interjections = [
    {
      messageUid: "interjection-uid-e2e:first",
      message: "retain the first user instruction",
      interjectionSequence: 1,
    },
    {
      messageUid: "interjection-uid-e2e:second",
      message: "retain the second user instruction",
      interjectionSequence: 2,
    },
  ];
  const sessionManager = createCanonicalMessageEventSessionManager({
    producerId: "user-interjection-history-e2e",
  });

  const session = {
    async getSessionBundle() {
      return {
        exists: true,
        session: {
          messages: [],
          turnLifecycle: {
            turns: { [turnScopeId]: turnRecord({ turnScopeId, dialogProcessId }) },
          },
        },
      };
    },
    async createSession() {},
    async getExecutionTurnLogs() {
      return [];
    },
    async locateSessionScope({ userId, sessionId: resolvedSessionId }) {
      return {
        sessionDir: path.join(root, userId, "runtime", "session", resolvedSessionId),
        resolvedParentSessionId: "",
        indexed: true,
        registered: true,
      };
    },
    async appendExecutionLog() {},
    async upsertTurnTiming() {},
    async saveExecutionReport() {},
    async getTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }) {
      return createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId });
    },
    async getRootSessionId({ sessionId: rootSessionId }) {
      return rootSessionId;
    },
    async getContextProjection() {
      return { scope: {}, messages: [] };
    },
    async appendTurns({ turns = [] } = {}) {
      persistedTurns.push(...turns);
      return { turns };
    },
    async getSessionTurns() {
      return persistedTurns;
    },
    async assertReusedUserTurnIdentity(payload = {}) {
      const messageUid = `user:${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: messageUid,
        userMessageId: messageUid,
        ts: "2026-09-18T00:00:00.000Z",
        role: "user",
        type: "message",
        content: "start task",
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        turnScopeId: payload.turnScopeId,
        messageOrigin: "natural",
        attachments: [],
        summarized: false,
      };
      persistedTurns.push(userMessage);
      return { userMessage };
    },
    async commitTurnSummaryCheckpoint() {
      return { committed: true, markedCount: 1, checkpointRevision: 1 };
    },
  };

  const engine = createTestSessionExecutionEngine({
    globalConfig: { ...TEST_MODEL_GLOBAL_CONFIG, workspaceRoot: root },
    session,
    memory: {
      async captureDialogToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {
      ...createTestAttachmentService(),
      async ingest() {
        throw new Error("user interjection e2e carries no raw attachments");
      },
    },
    skill: {
      async listSkills() {
        return [];
      },
    },
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
    agentRunner: async ({ agentContext, currentUserMessage }) => {
      const runtime = agentContext.bindings.runtime;
      const modelContext = createModelContext({
        activeTurnIdentity: { dialogProcessId, turnScopeId },
        messageBlocks: agentContext.context.modelContext.messageBlocks,
      });
      runtime.activeMessageContext = modelContext;
      for (const interjection of interjections) {
        appendUserInterjectionMessage({
          runtime,
          interjection: {
            ...interjection,
            receivedAt: `2026-09-18T00:00:0${interjection.interjectionSequence}.000Z`,
          },
        });
      }
      await runtime.commitSummaryCheckpoint({
        summaryCompletion: createSummaryCheckpointInstruction({
          source: "e2e.task_summary",
          summarizedMessageUids: [currentUserMessage.messageUid],
        }),
      });
      runtime.currentTurnMessages.push({
        messageUid: "assistant:e2e:final",
        modelMessageId: "assistant:e2e:final",
        role: "assistant",
        type: "message",
        content: "completed",
        dialogProcessId,
        turnScopeId,
        summarized: false,
      });
      return {
        output: "completed",
        modelMessageId: "assistant:e2e:final",
        traces: [],
        modelLoopRound: 0,
        turnMessages: runtime.currentTurnMessages.toArray(),
        modelMessages: modelContext.messageBlocks.incremental,
      };
    },
  });

  const originalBuildContextBuilder = engine._buildContextBuilder.bind(engine);
  engine._buildContextBuilder = (options = {}) => {
    const builder = originalBuildContextBuilder(options);
    const bindSessionManager = async (build) => {
      const scope = await build();
      scope.bindings.runtime.sessionManager = sessionManager;
      return scope;
    };
    return {
      ...builder,
      buildSessionContext: () => bindSessionManager(() => builder.buildSessionContext()),
    };
  };

  try {
    await engine.runSession(
      createTestSessionRunPayload({
        abortSignal: new AbortController().signal,
        userId: "admin",
        sessionId,
        message: "start task",
        dialogProcessId,
        turnScopeId,
        turnAcceptance: createTurnAcceptanceReceipt({
          ...createTestSessionRequiredFields(),
          commandId: turnScopeId,
          sessionId,
          turnScopeId,
          dialogProcessId,
          messageUid: `user:${turnScopeId}`,
          aggregateVersion: 1,
        }),
        runConfig: {
          ...createAcceptedRunIdentity(turnScopeId, { commandId: turnScopeId }),
          executionKind: "agent",
        },
      }),
    );

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

    const nextHistory = resolveModelHistoryMessages({
      sourceMessages: persistedTurns.map(projectSessionRecordToContextMessage),
    });
    assert.deepEqual(
      [
        ...new Set(
          nextHistory
            .filter(
              (message) =>
                message.additional_kwargs.injectedMessageType === "noobot.user_interjection",
            )
            .map((message) => message.additional_kwargs.messageUid),
        ),
      ],
      interjections.map(({ messageUid }) => messageUid),
      "the next model history must contain every user interjection",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
