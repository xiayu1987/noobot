/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";
import { projectRecoveredMessagesToDialog, projectRecoveredMessagesToIdentity } from "../../../src/system-core/bot-manage/session/turn-execution-preparer.js";

test("projectRecoveredMessagesToDialog fills missing dialog identity and preserves historical rounds", () => {
  const messages = [
    { type: "human", dialogProcessId: "dialog-stopped", content: "question" },
    { type: "ai", content: "answer", tool_calls: [{ id: "call-1" }] },
    { type: "tool", dialogProcessId: "dialog-older", tool_call_id: "call-1", content: "result" },
    { type: "system", dialogProcessId: "dialog-current", content: "system" },
  ];

  const projected = projectRecoveredMessagesToDialog(messages, "dialog-current");

  assert.deepEqual(projected.map((message) => message.dialogProcessId), [
    "dialog-stopped", "dialog-current", "dialog-older", "dialog-current",
  ]);
  assert.ok(projected.every((message) => message.sourceDialogProcessId === undefined));
  assert.equal(projected[1].tool_calls[0].id, "call-1");
  assert.equal(projected[2].tool_call_id, "call-1");

  projectRecoveredMessagesToDialog(projected, "dialog-next");
  assert.deepEqual(projected.map((message) => message.dialogProcessId), [
    "dialog-stopped", "dialog-current", "dialog-older", "dialog-current",
  ]);
});

test("projectRecoveredMessagesToIdentity rebinds session identity but preserves historical round identity", () => {
  const message = { type: "ai", sessionId: "old-session", dialogProcessId: "old-dialog", turnScopeId: "old-turn" };
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
  assert.equal(projected.dialogProcessId, "old-dialog");
  assert.equal(projected.turnScopeId, "old-turn");
});

test("projectRecoveredMessagesToIdentity can leave missing historical round identity untouched for snapshot history", () => {
  const [projected] = projectRecoveredMessagesToIdentity([{ type: "tool", content: "result" }], {
    sessionId: "current-session",
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
  }, {
    fillMissingHistoricalRoundIdentity: false,
  });
  assert.equal(projected.sessionId, "current-session");
  assert.equal(projected.dialogProcessId, undefined);
  assert.equal(projected.turnScopeId, undefined);
});

test("stopped snapshot v2 history without round identity is not rebound to current turn", () => {
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

  const projected = projectRecoveredMessagesToIdentity(snapshotHistory, identity, {
    preserveHistoricalRoundIdentity: true,
    fillMissingHistoricalRoundIdentity: false,
  });

  assert.equal(projected.length, snapshotHistory.length);
  assert.ok(projected.every((message) => message.sessionId === identity.sessionId));
  assert.ok(projected.every((message) => message.dialogProcessId === undefined));
  assert.ok(projected.every((message) => message.turnScopeId === undefined));
  assert.equal(projected[1].tool_calls[0].id, "call-1");
  assert.equal(projected[2].tool_call_id, "call-1");
});

test("_prepareStoppedSnapshotResumeTurnExecution requires explicit stopped snapshot identity", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const contextBuilder = {
    async _buildAgentContext() {
      throw new Error("snapshot identity validation should run before context build");
    },
  };

  await assert.rejects(
    () => engine._prepareStoppedSnapshotResumeTurnExecution({
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

test("stopped snapshot resume preserves history and incremental block boundaries", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = {};
  engine._applyRunConfigToolPolicy = (context) => context;
  engine.agentRuntimeFacade = {
    buildRunTurnContext(context) {
      return context;
    },
  };
  const captured = [];
  const contextBuilder = {
    async _buildAgentContext(system, history, options) {
      captured.push({ system, history, options });
      return { execution: { controllers: { runtime: {} } }, payload: { messages: {} } };
    },
  };
  // Avoid coupling this regression to the snapshot filesystem loader by using
  // the public projection contract at the context-builder boundary.
  const history = [{ type: "human", content: "history", dialogProcessId: "old" }];
  const incremental = [{ type: "human", content: "injected", injectedMessage: true }];
  await contextBuilder._buildAgentContext([], history, { incrementalMessages: incremental });

  assert.deepEqual(captured[0].history, history);
  assert.deepEqual(captured[0].options.incrementalMessages, incremental);
});

test("_resolveStoppedResumeAttachments ingests raw attachments into the current session", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const ingestCalls = [];
  const contextBuilder = {
    attachmentService: {
      async ingest(payload) {
        ingestCalls.push(payload);
        return [{
          attachmentId: "att-1",
          sessionId: payload.sessionId,
          name: "resume.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path: "/workspace/resume.docx",
        }];
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
  assert.deepEqual(attachments, [{
    attachmentId: "att-1",
    sessionId: "s1",
    name: "resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    path: "/workspace/resume.docx",
  }]);
});
