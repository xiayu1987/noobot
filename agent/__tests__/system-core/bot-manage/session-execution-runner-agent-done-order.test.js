/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionRunner } from "../../../src/system-core/bot-manage/execution/runner.js";
import {
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
} from "../../../src/system-core/agent/core/lifecycle/state-machine.js";
import { loadStoppedModelMessageSnapshot } from "../../../src/system-core/agent/core/resume/model-message-snapshot-store.js";

function createRunner({
  callOrder,
  eventListener,
  finalizeRunSession,
  agentRunner,
  runConfig = {},
  prepareAgentTurnExecution,
  runtime,
}) {
  const defaultRuntime = runtime || { attachmentMetas: [] };
  return new SessionExecutionRunner({
    agentRunner: agentRunner || (async () => {
      callOrder.push("agentRunner");
      return {
        output: "ok",
        traces: [{ id: "trace-1" }],
        turnMessages: [{ role: "assistant", type: "message", content: "ok" }],
        turnTasks: [],
      };
    }),
    errorLogger: {
      async log() {
        callOrder.push("errorLogger.log");
      },
    },
    normalizeRunMessage: (message) => message,
    validateRunInput: () => {},
    ensureParentAsyncResultContainer: () => null,
    initializeRunSessionRuntime: async () => ({
      usedSessionId: "session-used",
      dialogProcessId: "dialog-1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig) => runConfig,
    prepareRunConfig: ({ runConfig: inputRunConfig }) => ({
      turnScopeId: inputRunConfig?.turnScopeId || runConfig?.turnScopeId || "turn-default",
      ...inputRunConfig,
      ...runConfig,
    }),
    prepareAgentTurnExecution: prepareAgentTurnExecution || (async () => ({
      agentContext: {
        execution: {
          controllers: {
            runtime: defaultRuntime,
          },
        },
      },
      runtimeAgentContext: {
        execution: {
          controllers: {
            runtime: defaultRuntime,
          },
        },
      },
    })),
    appendSessionTurn: async () => {
      callOrder.push("appendSessionTurn");
    },
    finalizeRunSession,
    upsertParentAsyncTask: () => {
      callOrder.push("upsertParentAsyncTask");
    },
    now: () => "2026-05-21T00:00:00.000Z",
  });
}

function collectLifecycleStates(events) {
  return events
    .filter((item) => item.event === AGENT_LIFECYCLE_EVENT)
    .map((item) => item.data.state);
}

function findStoppedLifecycleEvent(events) {
  return events.find(
    (item) => item.event === AGENT_LIFECYCLE_EVENT && item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED,
  );
}

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
      return {
        agentContext: {
          execution: {
            controllers: {
              runtime: { attachmentMetas: [] },
            },
          },
        },
        runtimeAgentContext: {},
      };
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

test("runSession emits interrupted branch lifecycle state for non-user abort errors", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const runner = createRunner({
    callOrder,
    eventListener,
    agentRunner: async () => {
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    /aborted/,
  );

  assert.deepEqual(collectLifecycleStates(events), [
    AGENT_LIFECYCLE_STATE.INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED,
  ]);
  const interruptedEvent = events.find((item) => item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(interruptedEvent.data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(interruptedEvent.data.canResume, false);
  assert.equal(interruptedEvent.data.stoppedSnapshotPersistence.reason, "non_user_abort");
});

test("runSession persists stopped model message snapshot from runtime candidate on abort", async () => {
  const callOrder = [];
  const events = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-runner-stop-snapshot-"));
  const runtime = {
    attachmentMetas: [],
    globalConfig: { workspaceRoot },
    stoppedModelMessageSnapshotCandidate: {
      userId: "u1",
      sessionId: "session-used",
      parentSessionId: "",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      messages: [{ type: "human", content: "hello", additional_kwargs: { dialogProcessId: "dialog-1" } }],
      messageBlocks: {
        system: [{ type: "system", content: "system" }],
        history: [],
        incremental: [{ type: "human", content: "hello" }],
      },
    },
  };
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  abortError.reason = { type: "user_stop" };
  const runner = createRunner({
    callOrder,
    eventListener,
    runtime,
    runConfig: { turnScopeId: "turn-1" },
    agentRunner: async () => {
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    /aborted/,
  );

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity: {
      userId: "u1",
      sessionId: "session-used",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
  });
  assert.equal(loaded.messages[0].content, "system");
  assert.equal(loaded.messages.at(-1).content, "hello");
  assert.equal(loaded.messageBlocks.system[0].content, "system");
  const savedEvent = events.find((item) => item.event === "stopped_model_message_snapshot_saved");
  assert.equal(savedEvent?.data?.source, "runner_user_stop_catch");
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "saved");
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.source, "runner_user_stop_catch");
  assert.equal(stoppedEvent?.data?.canResume, true);
  assert.deepEqual(stoppedEvent?.data?.stoppedSnapshotPersistence?.identity, {
    userId: "u1",
    sessionId: "session-used",
    parentSessionId: "",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  });
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.messageCount, 2);
});

test("runSession persists stopped model message snapshot for plain user_stop error objects", async () => {
  const callOrder = [];
  const events = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-runner-plain-user-stop-snapshot-"));
  const runtime = {
    attachmentMetas: [],
    globalConfig: { workspaceRoot },
    stoppedModelMessageSnapshotCandidate: {
      userId: "u1",
      sessionId: "session-used",
      parentSessionId: "",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-2",
      messages: [{ type: "human", content: "second stop snapshot" }],
      messageBlocks: {
        system: [{ type: "system", content: "system second" }],
        history: [{ type: "ai", content: "previous assistant" }],
        incremental: [{ type: "human", content: "second stop snapshot" }],
      },
    },
  };
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    runtime,
    runConfig: { turnScopeId: "turn-2" },
    agentRunner: async () => {
      throw { type: "user_stop", message: "second user stop" };
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    (error) => error?.type === "user_stop" && error?.message === "second user stop",
  );

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity: {
      userId: "u1",
      sessionId: "session-used",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-2",
    },
  });
  assert.equal(loaded.messages[0].content, "system second");
  assert.equal(loaded.messages[1].content, "previous assistant");
  assert.equal(loaded.messages.at(-1).content, "second stop snapshot");
  assert.equal(loaded.messageBlocks.system[0].content, "system second");
  const savedEvent = events.find((item) => item.event === "stopped_model_message_snapshot_saved");
  assert.equal(savedEvent?.data?.source, "runner_user_stop_catch");
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.state, AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "saved");
  assert.equal(stoppedEvent?.data?.canResume, true);
});

test("runSession persists stopped snapshot when abort signal fires before abort error bubbles", async () => {
  const callOrder = [];
  const events = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-runner-stop-signal-snapshot-"));
  const abortController = new AbortController();
  const runtime = {
    attachmentMetas: [],
    globalConfig: { workspaceRoot },
    stoppedModelMessageSnapshotCandidate: {
      userId: "u1",
      sessionId: "session-used",
      parentSessionId: "",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-signal",
      messages: [{ type: "human", content: "hello before signal" }],
      messageBlocks: {
        system: [{ type: "system", content: "system" }],
        history: [],
        incremental: [{ type: "human", content: "hello before signal" }],
      },
    },
  };
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const abortError = new Error("aborted after signal");
  abortError.name = "AbortError";
  const runner = createRunner({
    callOrder,
    eventListener,
    runtime,
    runConfig: { turnScopeId: "turn-signal" },
    agentRunner: async () => {
      abortController.abort({ type: "user_stop", reason: "user stop action" });
      await new Promise((resolve) => setImmediate(resolve));
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({
      userId: "u1",
      sessionId: "s1",
      message: "hello",
      abortSignal: abortController.signal,
    }),
    /aborted after signal/,
  );

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity: {
      userId: "u1",
      sessionId: "session-used",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-signal",
    },
  });
  assert.equal(loaded.messages[0].content, "system");
  assert.equal(loaded.messages.at(-1).content, "hello before signal");
  const savedEvent = events.find((item) => item.event === "stopped_model_message_snapshot_saved");
  assert.equal(savedEvent?.data?.source, "runner_user_stop_signal");
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "saved");
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.source, "runner_user_stop_signal");
});

test("runSession emits stopped snapshot diagnostic when abort candidate is incomplete", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  abortError.reason = { type: "user_stop" };
  const runner = createRunner({
    callOrder,
    eventListener,
    runtime: {
      attachmentMetas: [],
      stoppedModelMessageSnapshotCandidate: {
        userId: "u1",
        sessionId: "session-used",
        dialogProcessId: "dialog-1",
        turnScopeId: "",
        messages: [],
        messageBlocks: { system: [], history: [], incremental: [] },
      },
    },
    agentRunner: async () => {
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    /aborted/,
  );

  const skippedEvent = events.find((item) => item.event === "stopped_model_message_snapshot_save_skipped");
  assert.equal(skippedEvent?.data?.reason, "missing_identity");
  assert.deepEqual(skippedEvent?.data?.missingIdentityFields, ["turnScopeId"]);
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "skipped");
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.reason, "missing_identity");
  assert.deepEqual(stoppedEvent?.data?.stoppedSnapshotPersistence?.missingIdentityFields, ["turnScopeId"]);
});

test("runSession does not persist stopped snapshot for non-abort errors", async () => {
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
    runtime: {
      attachmentMetas: [],
      stoppedModelMessageSnapshotCandidate: {
        userId: "u1",
        sessionId: "session-used",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        messages: [],
        messageBlocks: { system: [], history: [], incremental: [] },
      },
    },
    agentRunner: async () => {
      throw new Error("model failed");
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    /model failed/,
  );

  assert.equal(events.some((item) => item.event === "stopped_model_message_snapshot_saved"), false);
  assert.equal(events.some((item) => item.event === "stopped_model_message_snapshot_save_skipped"), false);
});

test("runSession emits failed branch lifecycle state for non-abort errors", async () => {
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
    agentRunner: async () => {
      throw new Error("model failed");
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
    /model failed/,
  );

  assert.deepEqual(collectLifecycleStates(events), [
    AGENT_LIFECYCLE_STATE.INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_BRANCH_STATE.FAILED,
  ]);
  const failedEvent = events.find((item) => item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(failedEvent.data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(failedEvent.data.error, "model failed");
});
