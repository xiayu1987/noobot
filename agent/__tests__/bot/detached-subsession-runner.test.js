/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  createDetachedSubSessionRunner,
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "../../src/bot/session/detached-subsession-runner.js";
import {
  AGENT_DETACHED_SESSION_ROOT,
  createAgentDetachedSubSessionStrategy,
} from "../../src/bot/session/detached-subsession-strategy.js";
import { CALLER_ROLE } from "../../src/bot/config/constants.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createSessionServices } from "../../src/session/index.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

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
          session: { sessionId: payload.sessionId, aggregateVersion: 3 },
        };
      },
    },
    session: {
      async applyTurnLifecycleEvent(payload = {}) {
        calls.lifecyclePayloads.push(payload);
        const sequence = calls.lifecyclePayloads.length;
        const stateByEventType = {
          "turn.action_accepted": "action_accepted",
          "turn.processing_started": "processing",
          "turn.processing_completed": "processing_completed",
          "turn.completed": "completed",
          "turn.stop_accepted": "stop_accepted",
          "turn.stop_processing_completed": "stop_processing_completed",
          "turn.stop_completed": "stop_completed",
          "turn.failed": "processing_failed",
        };
        const turn = {
          ...payload,
          state: stateByEventType[payload.eventType] || "",
          sequence,
          revision: sequence,
        };
        return {
          applied: true,
          envelope: turn,
          turn,
        };
      },
      createScopedPersistenceContext(payload = {}) {
        calls.persistencePayloads.push(payload);
        return Object.freeze({
          locationResolver: { marker: payload.relativeDir },
          metadataContributor: payload.metadataContributor,
        });
      },
    },
    mergeRunConfigPluginPolicy(payload = {}) {
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
        selectedPlugins: ["harness", "workflow"],
        plugins: {
          harness: { enabled: true, mode: "on" },
          workflow: { enabled: true, mode: "on" },
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

function createParentExecutionScope(runtimePatch = {}) {
  return createTestAgentExecutionScope({
    userId: "u1",
    systemRuntime: {
      sessionId: "parent1",
      dialogProcessId: "parent-dialog",
      turnScopeId: "parent-turn",
    },
    ...runtimePatch,
  });
}

function createCompleteStrategy(overrides = {}) {
  const turnScopeId = String(overrides.turnScopeId || "turn-1").trim();
  return {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    parentDialogProcessId: "parent-dialog",
    dialogProcessId: "sub-dialog",
    turnScopeId,
    executionId: `agent:${turnScopeId}`,
    relativeDir: "runtime/workflow/session/root/node-a",
    allowedRoot: "runtime/workflow/session",
    ...overrides,
  };
}

test("detached sub-session delegates execution and persistence to the main runner", async () => {
  const { calls, deps } = createDeps();
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);
  const result = await runner({
    parentExecutionScope: createParentExecutionScope({ runtimeModel: "gpt_5_4" }),
    parentContext: createParentContext(),
    message: "hello",
    attachments: [{ name: "a.txt" }],
    systemMessages: ["system"],
    runConfigPatch: { turnScopeId: "turn-1", extra: true },
    eventListener: {
      onEvent: (event) => events.push(event),
      forwardEvent: (event) => events.push(event),
    },
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
  assert.equal(payload.runConfig.runtimeModel, "gpt_5_4");
  assert.equal(payload.runConfig.systemRuntimePatch, undefined);
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
  assert.equal(
    events.some((event) => event?.event === "plugin_runtime_resolved"),
    true,
  );
  assert.deepEqual(
    calls.lifecyclePayloads.map((payload) => payload.eventType),
    [
      "turn.action_accepted",
      "turn.processing_started",
      "turn.processing_completed",
      "turn.completed",
    ],
  );
  assert.equal(events.filter((event) => event?.event === "turn_lifecycle_committed").length, 4);
  assert.equal(
    events
      .filter((event) => event?.event === "turn_lifecycle_committed")
      .every(
        (event) =>
          event.data.persistenceContext === undefined && event.data.envelope.persistenceScope,
      ),
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
  assert.equal(
    calls.lifecyclePayloads.every((item) => item.dialogProcessId === result.dialogProcessId),
    true,
  );
  assert.equal(result.persisted.aggregateVersion, 3);
  assert.equal(result.lifecycle.executionState, "completed");
  assert.equal(result.result.answer, "agent answer");
  assert.deepEqual(result.result.messages, [{ role: "assistant", content: "agent answer" }]);
  assert.deepEqual(result.result.turnTasks, [{ taskId: "t1" }]);
});

test("detached sub-session uses the selected parent model over a stale runtime model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope({ runtimeModel: "stale_model" }),
    parentContext: createParentContext({
      runConfig: { selectedModel: { value: "gpt_5_4" }, runtimeModel: "parent_override" },
    }),
    message: "hello",
    strategy: createCompleteStrategy(),
  });

  assert.equal(calls.runSessionPayloads[0].runConfig.runtimeModel, "gpt_5_4");
});

test("detached sub-session explicit model override wins over the selected parent model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope({ runtimeModel: "stale_model" }),
    parentContext: createParentContext({ runConfig: { selectedModel: "gpt_5_4" } }),
    message: "hello",
    runConfigPatch: { runtimeModel: "child_model" },
    strategy: createCompleteStrategy(),
  });

  assert.equal(calls.runSessionPayloads[0].runConfig.runtimeModel, "child_model");
});

test("detached sub-session empty model override preserves the selected parent model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope({ runtimeModel: "stale_model" }),
    parentContext: createParentContext({ runConfig: { selectedModel: "gpt_5_4" } }),
    message: "hello",
    runConfigPatch: { runtimeModel: "  " },
    strategy: createCompleteStrategy(),
  });

  assert.equal(calls.runSessionPayloads[0].runConfig.runtimeModel, "gpt_5_4");
});

test("detached sub-session transfers canonical parent attachments into child ownership", async () => {
  const transferred = {
    attachmentId: "child-attachment",
    sessionId: "sub1",
    attachmentSource: "user",
    path: "/tmp/workspace/u1/runtime/attach/user/sub1/child-attachment.txt",
    name: "a.txt",
    mimeType: "text/plain",
  };
  const attachmentService = {
    async getAttachmentById(payload) {
      assert.deepEqual(payload, {
        userId: "u1",
        attachmentId: "parent-attachment",
        sessionId: "parent1",
        attachmentSource: "user",
      });
      return {
        attachmentId: "parent-attachment",
        sessionId: "parent1",
        attachmentSource: "user",
        path: "/tmp/workspace/u1/runtime/attach/user/parent1/parent-attachment.txt",
        name: "a.txt",
        mimeType: "text/plain",
      };
    },
    async readAttachmentContent(payload) {
      assert.deepEqual(payload, {
        userId: "u1",
        attachmentId: "parent-attachment",
        sessionId: "parent1",
        attachmentSource: "user",
      });
      return { content: Buffer.from("attachment body", "utf8") };
    },
    async ingest(payload) {
      assert.equal(payload.sessionId, "sub1");
      assert.equal(payload.attachments[0].clientAttachmentId, "session-transfer:parent-attachment");
      assert.equal(
        payload.attachments[0].contentBase64,
        Buffer.from("attachment body", "utf8").toString("base64"),
      );
      return [transferred];
    },
  };
  const { calls, deps } = createDeps({ attachmentService });
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope(),
    parentContext: createParentContext(),
    message: "read attachment",
    attachments: [
      {
        attachmentId: "parent-attachment",
        sessionId: "parent1",
        attachmentSource: "user",
        path: "/tmp/workspace/u1/runtime/attach/user/parent1/parent-attachment.txt",
        name: "a.txt",
        mimeType: "text/plain",
      },
    ],
    strategy: createCompleteStrategy(),
  });

  assert.deepEqual(calls.runSessionPayloads[0].attachments, [transferred]);
});

test("detached sub-session rejects an incomplete persistence and identity strategy", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    runner({
      parentExecutionScope: createParentExecutionScope(),
      parentContext: createParentContext(),
      message: "hello",
      strategy: {
        userId: "u1",
        parentSessionId: "parent1",
      },
    }),
    /detached sub-session strategy requires sessionId, dialogProcessId, turnScopeId, executionId, relativeDir and allowedRoot/,
  );
});

test("agent detached strategy resolves through the authoritative scoped persistence location", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-agent-detached-scope-"));
  try {
    const strategy = createAgentDetachedSubSessionStrategy({
      userId: "u1",
      parentSessionId: "parent1",
      parentDialogProcessId: "parent-dialog",
    });
    const services = createSessionServices({ workspaceRoot });
    const persistenceContext = services.createScopedPersistenceContext({
      userId: strategy.userId,
      sessionId: strategy.sessionId,
      parentSessionId: strategy.parentSessionId,
      scopeId: strategy.executionId,
      relativeDir: strategy.relativeDir,
      allowedRoot: strategy.allowedRoot,
    });
    const scope = await persistenceContext.locationResolver.resolveSessionScope(
      strategy.userId,
      strategy.sessionId,
      strategy.parentSessionId,
    );

    assert.equal(strategy.allowedRoot, AGENT_DETACHED_SESSION_ROOT);
    assert.equal(strategy.relativeDir, `${AGENT_DETACHED_SESSION_ROOT}/${strategy.sessionId}`);
    assert.equal(
      scope.sessionDir,
      path.join(workspaceRoot, "u1", AGENT_DETACHED_SESSION_ROOT, strategy.sessionId),
    );
    assert.equal(scope.resolvedParentSessionId, "parent1");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("detached sub-session persists its complete authoritative lifecycle outbox", async () => {
  let persisted = null;
  const fixedNow = () => "2026-07-30T12:53:35.738Z";
  const repo = {
    async withSessionMutation(_userId, _sessionId, _context, operation) {
      return operation();
    },
    async resolveParentSessionId() {
      return "parent1";
    },
    createInitialSession({ sessionId, parentSessionId }) {
      return normalizeSessionEntity(
        {
          sessionId,
          parentSessionId,
          aggregateVersion: 0,
          messages: [],
        },
        { now: fixedNow },
      );
    },
    async findById() {
      return persisted
        ? normalizeSessionEntity(structuredClone(persisted), { now: fixedNow })
        : null;
    },
    async save(_userId, next, _context, { expectedAggregateVersion, createOnly } = {}) {
      if (createOnly) assert.equal(persisted, null);
      else assert.equal(expectedAggregateVersion, Number(persisted?.aggregateVersion ?? 0));
      persisted = structuredClone(normalizeSessionEntity(next, { now: fixedNow }));
    },
    async writeSessionDisplaySummary() {},
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
    parentExecutionScope: createParentExecutionScope(),
    parentContext: createParentContext(),
    message: "hello",
    runConfigPatch: { turnScopeId: "turn-persisted" },
    strategy: createCompleteStrategy({
      sessionId: "sub-persisted",
      turnScopeId: "turn-persisted",
      executionId: "agent:turn-persisted",
    }),
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
      parentExecutionScope: createParentExecutionScope(),
      parentContext: createParentContext(),
      message: "hello",
      strategy: createCompleteStrategy({
        dialogProcessId: "authoritative-dialog",
        executionId: "agent:turn-identity-mismatch",
      }),
      eventListener: {
        onEvent: (event) => events.push(event),
        forwardEvent: (event) => events.push(event),
      },
    }),
    (error) =>
      error?.code === "DETACHED_DIALOG_IDENTITY_MISMATCH" &&
      error?.lifecycle?.state === "processing_failed" &&
      error?.lifecycle?.executionId === "agent:turn-identity-mismatch",
  );
  assert.equal(
    events.some((event) => event?.event === "detached_sub_session_identity_mismatch"),
    true,
  );
  assert.equal(
    events.some(
      (event) =>
        event?.event === "detached_sub_session_failure_committed" &&
        event?.data?.errorCode === "DETACHED_DIALOG_IDENTITY_MISMATCH" &&
        event?.data?.revision > 0,
    ),
    true,
  );
  assert.equal(calls.lifecyclePayloads.at(-1)?.eventType, "turn.failed");
  assert.equal(calls.lifecyclePayloads.at(-1)?.failure?.code, "DETACHED_DIALOG_IDENTITY_MISMATCH");
});

test("detached sub-session does not inherit parent turn transaction identity", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope(),
    parentContext: createParentContext({
      runConfig: {
        streaming: true,
        selectedPlugins: ["workflow"],
        resumeFromStoppedSnapshot: true,
        resumeDialogProcessId: "root-old-dialog",
        resumeTurnScopeId: "root-old-turn",
        expectedAggregateVersion: 7,
        commandId: "root-continue-command",
        reuseExistingUserTurn: true,
        thinkingStartedAt: "2026-07-26T12:00:00.000Z",
        messageId: "root-canonical-message",
        presentationMessageId: "root-presentation-message",
        assistantMessageId: "root-assistant-message",
      },
    }),
    runConfigPatch: {
      turnScopeId: "child-turn",
      workflowRunId: "workflow-run-1",
      workflowNodeExecutionId: "node-execution-1",
      messageId: "root-canonical-message-from-patch",
      presentationMessageId: "root-presentation-message-from-patch",
      assistantMessageId: "root-assistant-message-from-patch",
    },
    strategy: createCompleteStrategy({
      turnScopeId: "child-turn",
      executionId: "agent:child-turn",
    }),
  });

  const runConfig = calls.runSessionPayloads[0].runConfig;
  assert.equal(runConfig.resumeFromStoppedSnapshot, undefined);
  assert.equal(runConfig.resumeDialogProcessId, undefined);
  assert.equal(runConfig.resumeTurnScopeId, undefined);
  assert.equal(runConfig.expectedAggregateVersion, undefined);
  assert.equal(runConfig.commandId, undefined);
  assert.equal(runConfig.reuseExistingUserTurn, undefined);
  assert.equal(Number.isFinite(Date.parse(runConfig.thinkingStartedAt)), true);
  assert.notEqual(runConfig.thinkingStartedAt, "2026-07-26T12:00:00.000Z");
  assert.match(runConfig.presentationMessageId, /^msg_/);
  assert.notEqual(runConfig.presentationMessageId, "root-presentation-message");
  assert.notEqual(runConfig.presentationMessageId, "root-presentation-message-from-patch");
  assert.equal(runConfig.messageId, `msg_event_${runConfig.presentationMessageId}`);
  assert.notEqual(runConfig.messageId, "root-canonical-message");
  assert.notEqual(runConfig.messageId, "root-canonical-message-from-patch");
  assert.equal(runConfig.assistantMessageId, undefined);
  assert.equal(runConfig.streaming, true);
  assert.equal(runConfig.workflowRunId, "workflow-run-1");
  assert.equal(runConfig.workflowNodeExecutionId, "node-execution-1");
  assert.equal(runConfig.turnScopeId, "child-turn");
  assert.equal(runConfig.executionId, "agent:child-turn");
  assert.deepEqual(runConfig.selectedPlugins, ["harness", "workflow"]);
  assert.equal(calls.mergePayload.baseRunConfig.expectedAggregateVersion, undefined);
  assert.equal(calls.mergePayload.baseRunConfig.commandId, undefined);
});

test("detached sub-session preserves child-owned transaction fields from its patch", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentExecutionScope: createParentExecutionScope(),
    parentContext: createParentContext({
      runConfig: { expectedAggregateVersion: 7, commandId: "root-command" },
    }),
    runConfigPatch: {
      turnScopeId: "child-turn",
      expectedAggregateVersion: 0,
      commandId: "child-command",
      thinkingStartedAt: "2026-07-26T12:30:00.000Z",
    },
    strategy: createCompleteStrategy({
      turnScopeId: "child-turn",
      executionId: "agent:child-turn",
    }),
  });

  const runConfig = calls.runSessionPayloads[0].runConfig;
  assert.equal(runConfig.expectedAggregateVersion, 0);
  assert.equal(runConfig.commandId, "child-command");
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
  const events = [];
  await assert.rejects(
    () =>
      runner({
        parentExecutionScope: createParentExecutionScope(),
        parentContext: createParentContext(),
        eventListener: {
          onEvent: (event) => events.push(event),
          forwardEvent: (event) => events.push(event),
        },
        strategy: createCompleteStrategy({
          turnScopeId: "internal-turn:abort-test",
          executionId: "agent:internal-turn:abort-test",
        }),
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
  assert.match(stoppedLifecycle.turnScopeId, /^internal-turn:/);
  assert.equal(
    stoppedLifecycle.completionCommitId,
    `${stoppedLifecycle.turnScopeId}:stop-completed`,
  );
  assert.deepEqual(stoppedLifecycle.terminalStatus, {
    command: "user_stopped",
    description: "子 Agent 已停止",
  });
  assert.equal(abortError.lifecycle.state, "stop_completed");
  assert.equal(
    events.some(
      (event) =>
        event?.event === "detached_sub_session_stop_committed" &&
        event?.data?.reason === "user_stop" &&
        event?.data?.state === "stop_completed",
    ),
    true,
  );
  assert.equal(
    events.some((event) => event?.event === "detached_sub_session_failure_committed"),
    false,
  );
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
    () =>
      runner({
        parentExecutionScope: createParentExecutionScope(),
        parentContext: {
          userId: "u1",
        },
      }),
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
    () =>
      runner({
        parentExecutionScope: createParentExecutionScope(),
        parentContext: createParentContext(),
        abortSignal: controller.signal,
      }),
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
    parentExecutionScope: createParentExecutionScope(),
    parentContext: createParentContext(),
    strategy: createCompleteStrategy(),
  });
  assert.deepEqual(calls.prepareRunConfigPayload.userConfig, {});
});

test("createScopedSubSessionEventListener injects child session coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent() {}, forwardEvent: (event) => received.push(event) },
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
    { onEvent() {}, forwardEvent: (event) => received.push(event) },
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

test("createScopedSubSessionEventListener rejects a persistence-owning listener without a forwarding port", () => {
  assert.throws(
    () => createScopedSubSessionEventListener({ onEvent() {} }, { sessionId: "sub1" }),
    /forwardEvent port/,
  );
});
