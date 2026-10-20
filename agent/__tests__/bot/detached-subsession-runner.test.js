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
import { readAuthorityOutbox } from "../../src/session/authority-outbox-store/outbox-journal.js";

import {
  createDetachedSubSessionRunner,
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "../../src/bot/session/detached-subsession-runner.js";
import {
  AGENT_DETACHED_SESSION_ROOT,
  createAgentDetachedSubSessionStrategy,
} from "../../src/bot/session/detached-subsession-strategy.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import {
  DETACHED_REQUEST_METADATA,
  createCompleteStrategy,
  createDeps,
  createParentExecutionScope,
} from "./detached-subsession-runner.test-helpers.js";
import { SESSION_CALLER, requireSessionCaller } from "@noobot/shared/session-caller";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

test("detached sub-session delegates execution and persistence to the main runner", async () => {
  const { calls, deps } = createDeps();
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);
  const result = await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({ runConfig: { runtimeModel: "gpt_5_4" } }),
    message: "hello",
    attachments: [{ name: "a.txt" }],
    systemMessageFactory: () => ["system"],
    runConfigPatch: { turnScopeId: "turn-1", extra: true },
    eventListener: {
      onEvent: (event) => events.push(event),
      forwardEvent: (event) => events.push(event),
    },
    strategy: {
      userId: "u1",
      sessionId: "sub1",
      parentSessionId: "parent1",
      parentDialogProcessId: "parent-dialog",
      dialogProcessId: "sub-dialog",
      turnScopeId: "turn-1",
      executionId: "agent:turn-1",
      parentExecutionId: "workflow:root",
      rootExecutionId: "workflow:root",
      disabledPlugins: ["workflow"],
      relativeDir: "runtime/plugin-data/workflow/session/root/node-a",
      allowedRoot: "runtime/plugin-data/workflow/session",
    },
    metadata: { scope: "workflow_node", nodeId: "n1" },
  });

  assert.equal(calls.runSessionPayloads.length, 1);
  const payload = calls.runSessionPayloads[0];
  assert.equal(payload.userId, "u1");
  assert.equal(payload.sessionId, "sub1");
  assert.equal(payload.parentSessionId, "parent1");
  assert.equal(payload.parentDialogProcessId, "parent-dialog");
  assert.equal(payload.caller, SESSION_CALLER.BOT);
  assert.equal(payload.message, "hello");
  assert.deepEqual(payload.attachments, [{ name: "a.txt" }]);
  assert.deepEqual(payload.systemMessages, ["system"]);
  assert.equal(payload.turnScopeId, "turn-1");
  assert.equal(payload.runConfig.stage, "workflow_node");
  assert.deepEqual(payload.runConfig.origin, {});
  assert.equal(
    calls.lifecyclePayloads.every(
      (item) =>
        item.stage === payload.runConfig.stage &&
        JSON.stringify(item.origin) === JSON.stringify(payload.runConfig.origin),
    ),
    true,
  );
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
  assert.equal(Object.hasOwn(payload, "persistenceContext"), false);
  assert.deepEqual(payload.persistenceScope, {
    scopeId: "agent:turn-1",
    parentSessionId: "parent1",
    relativeDir: "runtime/plugin-data/workflow/session/root/node-a",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });

  assert.equal(calls.metadataWrites.length, 1);
  const [metadataWrite] = calls.metadataWrites;
  assert.equal(metadataWrite.userId, "u1");
  assert.equal(metadataWrite.sessionId, "sub1");
  assert.equal(metadataWrite.persistenceScope, payload.persistenceScope);
  const { metadata } = metadataWrite;
  assert.equal(metadata.scope, "workflow_node");
  assert.equal(metadata.nodeId, "n1");
  assert.equal(metadata.sessionId, "sub1");
  assert.equal(metadata.runtimePluginState.scope, "detached_sub_session");
  assert.equal(
    events.some((event) => event?.data?.sessionId === "sub1" && !event?.data?.envelope),
    false,
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
    relativeDir: "runtime/plugin-data/workflow/session/root/node-a",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });
  const finalizeRequest = calls.lifecyclePayloads.at(-2);
  assert.equal(finalizeRequest.eventType, "turn.processing_completed");
  assert.equal(finalizeRequest.completionCommitId, "turn-1:turn.completed");
  assert.equal(completedLifecycle.commandId, finalizeRequest.completionCommitId);
  assert.equal(Object.hasOwn(completedLifecycle, "completionCommitId"), false);
  assert.deepEqual(completedLifecycle.terminalStatus, { command: "completed" });

  assert.equal(result.sessionId, "sub1");
  assert.equal(result.parentSessionId, "parent1");
  assert.equal(result.dialogProcessId, payload.dialogProcessId);
  assert.equal(result.dialogProcessId, "sub-dialog");
  assert.equal(
    calls.lifecyclePayloads.every((item) => item.dialogProcessId === result.dialogProcessId),
    true,
  );
  assert.equal("persisted" in result, false);
  assert.equal(result.lifecycle.executionState, "completed");
  assert.equal(result.result.answer, "agent answer");
  assert.deepEqual(result.result.messages, [{ role: "assistant", content: "agent answer" }]);
  assert.deepEqual(result.result.turnTasks, [{ taskId: "t1" }]);
});

test("detached sub-session projects finalizer messages and their transfer envelopes", async () => {
  const { deps } = createDeps();
  const envelope = { transferId: "tr-1", kind: "file" };
  const messages = [
    { role: "assistant", content: "done", transferEnvelopes: [envelope] },
    { role: "tool", content: "dup", transferEnvelopes: [envelope] },
  ];
  const baseRunSession = deps.sessionRunner.runSession;
  deps.sessionRunner.runSession = async (payload) => ({
    ...(await baseRunSession(payload)),
    answer: "final answer",
    messages,
  });
  const runner = createDetachedSubSessionRunner(deps);

  const result = await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope(),
    message: "hello",
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
  });

  assert.equal(result.result.answer, "final answer");
  assert.deepEqual(result.result.messages, messages);
  assert.deepEqual(result.result.transferEnvelopes, [envelope]);
});

test("detached sub-session uses the selected parent model over the parent runtime model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({
      runConfig: { selectedModel: "gpt_5_4", runtimeModel: "parent_override" },
    }),
    message: "hello",
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
  });

  assert.equal(calls.runSessionPayloads[0].runConfig.runtimeModel, "gpt_5_4");
});

test("detached sub-session explicit model override wins over the selected parent model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({ runConfig: { selectedModel: "gpt_5_4" } }),
    message: "hello",
    runConfigPatch: { runtimeModel: "child_model" },
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
  });

  assert.equal(calls.runSessionPayloads[0].runConfig.runtimeModel, "child_model");
});

test("detached sub-session empty model override preserves the selected parent model", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({ runConfig: { selectedModel: "gpt_5_4" } }),
    message: "hello",
    runConfigPatch: { runtimeModel: "  " },
    metadata: DETACHED_REQUEST_METADATA,
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
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope(),
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
    systemMessageFactory: ({ attachments }) => [
      JSON.stringify(
        attachments.map(({ attachmentId, sessionId, attachmentSource }) => ({
          attachmentId,
          sessionId,
          attachmentSource,
        })),
      ),
    ],
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
  });

  assert.deepEqual(calls.runSessionPayloads[0].attachments, [transferred]);
  assert.deepEqual(calls.runSessionPayloads[0].systemMessages, [
    '[{"attachmentId":"child-attachment","sessionId":"sub1","attachmentSource":"user"}]',
  ]);
});

test("detached sub-session rejects an incomplete persistence and identity strategy", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    runner({
      abortSignal: new AbortController().signal,
      parentExecutionScope: createParentExecutionScope(),
      message: "hello",
      strategy: {
        userId: "u1",
        parentSessionId: "parent1",
      },
    }),
    /detached sub-session strategy requires sessionId, dialogProcessId, turnScopeId, executionId, rootExecutionId, relativeDir, allowedRoot/,
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
    const services = createTestSessionServices({ workspaceRoot });
    const persistenceContext = services.createSessionPersistenceContext({
      userId: strategy.userId,
      sessionId: strategy.sessionId,
      persistenceScope: createSessionPersistenceScope({
        scopeId: strategy.executionId,
        parentSessionId: strategy.parentSessionId,
        relativeDir: strategy.relativeDir,
        allowedRoot: strategy.allowedRoot,
      }),
    });
    const scope = await persistenceContext.locationResolver.locateSessionScope(
      strategy.userId,
      strategy.sessionId,
    );

    assert.equal(strategy.allowedRoot, AGENT_DETACHED_SESSION_ROOT);
    assert.equal(strategy.rootExecutionId, strategy.executionId);
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
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-detached-outbox-"));
  const repo = {
    scope: { resolvedParentSessionId: "parent1", sessionDir, indexed: false, registered: true },
    async withSessionMutation(_userId, _sessionId, operation) {
      return operation(this.scope);
    },
    async withSessionPlacementMutation(_userId, _placement, operation) {
      return operation(this.scope);
    },
    createInitialSession({ sessionId, parentSessionId, caller }) {
      return normalizeSessionEntity(
        {
          ...createTestSessionRequiredFields(),
          caller: requireSessionCaller(caller),
          sessionId,
          parentSessionId,
          aggregateVersion: 0,
          messages: [],
        },
        { now: fixedNow },
      );
    },
    async isSessionDeleted() {
      return false;
    },
    async findById() {
      return persisted
        ? normalizeSessionEntity(structuredClone(persisted), { now: fixedNow })
        : null;
    },
    async save(_userId, next, { expectedAggregateVersion, createOnly } = {}) {
      if (createOnly) assert.equal(persisted, null);
      else assert.equal(expectedAggregateVersion, Number(persisted?.aggregateVersion ?? 0));
      next.aggregateVersion = Number(persisted?.aggregateVersion ?? 0) + 1;
      persisted = structuredClone(normalizeSessionEntity(next, { now: fixedNow }));
    },
  };
  const messageService = new SessionMessageService({ sessionRepo: repo, now: fixedNow });
  const { deps } = createDeps({
    session: {
      async appendExecutionLog() {},
      applyTurnLifecycleEvent: (payload) => messageService.applyTurnLifecycleEvent(payload),
      async writeSessionMetadata() {},
    },
  });

  await createDetachedSubSessionRunner({ ...deps, now: fixedNow })({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope(),
    message: "hello",
    runConfigPatch: { turnScopeId: "turn-persisted" },
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy({
      sessionId: "sub-persisted",
      turnScopeId: "turn-persisted",
      executionId: "agent:turn-persisted",
    }),
  });

  const outbox = await readAuthorityOutbox(sessionDir);
  assert.deepEqual(
    outbox.map((entry) => entry.envelope.payload.eventType),
    [
      "turn.action_accepted",
      "turn.processing_started",
      "turn.processing_completed",
      "turn.completed",
    ],
  );
  assert.equal(persisted.caller, SESSION_CALLER.BOT);
  assert.equal(persisted.turnLifecycle.turns["turn-persisted"].state, "completed");
  assert.equal(
    outbox[3].envelope.payload.summaryVersion,
    persisted.turnLifecycle.turns["turn-persisted"].summaryVersion,
  );
  assert.equal(outbox[3].envelope.payload.completionCommitId, "turn-persisted:turn.completed");
});

test("detached sub-session rejects a runner result with a second dialog identity", async () => {
  const { calls, deps } = createDeps({
    sessionRunner: {
      async runSession() {
        return { answer: "done", dialogProcessId: "foreign-dialog" };
      },
    },
  });
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    runner({
      abortSignal: new AbortController().signal,
      parentExecutionScope: createParentExecutionScope(),
      message: "hello",
      metadata: DETACHED_REQUEST_METADATA,
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
  const childFacts = calls.executionLogs.filter(
    (record) => record.persistenceScope === calls.lifecyclePayloads[0].persistenceScope,
  );
  assert.equal(childFacts.length, calls.executionLogs.length);
  assert.equal(
    childFacts.some((record) => record.event === "detached_sub_session_identity_mismatch"),
    true,
  );
  assert.equal(
    childFacts.some(
      (record) =>
        record.event === "detached_sub_session_failure_committed" &&
        record.data?.errorCode === "DETACHED_DIALOG_IDENTITY_MISMATCH" &&
        record.data?.revision > 0,
    ),
    true,
  );
  assert.equal(
    events.some((event) => String(event?.event || "").startsWith("detached_sub_session_")),
    false,
  );
  assert.equal(calls.lifecyclePayloads.at(-1)?.eventType, "turn.failed");
  assert.equal(calls.lifecyclePayloads.at(-1)?.failure?.code, "DETACHED_DIALOG_IDENTITY_MISMATCH");
});

test("detached sub-session does not inherit parent turn transaction identity", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({
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
    metadata: DETACHED_REQUEST_METADATA,
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
  assert.equal(runConfig.commandId, "child-turn");
  assert.notEqual(runConfig.commandId, "root-continue-command");
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

test("detached sub-session derives commandId from the strategy turnScopeId and takes other child-owned fields from its patch", async () => {
  const { calls, deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope({
      runConfig: { expectedAggregateVersion: 7, commandId: "root-command" },
    }),
    runConfigPatch: {
      turnScopeId: "child-turn",
      expectedAggregateVersion: 0,
      thinkingStartedAt: "2026-07-26T12:30:00.000Z",
    },
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy({
      turnScopeId: "child-turn",
      executionId: "agent:child-turn",
    }),
  });

  const runConfig = calls.runSessionPayloads[0].runConfig;
  assert.equal(runConfig.expectedAggregateVersion, 0);
  assert.equal(runConfig.commandId, "child-turn");
  assert.equal(calls.lifecyclePayloads.at(-1)?.commandId, "child-turn:turn.completed");
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
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        eventListener: {
          onEvent: (event) => events.push(event),
          forwardEvent: (event) => events.push(event),
        },
        metadata: DETACHED_REQUEST_METADATA,
        strategy: createCompleteStrategy({
          turnScopeId: "internal-turn:abort-test",
          executionId: "agent:internal-turn:abort-test",
        }),
      }),
    (error) => error?.cause === abortError && error?.lifecycle?.state === "stop_completed",
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
  const stopFinalizeRequest = calls.lifecyclePayloads.at(-2);
  assert.equal(
    stopFinalizeRequest.completionCommitId,
    `${stoppedLifecycle.turnScopeId}:turn.stop_completed`,
  );
  assert.equal(stoppedLifecycle.commandId, stopFinalizeRequest.completionCommitId);
  assert.equal(Object.hasOwn(stoppedLifecycle, "completionCommitId"), false);
  assert.deepEqual(stoppedLifecycle.terminalStatus, { command: "user_stopped" });
  assert.equal(Object.hasOwn(abortError, "lifecycle"), false);
  assert.equal(
    calls.executionLogs.some(
      (record) =>
        record.event === "detached_sub_session_stop_committed" &&
        record.sessionId === "sub1" &&
        record.persistenceScope === calls.lifecyclePayloads[0].persistenceScope &&
        record.data?.reason === "user_stop" &&
        record.data?.state === "stop_completed",
    ),
    true,
  );
  assert.equal(
    calls.executionLogs.some((record) => record.event === "detached_sub_session_failure_committed"),
    false,
  );
  assert.equal(
    events.some((event) => String(event?.event || "").startsWith("detached_sub_session_")),
    false,
  );
});

test("detached sub-session failure receipt carries the committed turn failure", async () => {
  const failureError = Object.assign(new Error("model failed"), { code: "model_failed" });
  const { deps } = createDeps({
    sessionRunner: {
      async runSession() {
        throw failureError;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        metadata: DETACHED_REQUEST_METADATA,
        strategy: createCompleteStrategy(),
      }),
    (error) => {
      assert.equal(error.lifecycle.state, "processing_failed");
      assert.equal(error.lifecycle.phase, "processing");
      assert.deepEqual(error.lifecycle.failure, {
        code: "model_failed",
        message: "model failed",
        retryable: false,
      });
      return true;
    },
  );
});

test("detached terminal receipt projects the committed turn unchanged", () => {
  const failure = { phase: "processing", code: "model_failed", message: "model failed" };
  const turn = {
    state: "processing_failed",
    executionId: "agent:child-1",
    revision: 4,
    sequence: 4,
    failure,
  };
  assert.deepEqual(createDetachedTerminalReceipt(turn), { ...turn, executionKind: "agent" });
  assert.throws(() => createDetachedTerminalReceipt(undefined), /requires the committed turn/);
});

test("createDetachedSubSessionRunner requires userId and parentSessionId", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        strategy: { userId: "u1" },
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
        abortSignal: controller.signal,
      }),
    /execution_aborted/,
  );
  assert.equal(runCalled, false);
});

test("createDetachedSubSessionRunner propagates user config loading failures", async () => {
  const { deps } = createDeps({
    configService: {
      async loadUserConfig() {
        throw new Error("config unavailable");
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        metadata: DETACHED_REQUEST_METADATA,
        strategy: createCompleteStrategy(),
      }),
    /config unavailable/,
  );
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
  assert.deepEqual(received[0].data, { content: "x" });
  assert.deepEqual(received[0].route, {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    dialogProcessId: "dialog1",
    turnScopeId: "turn1",
  });
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

test("createScopedSubSessionEventListener rejects non-object events", () => {
  const listener = createScopedSubSessionEventListener(
    { onEvent() {}, forwardEvent() {} },
    { sessionId: "sub1" },
  );
  assert.throws(() => listener.onEvent(null), /must be an object/);
});
