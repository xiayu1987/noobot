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
  findStoppedLifecycleEvent,
} from "./session-execution-runner-agent-done-order.fixtures.js";

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
  const interruptedEvent = events.find(
    (item) => item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED,
  );
  assert.equal(interruptedEvent.data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(interruptedEvent.data.canResume, false);
  assert.equal(interruptedEvent.data.stoppedSnapshotPersistence.reason, "non_user_abort");
});

test("runSession projects the structured timeout reason into interrupted lifecycle state", async () => {
  const callOrder = [];
  const events = [];
  const abortController = new AbortController();
  abortController.abort({
    type: "run_timeout",
    reason: "run timeout after 18000000ms",
    timeoutMs: 18000000,
  });
  const abortError = new Error("Request was aborted.");
  abortError.name = "AbortError";
  const runner = createRunner({
    callOrder,
    eventListener: { onEvent: (event) => events.push(event) },
    agentRunner: async () => {
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        abortSignal: abortController.signal,
      }),
    /Request was aborted/,
  );

  const interruptedEvent = events.find(
    (item) => item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED,
  );
  assert.equal(interruptedEvent?.data?.stopType, "run_timeout");
  assert.equal(interruptedEvent?.data?.error, "run timeout after 18000000ms");
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
      messages: [
        { type: "human", content: "hello", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
      ],
      messageBlocks: {
        system: [{ type: "system", content: "system" }],
        history: [],
        incremental: [
          { type: "human", content: "hello", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
        ],
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
  assert.deepEqual(savedEvent?.data?.roundIdentityAudit?.blocks?.incremental, {
    total: 1,
    complete: 1,
    missing: 0,
    partial: 0,
  });
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
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-runner-plain-user-stop-snapshot-"),
  );
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

test("runSession seals stopped snapshot only after the abort reaches the terminal catch", async () => {
  const callOrder = [];
  const events = [];
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-runner-stop-signal-snapshot-"),
  );
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
      runtime.stoppedModelMessageSnapshotCandidate.messageBlocks.incremental.push({
        type: "human",
        role: "user",
        content: "terminal hook injection after stop signal",
        injectedMessage: true,
        injectedMessageType: "separate_model_relay:guidance",
      });
      throw abortError;
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () =>
      runner.runSession({
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
  assert.equal(loaded.messages.at(-1).content, "terminal hook injection after stop signal");
  assert.equal(loaded.messages.at(-1).injectedMessage, true);
  assert.equal(loaded.messages.at(-1).injectedMessageType, "separate_model_relay:guidance");
  const savedEvent = events.find((item) => item.event === "stopped_model_message_snapshot_saved");
  assert.equal(savedEvent?.data?.source, "runner_user_stop_catch");
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "saved");
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.source, "runner_user_stop_catch");
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

  const skippedEvent = events.find(
    (item) => item.event === "stopped_model_message_snapshot_save_skipped",
  );
  assert.equal(skippedEvent?.data?.reason, "missing_identity");
  assert.deepEqual(skippedEvent?.data?.missingIdentityFields, ["turnScopeId"]);
  const stoppedEvent = findStoppedLifecycleEvent(events);
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.status, "skipped");
  assert.equal(stoppedEvent?.data?.stoppedSnapshotPersistence?.reason, "missing_identity");
  assert.deepEqual(stoppedEvent?.data?.stoppedSnapshotPersistence?.missingIdentityFields, [
    "turnScopeId",
  ]);
});
