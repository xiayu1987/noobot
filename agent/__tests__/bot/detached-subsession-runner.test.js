/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createDetachedSubSessionRunner,
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "../../src/bot/session/detached-subsession-runner.js";
import { CALLER_ROLE } from "../../src/bot/config/constants.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";

function createDeps(overrides = {}) {
  const calls = {
    runSessionPayloads: [],
    persistencePayloads: [],
    mergePayload: null,
    prepareRunConfigPayload: null,
    loadedWorkspacePath: "",
    emitted: [],
    lifecyclePayloads: [],
  };
  const deps = {
    workspaceService: {
      getWorkspacePath(userId = "") {
        return `/tmp/workspace/${userId}`;
      },
    },
    configService: {
      async loadUserConfig(workspacePath = "") {
        calls.loadedWorkspacePath = workspacePath;
        return { userConfigLoaded: true };
      },
    },
    sessionRunner: {
      async runSession(payload = {}) {
        calls.runSessionPayloads.push(payload);
        return {
          output: "agent answer",
          traces: [{ type: "trace" }],
          turnTasks: [{ taskId: "t1" }],
          turnMessages: [{ role: "assistant", content: "agent answer" }],
          dialogProcessId: payload.dialogProcessId || "sub-dialog",
          lifecycle: { executionState: "completed" },
          session: { sessionId: payload.sessionId, version: 3, revision: 3 },
        };
      },
    },
    session: {
      async applyTurnLifecycleEvent(payload = {}) {
        calls.lifecyclePayloads.push(payload);
        const sequence = calls.lifecyclePayloads.length;
        return {
          applied: true,
          envelope: { ...payload, sequence, revision: sequence },
          turn: { ...payload, sequence, revision: sequence },
        };
      },
      createScopedPersistenceContext(payload = {}) {
        calls.persistencePayloads.push(payload);
        return Object.freeze({ locationResolver: { marker: payload.relativeDir }, metadataContributor: payload.metadataContributor });
      },
    },
    pluginRuntime: {
      agentPluginKey: "harness",
      botPluginKey: "workflow",
      agentPluginSelectors: new Set(["agentPlugin"]),
      botPluginSelectors: new Set(["botPlugin"]),
    },
    mergeRunConfigWithPluginStrategy(payload = {}) {
      calls.mergePayload = payload;
      return {
        ...payload.baseRunConfig,
        ...payload.runConfigPatch,
        disabledPlugins: payload.disabledPlugins,
        hookManager: { shouldBeDeleted: true },
        hooks: { shouldBeDeleted: true },
        botHookManager: { shouldBeDeleted: true },
        botHooks: { shouldBeDeleted: true },
      };
    },
    prepareRunConfig(payload = {}) {
      calls.prepareRunConfigPayload = payload;
      return {
        ...payload.runConfig,
        selectedPlugins: ["agentPlugin", "botPlugin"],
        plugins: {
          agentPlugin: { enabled: true, mode: "on" },
          botPlugin: { enabled: true, mode: "on" },
        },
      };
    },
  };
  return { calls, deps: { ...deps, ...overrides } };
}

function createParentContext(extra = {}) {
  return {
    userId: "u1",
    sessionId: "parent1",
    dialogProcessId: "parent-dialog",
    runConfig: { base: true },
    ...extra,
  };
}

test("detached sub-session delegates execution and persistence to the main runner", async () => {
  const { calls, deps } = createDeps();
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);
  const result = await runner({
    parentContext: createParentContext(),
    message: "hello",
    attachments: [{ name: "a.txt" }],
    systemMessages: ["system"],
    runConfigPatch: { turnScopeId: "turn-1", extra: true },
    eventListener: { onEvent: (event) => events.push(event) },
    strategy: {
      sessionId: "sub1",
      parentSessionId: "parent1",
      parentDialogProcessId: "parent-dialog",
      dialogProcessId: "sub-dialog",
      turnScopeId: "turn-1",
      executionId: "agent:turn-1",
      parentExecutionId: "workflow:root",
      rootExecutionId: "workflow:root",
      disabledPlugins: ["workflow"],
      relativeDir: "runtime/workflow/session/root/node-a",
      allowedRoot: "runtime/workflow/session",
    },
    metadata: { scope: "workflow_node", nodeId: "n1" },
  });

  assert.equal(calls.runSessionPayloads.length, 1);
  const payload = calls.runSessionPayloads[0];
  assert.equal(payload.userId, "u1");
  assert.equal(payload.sessionId, "sub1");
  assert.equal(payload.parentSessionId, "parent1");
  assert.equal(payload.parentDialogProcessId, "parent-dialog");
  assert.equal(payload.caller, CALLER_ROLE.BOT);
  assert.equal(payload.message, "hello");
  assert.deepEqual(payload.attachments, [{ name: "a.txt" }]);
  assert.deepEqual(payload.systemMessages, ["system"]);
  assert.equal(payload.turnScopeId, "turn-1");
  assert.equal(payload.runConfig.hookManager, undefined);
  assert.equal(payload.runConfig.hooks, undefined);
  assert.equal(payload.runConfig.botHookManager, undefined);
  assert.equal(payload.runConfig.botHooks, undefined);
  assert.deepEqual(payload.runConfig.disabledPlugins, ["workflow"]);
  assert.equal(payload.runConfig.executionId, "agent:turn-1");
  assert.equal(payload.runConfig.executionKind, "agent");
  assert.equal(payload.runConfig.parentExecutionId, "workflow:root");
  assert.equal(payload.runConfig.rootExecutionId, "workflow:root");
  assert.equal(payload.runConfig.systemRuntimePatch.durableParentSessionId, "parent1");
  assert.equal(payload.parentAsyncResultContainer, null);
  assert.ok(payload.persistenceContext);
  assert.equal(calls.persistencePayloads[0].sessionId, "sub1");
  assert.equal(calls.persistencePayloads[0].parentSessionId, "parent1");
  assert.equal(calls.persistencePayloads[0].scopeId, "agent:turn-1");

  assert.equal(calls.persistencePayloads.length, 1);
  assert.deepEqual(calls.persistencePayloads[0], {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    scopeId: "agent:turn-1",
    relativeDir: "runtime/workflow/session/root/node-a",
    allowedRoot: "runtime/workflow/session",
    metadataContributor: calls.persistencePayloads[0].metadataContributor,
  });
  const metadata = calls.persistencePayloads[0].metadataContributor();
  assert.equal(metadata.scope, "workflow_node");
  assert.equal(metadata.nodeId, "n1");
  assert.equal(metadata.sessionId, "sub1");
  assert.equal(metadata.runtimePluginState.scope, "detached_sub_session");
  assert.equal(events.some((event) => event?.event === "plugin_runtime_resolved"), true);
  assert.deepEqual(
    calls.lifecyclePayloads.map((payload) => payload.eventType),
    [
      "turn.action_accepted",
      "turn.processing_started",
      "turn.processing_completed",
      "turn.completed",
    ],
  );
  assert.equal(
    events.filter((event) => event?.event === "turn_lifecycle_committed").length,
    4,
  );
  assert.equal(
    events
      .filter((event) => event?.event === "turn_lifecycle_committed")
      .every((event) => event.data.persistenceContext === undefined && event.data.envelope.persistenceScope),
    true,
  );
  const completedLifecycle = calls.lifecyclePayloads.at(-1);
  assert.deepEqual(completedLifecycle.persistenceScope, {
    scopeId: "agent:turn-1",
    parentSessionId: "parent1",
    relativeDir: "runtime/workflow/session/root/node-a",
    allowedRoot: "runtime/workflow/session",
  });
  assert.equal(completedLifecycle.completionCommitId, "turn-1:completed");
  assert.deepEqual(completedLifecycle.terminalStatus, {
    command: "completed",
    description: "子 Agent 已正常完成",
  });

  assert.equal(result.sessionId, "sub1");
  assert.equal(result.parentSessionId, "parent1");
  assert.equal(result.dialogProcessId, payload.dialogProcessId);
  assert.equal(result.dialogProcessId, "sub-dialog");
  assert.equal(calls.lifecyclePayloads.every((item) => item.dialogProcessId === result.dialogProcessId), true);
  assert.equal(result.persisted.version, 3);
  assert.equal(result.lifecycle.executionState, "completed");
  assert.equal(result.result.answer, "agent answer");
  assert.deepEqual(result.result.messages, [{ role: "assistant", content: "agent answer" }]);
  assert.deepEqual(result.result.turnTasks, [{ taskId: "t1" }]);
});

test("detached sub-session persists its complete authoritative lifecycle outbox", async () => {
  let persisted = null;
  const fixedNow = () => "2026-07-30T12:53:35.738Z";
  const repo = {
    async withSessionMutation(_userId, _sessionId, _context, operation) { return operation(); },
    async resolveParentSessionId() { return "parent1"; },
    createInitialSession({ sessionId, parentSessionId }) {
      return normalizeSessionEntity({
        sessionId,
        parentSessionId,
        version: 0,
        revision: 0,
        messages: [],
      }, { now: fixedNow });
    },
    async findById() {
      return persisted ? normalizeSessionEntity(structuredClone(persisted), { now: fixedNow }) : null;
    },
    async save(_userId, next, _context, { expectedVersion, createOnly } = {}) {
      if (createOnly) assert.equal(persisted, null);
      else assert.equal(expectedVersion, Number(persisted?.version ?? persisted?.revision ?? 0));
      persisted = structuredClone(normalizeSessionEntity(next, { now: fixedNow }));
    },
  };
  const messageService = new SessionMessageService({ sessionRepo: repo, now: fixedNow });
  const { deps } = createDeps({
    session: {
      applyTurnLifecycleEvent: (payload) => messageService.applyTurnLifecycleEvent(payload),
      createScopedPersistenceContext(payload = {}) {
        return Object.freeze({
          locationResolver: {
            marker: payload.relativeDir,
            async resolveSessionScope(userId, sessionId, parentSessionId) {
              return { userId, sessionId, resolvedParentSessionId: parentSessionId };
            },
          },
          metadataContributor: payload.metadataContributor,
        });
      },
    },
  });

  await createDetachedSubSessionRunner({ ...deps, now: fixedNow })({
    parentContext: createParentContext(),
    message: "hello",
    runConfigPatch: { turnScopeId: "turn-persisted" },
    strategy: {
      sessionId: "sub-persisted",
      parentSessionId: "parent1",
      dialogProcessId: "sub-dialog",
    },
  });

  assert.deepEqual(
    persisted.authorityEventOutbox.map((entry) => entry.envelope.eventType),
    [
      "turn.action_accepted",
      "turn.processing_started",
      "turn.processing_completed",
      "turn.completed",
    ],
  );
  assert.equal(persisted.turnLifecycle.turns["turn-persisted"].state, "completed");
  assert.equal(persisted.authorityEventOutbox[3].envelope.summaryVersion >= 1, true);
  assert.equal(
    persisted.authorityEventOutbox[3].envelope.completionCommitId,
    "turn-persisted:completed",
  );
});

test("detached sub-session rejects a runner result with a second dialog identity", async () => {
  const { calls, deps } = createDeps({
    sessionRunner: {
      async runSession() {
        return { output: "done", dialogProcessId: "foreign-dialog" };
      },
    },
  });
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    runner({
      parentContext: createParentContext(),
      message: "hello",
      strategy: {
        sessionId: "sub1",
        dialogProcessId: "authoritative-dialog",
        executionId: "agent:turn-identity-mismatch",
      },
      eventListener: { onEvent: (event) => events.push(event) },
    }),
    (error) => (
      error?.code === "DETACHED_DIALOG_IDENTITY_MISMATCH" &&
      error?.lifecycle?.state === "processing_failed" &&
      error?.lifecycle?.executionId === "agent:turn-identity-mismatch"
    ),
  );
  assert.equal(
    events.some((event) => event?.event === "detached_sub_session_identity_mismatch"),
    true,
  );
  assert.equal(
    events.some((event) => (
      event?.event === "detached_sub_session_failure_committed" &&
      event?.data?.errorCode === "DETACHED_DIALOG_IDENTITY_MISMATCH" &&
      event?.data?.revision > 0
    )),
    true,
  );
  assert.equal(calls.lifecyclePayloads.at(-1)?.eventType, "turn.failed");
  assert.equal(calls.lifecyclePayloads.at(-1)?.failure?.code, "DETACHED_DIALOG_IDENTITY_MISMATCH");
});

test("detached sub-session does not inherit parent turn transaction identity", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentContext: createParentContext({
      runConfig: {
        streaming: true,
        selectedPlugins: ["workflow"],
        resumeFromStoppedSnapshot: true,
        resumeDialogProcessId: "root-old-dialog",
        resumeTurnScopeId: "root-old-turn",
        expectedVersion: 7,
        idempotencyKey: "root-continue-command",
        reuseExistingUserTurn: true,
        thinkingStartedAt: "2026-07-26T12:00:00.000Z",
        presentationMessageId: "root-presentation-message",
        assistantMessageId: "root-assistant-message",
      },
    }),
    runConfigPatch: {
      turnScopeId: "child-turn",
      workflowRunId: "workflow-run-1",
      workflowNodeExecutionId: "node-execution-1",
    },
    strategy: {
      sessionId: "sub1",
      executionId: "agent:child-turn",
      relativeDir: "runtime/workflow/session/root/node-a",
      allowedRoot: "runtime/workflow/session",
    },
  });

  const runConfig = calls.runSessionPayloads[0].runConfig;
  assert.equal(runConfig.resumeFromStoppedSnapshot, undefined);
  assert.equal(runConfig.resumeDialogProcessId, undefined);
  assert.equal(runConfig.resumeTurnScopeId, undefined);
  assert.equal(runConfig.expectedVersion, undefined);
  assert.equal(runConfig.idempotencyKey, undefined);
  assert.equal(runConfig.reuseExistingUserTurn, undefined);
  assert.equal(Number.isFinite(Date.parse(runConfig.thinkingStartedAt)), true);
  assert.notEqual(runConfig.thinkingStartedAt, "2026-07-26T12:00:00.000Z");
  assert.match(runConfig.presentationMessageId, /^msg_/);
  assert.notEqual(runConfig.presentationMessageId, "root-presentation-message");
  assert.equal(runConfig.assistantMessageId, undefined);
  assert.equal(runConfig.streaming, true);
  assert.equal(runConfig.workflowRunId, "workflow-run-1");
  assert.equal(runConfig.workflowNodeExecutionId, "node-execution-1");
  assert.equal(runConfig.turnScopeId, "child-turn");
  assert.equal(runConfig.executionId, "agent:child-turn");
  assert.deepEqual(runConfig.selectedPlugins, ["agentPlugin", "botPlugin"]);
  assert.equal(calls.mergePayload.baseRunConfig.expectedVersion, undefined);
  assert.equal(calls.mergePayload.baseRunConfig.idempotencyKey, undefined);
});

test("detached sub-session preserves child-owned transaction fields from its patch", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentContext: createParentContext({
      runConfig: { expectedVersion: 7, idempotencyKey: "root-command" },
    }),
    runConfigPatch: {
      turnScopeId: "child-turn",
      expectedVersion: 0,
      idempotencyKey: "child-command",
      thinkingStartedAt: "2026-07-26T12:30:00.000Z",
    },
    strategy: { sessionId: "sub1" },
  });

  const runConfig = calls.runSessionPayloads[0].runConfig;
  assert.equal(runConfig.expectedVersion, 0);
  assert.equal(runConfig.idempotencyKey, "child-command");
  assert.equal(runConfig.thinkingStartedAt, "2026-07-26T12:30:00.000Z");
});

test("detached sub-session propagates main runner abort and failure contracts", async () => {
  const abortError = new Error("stopped");
  abortError.name = "AbortError";
  const { calls, deps } = createDeps({
    sessionRunner: {
      async runSession() {
        throw abortError;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({
      parentContext: createParentContext(),
      strategy: {
        sessionId: "sub1",
        relativeDir: "runtime/workflow/session/root/node-a",
        allowedRoot: "runtime/workflow/session",
      },
    }),
    (error) => error === abortError,
  );
  assert.deepEqual(
    calls.lifecyclePayloads.map((payload) => payload.eventType),
    [
      "turn.action_accepted",
      "turn.processing_started",
      "turn.stop_accepted",
      "turn.stop_processing_completed",
      "turn.stop_completed",
    ],
  );
  const stoppedLifecycle = calls.lifecyclePayloads.at(-1);
  assert.equal(stoppedLifecycle.completionCommitId, "sub1:stop-completed");
  assert.deepEqual(stoppedLifecycle.terminalStatus, {
    command: "user_stopped",
    description: "子 Agent 已停止",
  });
});

test("detached terminal receipt adapts persisted Agent success and failure states", () => {
  const completed = createDetachedTerminalReceipt({
    executionId: "agent:child-1",
    lifecycle: { state: "completed", executionId: "agent:child-1", revision: 5, sequence: 5 },
  });
  assert.deepEqual(completed, {
    state: "completed",
    executionId: "agent:child-1",
    executionKind: "agent",
    revision: 5,
    sequence: 5,
    failure: null,
  });

  const failed = createDetachedTerminalReceipt({
    executionId: "agent:child-1",
    failed: true,
    lifecycle: {
      state: "failed",
      executionId: "agent:child-1",
      revision: 4,
      sequence: 4,
      error: "model failed",
    },
  });
  assert.equal(failed.state, "processing_failed");
  assert.deepEqual(failed.failure, { code: "CHILD_EXECUTION_FAILED", message: "model failed" });
});

test("createDetachedSubSessionRunner requires userId and parentSessionId", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({ parentContext: { userId: "u1" } }),
    /sub-session runner requires userId and parentSessionId/,
  );
});

test("createDetachedSubSessionRunner aborts before execution when signal is already aborted", async () => {
  let runCalled = false;
  const controller = new AbortController();
  controller.abort();
  const { deps } = createDeps({
    sessionRunner: {
      async runSession() {
        runCalled = true;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({ parentContext: createParentContext(), abortSignal: controller.signal }),
    /bot plugin sub-session aborted/,
  );
  assert.equal(runCalled, false);
});

test("createDetachedSubSessionRunner falls back to empty userConfig when loading config fails", async () => {
  const { calls, deps } = createDeps({
    configService: {
      async loadUserConfig() {
        throw new Error("config unavailable");
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await runner({
    parentContext: createParentContext(),
    strategy: {
      sessionId: "sub1",
      relativeDir: "runtime/workflow/session/root/node-a",
      allowedRoot: "runtime/workflow/session",
    },
  });
  assert.deepEqual(calls.prepareRunConfigPayload.userConfig, {});
});

test("createScopedSubSessionEventListener injects child session coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    {
      userId: "u1",
      sessionId: "sub1",
      parentSessionId: "parent1",
      dialogProcessId: "dialog1",
      turnScopeId: "turn1",
    },
  );
  listener.onEvent({ type: "model_delta", data: { content: "x" } });
  assert.deepEqual(received[0].data, {
    content: "x",
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    dialogProcessId: "dialog1",
    turnScopeId: "turn1",
  });
});

test("createScopedSubSessionEventListener preserves explicit event coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    { userId: "fallback-user", sessionId: "fallback-session" },
  );
  listener.onEvent({
    type: "model_delta",
    data: {
      userId: "u2",
      sessionId: "sub2",
      parentSessionId: "parent2",
      dialogProcessId: "dialog2",
      turnScopeId: "turn2",
    },
  });
  assert.equal(received[0].data.userId, "u2");
  assert.equal(received[0].data.sessionId, "sub2");
});

test("createScopedSubSessionEventListener returns null without a listener", () => {
  assert.equal(createScopedSubSessionEventListener(null, { sessionId: "sub1" }), null);
});
