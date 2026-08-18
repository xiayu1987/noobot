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
import { saveStoppedModelMessageSnapshot } from "../../src/runtime/resume/model-message-snapshot-store.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("_prepareStoppedSnapshotResumeTurnExecution requires explicit stopped snapshot identity", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const contextBuilder = {
    async buildAgentContext() {
      throw new Error("snapshot identity validation should run before context build");
    },
  };

  await assert.rejects(
    () =>
      engine._prepareStoppedSnapshotResumeTurnExecution({
        payload: {
          userId: "u1",
          sessionId: "s1",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
          runConfig: {
            resumeFromStoppedSnapshot: true,
            resumeTurnScopeId: "turn-stopped",
            turnScopeId: "turn-current",
          },
        },
        contextBuilder,
      }),
    /stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId/,
  );
});

test("stopped snapshot resume degrades to a normal turn when the optional snapshot is missing", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-missing-stopped-snapshot-"),
  );
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
    const result = await engine._prepareStoppedSnapshotResumeTurnExecution({
      payload: {
        userId: "u1",
        sessionId: "workflow-session",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeDialogProcessId: "dialog-stopped",
          resumeTurnScopeId: "turn-stopped",
        },
      },
      contextBuilder,
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
  engine.agentRuntimeFacade = {
    buildRunTurnContext(context) {
      return context;
    },
  };
  const captured = [];
  const contextBuilder = {
    async buildAgentContext(system, history, options) {
      captured.push({ system, history, options });
      return createTestAgentExecutionScope({});
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
          dialogProcessId: "dialog-history",
          turnScopeId: "turn-history",
        },
      ],
      incremental: [
        {
          type: "human",
          content: "incremental",
          dialogProcessId: "dialog-stopped",
          turnScopeId: "turn-stopped",
        },
      ],
    },
  });

  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = { workspaceRoot };
  engine.agentRuntimeFacade = {
    buildRunTurnContext(context) {
      return context;
    },
  };
  const captured = [];
  const contextBuilder = {
    attachmentService: null,
    _resolveRuntimeBasePath() {
      return "";
    },
    _getEffectiveConfig() {
      return {};
    },
    async buildExistingSessionContext() {
      throw new Error("stopped resume must not rebuild Context from Session history");
    },
    async buildAgentContext(system, history, options) {
      captured.push({ system, history, options });
      return createTestAgentExecutionScope({});
    },
  };

  try {
    await engine._prepareStoppedSnapshotResumeTurnExecution({
      payload: {
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeDialogProcessId: stoppedIdentity.dialogProcessId,
          resumeTurnScopeId: stoppedIdentity.turnScopeId,
          turnScopeId: "turn-current",
        },
      },
      contextBuilder,
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
    assert.equal(captured[0].history[0].dialogProcessId, "dialog-history");
    assert.equal(captured[0].history[0].turnScopeId, "turn-history");
    assert.equal(captured[0].options.incrementalMessages[0].dialogProcessId, "dialog-current");
    assert.equal(captured[0].options.incrementalMessages[0].turnScopeId, "turn-current");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("_resolveStoppedResumeAttachments ingests raw attachments into the current session", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const ingestCalls = [];
  const contextBuilder = {
    attachmentService: {
      async ingest(payload) {
        ingestCalls.push(payload);
        return [
          {
            attachmentId: "att-1",
            sessionId: payload.sessionId,
            name: "resume.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            path: "/workspace/resume.docx",
          },
        ];
      },
    },
    _resolveRuntimeBasePath() {
      return "/workspace/u1";
    },
    _getEffectiveConfig() {
      return { attachments: { maxFileSize: 1024 } };
    },
  };

  const attachments = await engine._resolveStoppedResumeAttachments({
    contextBuilder,
    payload: {
      userId: "u1",
      sessionId: "s1",
      userMessageAttachments: [{ name: "resume.docx", type: "application/octet-stream" }],
    },
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].sessionId, "s1");
  assert.deepEqual(attachments, [
    {
      attachmentId: "att-1",
      sessionId: "s1",
      name: "resume.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      path: "/workspace/resume.docx",
    },
  ]);
});
