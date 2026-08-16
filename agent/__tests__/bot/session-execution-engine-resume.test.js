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
import { projectRecoveredMessagesToIdentity } from "../../src/bot/session/turn-execution-preparer.js";
import { saveStoppedModelMessageSnapshot } from "../../src/runtime/resume/model-message-snapshot-store.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("projectRecoveredMessagesToIdentity atomically replaces every recovered round identity", () => {
  const messages = [
    {
      type: "human",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
      content: "question",
    },
    { type: "ai", content: "answer", tool_calls: [{ id: "call-1" }] },
    {
      type: "tool",
      dialogProcessId: "dialog-older",
      turnScopeId: "turn-older",
      tool_call_id: "call-1",
      content: "result",
    },
    {
      type: "system",
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      content: "system",
    },
  ];

  const projected = projectRecoveredMessagesToIdentity(messages, {
    dialogProcessId: "dialog-current",
    turnScopeId: "turn-current",
  });

  assert.deepEqual(
    projected.map((message) => message.dialogProcessId),
    ["dialog-current", "dialog-current", "dialog-current", "dialog-current"],
  );
  assert.deepEqual(
    projected.map((message) => message.turnScopeId),
    ["turn-current", "turn-current", "turn-current", "turn-current"],
  );
  assert.ok(projected.every((message) => message.sourceDialogProcessId === undefined));
  assert.equal(projected[1].tool_calls[0].id, "call-1");
  assert.equal(projected[2].tool_call_id, "call-1");

  projectRecoveredMessagesToIdentity(projected, {
    dialogProcessId: "dialog-next",
    turnScopeId: "turn-next",
  });
  assert.deepEqual(
    projected.map((message) => message.dialogProcessId),
    ["dialog-next", "dialog-next", "dialog-next", "dialog-next"],
  );
});

test("projectRecoveredMessagesToIdentity rebinds session and round identity", () => {
  const message = {
    type: "ai",
    sessionId: "old-session",
    dialogProcessId: "old-dialog",
    turnScopeId: "old-turn",
  };
  const identity = {
    userName: "admin",
    sessionId: "current-session",
    parentSessionId: "parent-session",
    dialogProcessId: "current-dialog",
    parentDialogProcessId: "parent-dialog",
    turnScopeId: "current-turn",
  };

  const [projected] = projectRecoveredMessagesToIdentity([message], identity);

  for (const field of ["userName", "sessionId", "parentSessionId", "parentDialogProcessId"]) {
    assert.equal(projected[field], identity[field]);
  }
  assert.equal(projected.dialogProcessId, "current-dialog");
  assert.equal(projected.turnScopeId, "current-turn");
});

test("projectRecoveredMessagesToIdentity assigns current identity when historical identity is missing", () => {
  const [projected] = projectRecoveredMessagesToIdentity([{ type: "tool", content: "result" }], {
    sessionId: "current-session",
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
  });
  assert.equal(projected.sessionId, "current-session");
  assert.equal(projected.dialogProcessId, "current-dialog");
  assert.equal(projected.turnScopeId, "current-turn");
});

test("stopped snapshot v2 history without round identity is rebound to current turn", () => {
  const snapshotHistory = [
    { type: "human", content: "测试所有工具" },
    { type: "ai", content: "", tool_calls: [{ id: "call-1", name: "write_file", args: {} }] },
    { type: "tool", content: "ok", tool_call_id: "call-1" },
    { type: "human", content: "[来自harness外部模型输出/guidance]\n已确认" },
  ];
  const identity = {
    userName: "admin",
    sessionId: "6d3eec60-6cae-4c9d-9a07-8d391d5cd3c7",
    parentSessionId: "",
    dialogProcessId: "current-dialog",
    parentDialogProcessId: "",
    turnScopeId: "current-turn",
  };

  const projected = projectRecoveredMessagesToIdentity(snapshotHistory, identity);

  assert.equal(projected.length, snapshotHistory.length);
  assert.ok(projected.every((message) => message.sessionId === identity.sessionId));
  assert.ok(projected.every((message) => message.dialogProcessId === identity.dialogProcessId));
  assert.ok(projected.every((message) => message.turnScopeId === identity.turnScopeId));
  assert.equal(projected[1].tool_calls[0].id, "call-1");
  assert.equal(projected[2].tool_call_id, "call-1");
});

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
      history: [{ type: "human", content: "history" }],
      incremental: [{ type: "human", content: "incremental" }],
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
    assert.equal(captured[0].history[0].dialogProcessId, "dialog-current");
    assert.equal(captured[0].history[0].turnScopeId, "turn-current");
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
