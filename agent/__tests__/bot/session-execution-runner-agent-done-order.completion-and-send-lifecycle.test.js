/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import {
  assert,
  fs,
  os,
  path,
  createRunner,
  finalizeAgentTurn,
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
  loadStoppedModelMessageSnapshot,
  collectLifecycleStates,
  createCurrentTurnMessagesStore,
  createTestAgentExecutionScope,
} from "./session-execution-runner-agent-done-order.fixtures.js";

test("runSession emits agent_done only after finalizeRunSession resolves", async () => {
  const callOrder = [];
  const eventListener = {
    onEvent({ event }) {
      callOrder.push(`event:${event}`);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    finalizeRunSession: async () => {
      callOrder.push("finalizeRunSession");
      return { ok: true };
    },
  });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
  });

  assert.equal(result.ok, true);
  const finalizeIndex = callOrder.indexOf("finalizeRunSession");
  const doneIndex = callOrder.indexOf("event:agent_done");
  assert.ok(finalizeIndex >= 0);
  assert.ok(doneIndex >= 0);
  assert.ok(doneIndex > finalizeIndex);
});

test("runSession does not emit agent_done when finalizeRunSession fails", async () => {
  const callOrder = [];
  const eventListener = {
    onEvent({ event }) {
      callOrder.push(`event:${event}`);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    finalizeRunSession: async () => {
      callOrder.push("finalizeRunSession");
      throw new Error("finalize failed");
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "hello",
      }),
    /finalize failed/,
  );

  assert.equal(callOrder.includes("event:agent_done"), false);
  assert.equal(callOrder.includes("upsertParentAsyncTask"), true);
  assert.equal(callOrder.includes("errorLogger.log"), true);
});

test("runSession emits direct-send lifecycle sequence", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
      callOrder.push(`event:${event.event}`);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    finalizeRunSession: async ({ lifecycle }) => {
      callOrder.push("finalizeRunSession");
      lifecycle.transition(AGENT_LIFECYCLE_STATE.PERSISTING);
      lifecycle.transition(AGENT_LIFECYCLE_STATE.MEMORY);
      lifecycle.transition(AGENT_LIFECYCLE_STATE.COMPLETED);
      return { ok: true };
    },
  });

  await runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" });

  assert.deepEqual(collectLifecycleStates(events), [
    AGENT_LIFECYCLE_STATE.INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_STATE.PERSISTING,
    AGENT_LIFECYCLE_STATE.MEMORY,
    AGENT_LIFECYCLE_STATE.COMPLETED,
  ]);
});

test("runSession emits resume-send lifecycle sequence", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    runConfig: {
      resumeFromStoppedSnapshot: true,
      resumeDialogProcessId: "dialog-stopped",
      resumeTurnScopeId: "turn-stopped",
    },
    finalizeRunSession: async ({ lifecycle }) => {
      lifecycle.transition(AGENT_LIFECYCLE_STATE.PERSISTING);
      lifecycle.transition(AGENT_LIFECYCLE_STATE.MEMORY);
      lifecycle.transition(AGENT_LIFECYCLE_STATE.COMPLETED);
      return { ok: true };
    },
  });

  await runner.runSession({ userId: "u1", sessionId: "s1", message: "continue" });

  assert.deepEqual(collectLifecycleStates(events), [
    AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_STATE.PERSISTING,
    AGENT_LIFECYCLE_STATE.MEMORY,
    AGENT_LIFECYCLE_STATE.COMPLETED,
  ]);
  assert.equal(events[0].data.phase, "继续初始化");
  assert.equal(events[0].data.resumeFromStoppedSnapshot, true);
});

test("runSession keeps resume snapshot identity separate from current run identity", async () => {
  const callOrder = [];
  const events = [];
  const captured = {};
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    runConfig: {
      resumeFromStoppedSnapshot: true,
      resumeDialogProcessId: "dialog-stopped",
      resumeTurnScopeId: "turn-stopped",
    },
    prepareAgentTurnExecution: async ({ buildContextPayload }) => {
      captured.buildContextPayload = buildContextPayload;
      const runtime = {
        attachmentMetas: [],
        currentTurnMessages: createCurrentTurnMessagesStore([]),
      };
      const agentContext = createTestAgentExecutionScope(runtime);
      return { agentContext, runtimeAgentContext: agentContext };
    },
    finalizeRunSession: async ({ dialogProcessId, turnScopeId, lifecycle }) => {
      captured.finalize = { dialogProcessId, turnScopeId };
      lifecycle.enterPersisting();
      lifecycle.enterMemory();
      lifecycle.complete();
      return { ok: true, dialogProcessId, turnScopeId };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "continue",
    runConfig: { turnScopeId: "turn-current" },
  });

  assert.equal(captured.buildContextPayload.dialogProcessId, "dialog-1");
  assert.equal(captured.buildContextPayload.runConfig.resumeDialogProcessId, "dialog-stopped");
  assert.equal(captured.buildContextPayload.runConfig.resumeTurnScopeId, "turn-stopped");
  assert.equal(captured.buildContextPayload.runConfig.turnScopeId, "turn-current");
  assert.deepEqual(captured.finalize, {
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-current",
  });
  assert.equal(events[0].data.dialogProcessId, "dialog-1");
  assert.equal(events[0].data.turnScopeId, "turn-current");
  assert.equal(events[0].data.resumeFromStoppedSnapshot, true);
});
