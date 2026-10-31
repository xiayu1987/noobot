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

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import {
  prepareStoppedSnapshotResumeTurnExecution,
  prepareTurnInput,
} from "../../src/bot/session/turn-execution-preparer.js";
import { saveStoppedModelMessageSnapshot } from "../../src/runtime/resume/model-message-snapshot-store.js";
import { initializeSessionTree, persistSession } from "../helpers/runtime-events-env.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import {
  createTestRuntimeContext,
  createTestAttachmentService,
} from "../helpers/test-runtime-context.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { readContextMessageValue } from "@noobot/context-protocol/message/codec";

test("prepareStoppedSnapshotResumeTurnExecution requires explicit stopped snapshot identity", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const contextBuilder = {
    async buildAgentContext() {
      throw new Error("snapshot identity validation should run before context build");
    },
  };

  await assert.rejects(
    () =>
      prepareStoppedSnapshotResumeTurnExecution(engine, {
        payload: {
          contextBuilder,
          runtimeIdentity: {
            userId: "u1",
            sessionId: "s1",
            parentSessionId: "",
            dialogProcessId: "dialog-current",
            turnScopeId: "turn-current",
            caller: SESSION_CALLER.USER,
          },
          runConfig: {
            resumeFromStoppedSnapshot: true,
            resumeTurnScopeId: "turn-stopped",
          },
        },
      }),
    /stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId/,
  );
});

test("stopped snapshot resume degrades to a normal turn when the optional snapshot is missing", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-missing-stopped-snapshot-"),
  );
  await initializeSessionTree(workspaceRoot, "u1");
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = { workspaceRoot };
  const calls = [];
  engine.agentRuntimeFacade = {
    async prepareTurnExecution(input) {
      calls.push(input);
      return { degraded: true };
    },
  };
  const contextBuilder = { buildAgentContext() {} };

  try {
    const result = await prepareStoppedSnapshotResumeTurnExecution(engine, {
      payload: {
        contextBuilder,
        runtimeIdentity: {
          userId: "u1",
          sessionId: "workflow-session",
          parentSessionId: "",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
          caller: SESSION_CALLER.USER,
        },
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeDialogProcessId: "dialog-stopped",
          resumeTurnScopeId: "turn-stopped",
        },
      },
    });

    assert.deepEqual(result, { degraded: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].buildContextPayload.contextBuilder, contextBuilder);
    assert.equal(calls[0].buildContextPayload.runConfig.resumeFromStoppedSnapshot, false);
    assert.equal(calls[0].buildContextPayload.runConfig.resumeSnapshotUnavailable, true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("stopped snapshot resume preserves history and incremental block boundaries", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = {};
  const captured = [];
  const contextBuilder = {
    async buildAgentContext(system, history, options) {
      captured.push({ system, history, options });
      return createTestAgentExecutionScope(createTestRuntimeContext());
    },
  };
  const history = [{ type: "human", content: "history", dialogProcessId: "old" }];
  const incremental = [{ type: "human", content: "injected", injectedMessage: true }];
  await contextBuilder.buildAgentContext([], history, { incrementalMessages: incremental });

  assert.deepEqual(captured[0].history, history);
  assert.deepEqual(captured[0].options.incrementalMessages, incremental);
});

test("stopped snapshot resume restores system as the same task-state fact", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-resume-system-boundary-"));
  await initializeSessionTree(workspaceRoot, "u1");
  await persistSession(workspaceRoot, "u1", {
    sessionId: "s1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const stoppedIdentity = {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "dialog-stopped",
    turnScopeId: "turn-stopped",
  };
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity: stoppedIdentity,
    messageBlocks: {
      system: [{ type: "system", content: "snapshot task-state system" }],
      history: [
        {
          type: "human",
          content: "history",
          additional_kwargs: {
            dialogProcessId: "dialog-history",
            turnScopeId: "turn-history",
          },
        },
      ],
      incremental: [
        {
          type: "human",
          content: "incremental",
          additional_kwargs: {
            messageUid: "source-user",
            messageOrigin: "natural",
            dialogProcessId: "dialog-stopped",
            turnScopeId: "turn-stopped",
          },
        },
      ],
    },
  });

  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = { workspaceRoot };
  const sourceCalls = [];
  engine.session = {
    async getSessionContextSource(input) {
      sourceCalls.push(input);
      return {
        messages: [
          {
            role: "user",
            messageUid: "source-user",
            content: "incremental",
            messageOrigin: "natural",
            attachments: [
              {
                attachmentId: "attachment-source",
                sessionId: "s1",
                attachmentSource: "user",
                name: "source.docx",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              },
            ],
          },
        ],
      };
    },
  };
  const captured = [];
  const contextBuilder = {
    attachmentService: createTestAttachmentService({
      async ingest() {
        throw new Error("fixture has no raw attachments");
      },
    }),
    async buildExistingSessionContext() {
      throw new Error("stopped resume must not rebuild Context from Session history");
    },
    async buildAgentContext(system, history, options) {
      captured.push({ system, history, options });
      return createTestAgentExecutionScope(createTestRuntimeContext());
    },
  };

  try {
    await prepareStoppedSnapshotResumeTurnExecution(engine, {
      payload: {
        contextBuilder,
        runtimeIdentity: {
          userId: "u1",
          sessionId: "s1",
          parentSessionId: "",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
          caller: SESSION_CALLER.USER,
        },
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeDialogProcessId: stoppedIdentity.dialogProcessId,
          resumeTurnScopeId: stoppedIdentity.turnScopeId,
        },
        persistenceScope: null,
      },
    });

    assert.deepEqual(
      captured[0].system.map((message) => message.content),
      ["snapshot task-state system"],
    );
    assert.deepEqual(
      captured[0].history.map((message) => message.content),
      ["history"],
    );
    assert.deepEqual(
      captured[0].options.incrementalMessages.map((message) => message.content),
      ["incremental"],
    );
    assert.deepEqual(sourceCalls, [{ userId: "u1", sessionId: "s1", persistenceScope: null }]);
    assert.deepEqual(Object.keys(captured[0].options).sort(), [
      "attachments",
      "incrementalMessages",
      "userMetaBackwrites",
    ]);
    const [restoredHistory] = captured[0].history;
    const [restoredIncremental] = captured[0].options.incrementalMessages;
    assert.equal(readContextMessageValue(restoredHistory, "dialogProcessId"), "dialog-history");
    assert.equal(readContextMessageValue(restoredHistory, "turnScopeId"), "turn-history");
    assert.equal(readContextMessageValue(restoredIncremental, "dialogProcessId"), "dialog-stopped");
    assert.equal(readContextMessageValue(restoredIncremental, "turnScopeId"), "turn-stopped");
    assert.deepEqual(readContextMessageValue(restoredIncremental, "attachments"), [
      {
        attachmentId: "attachment-source",
        sessionId: "s1",
        attachmentSource: "user",
        name: "source.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("prepareTurnInput ingests raw attachments once and keeps canonical ones as-is", async () => {
  const ingestCalls = [];
  const attachmentService = createTestAttachmentService({
    async ingest(payload) {
      ingestCalls.push(payload);
      return [
        {
          attachmentId: "att-1",
          sessionId: payload.sessionId,
          attachmentSource: "user",
          name: "resume.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path: "/workspace/resume.docx",
        },
      ];
    },
  });

  const { userMessageAttachments: attachments } = await prepareTurnInput({
    attachmentService,
    buildContextPayload: {
      runtimeIdentity: {
        userId: "u1",
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: "dialog-test",
        turnScopeId: "turn-test",
        caller: SESSION_CALLER.USER,
      },
      userMessageAttachments: [{ name: "resume.docx", type: "application/octet-stream" }],
    },
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].sessionId, "s1");
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].attachmentId, "att-1");

  const { userMessageAttachments: again } = await prepareTurnInput({
    attachmentService,
    buildContextPayload: {
      runtimeIdentity: {
        userId: "u1",
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: "dialog-test",
        turnScopeId: "turn-test",
        caller: SESSION_CALLER.USER,
      },
      userMessageAttachments: attachments,
    },
  });
  assert.equal(ingestCalls.length, 1, "canonical attachments must not be re-ingested");
  assert.equal(again[0].attachmentId, "att-1");
});

test("stopped snapshot resume restores turn progress onto the live system runtime", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-resume-turn-progress-"));
  await initializeSessionTree(workspaceRoot, "u1");
  await persistSession(workspaceRoot, "u1", {
    sessionId: "s1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const stoppedIdentity = {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "dialog-stopped",
    turnScopeId: "turn-stopped",
  };
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity: stoppedIdentity,
    messageBlocks: { system: [], history: [], incremental: [] },
    turnProgress: {
      phaseSummaryLoopCount: 7,
      taskCheckLoopCount: 3,
      helpPromptLoopCount: 1,
      toolConsecutiveFailureCount: 2,
      needsPhaseSummary: true,
      phaseSummaryByCharsPrompted: true,
    },
  });

  const systemRuntime = { modelLoopRound: 4 };
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = { workspaceRoot };
  engine.session = {
    async getSessionContextSource() {
      return { messages: [] };
    },
  };
  const contextBuilder = {
    attachmentService: createTestAttachmentService({
      async ingest() {
        throw new Error("fixture has no raw attachments");
      },
    }),
    async buildAgentContext() {
      return createTestAgentExecutionScope(createTestRuntimeContext({ systemRuntime }));
    },
  };

  try {
    await prepareStoppedSnapshotResumeTurnExecution(engine, {
      payload: {
        contextBuilder,
        runtimeIdentity: {
          userId: "u1",
          sessionId: "s1",
          parentSessionId: "",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
          caller: SESSION_CALLER.USER,
        },
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeDialogProcessId: stoppedIdentity.dialogProcessId,
          resumeTurnScopeId: stoppedIdentity.turnScopeId,
        },
        persistenceScope: null,
      },
    });

    assert.equal(systemRuntime.phaseSummaryLoopCount, 7);
    assert.equal(systemRuntime.taskCheckLoopCount, 3);
    assert.equal(systemRuntime.helpPromptLoopCount, 1);
    assert.equal(systemRuntime.toolConsecutiveFailureCount, 2);
    assert.equal(systemRuntime.needsPhaseSummary, true);
    assert.equal(systemRuntime.phaseSummaryByCharsPrompted, true);
    assert.equal(systemRuntime.modelLoopRound, 4);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
