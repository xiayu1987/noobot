/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionPersistenceScope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import {
  AGENT_SCOPED_SESSION_ROOTS,
  resolvePluginDataRelativePath,
} from "@noobot/workspace-protocol";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGE_EVENT_TYPE, MESSAGE_RUNTIME_PRODUCER } from "@noobot/event-protocol/message-event";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";
import { createAcceptedAgentExecution } from "../../agent/__tests__/helpers/accepted-run-identity.js";
import { createTestRuntimeContext } from "../../agent/__tests__/helpers/test-runtime-context.js";
import { canonicalActivity } from "../../agent/__tests__/session/session-repository-boundary.summaries.fixtures.js";
import { SessionTurnPersister } from "../../agent/src/bot/execution/turn-persister.js";
import { commitSummaryCheckpoint } from "../../agent/src/bot/session/summary-checkpoint-committer.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("the summary committer acknowledges partition writes and already-persisted summary targets", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const accepted = await bot.session.applyTurnLifecycleEvent(first);
  const checkpointIdentity = {
    ...identity,
    dialogProcessId: accepted.dialogProcessId,
    turnScopeId: first.turnScopeId,
  };
  const runtime = createTestRuntimeContext({
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  });
  const assistant = {
    ...checkpointIdentity,
    messageUid: "summary-assistant",
    role: "assistant",
    type: "message",
    content: "summarize this reply",
    modelMessageId: "summary-model-message",
    presentationMessageId: first.presentationMessageId,
    attachments: [],
    transferEnvelopes: [],
  };
  runtime.currentTurnMessages.replaceAll([assistant]);
  const commit = (messageUid) =>
    commitSummaryCheckpoint({
      ...checkpointIdentity,
      session: bot.session,
      turnPersister: { prepareAgentMessages: ({ messages }) => messages },
      runtime,
      summaryCompletion: createSummaryCheckpointInstruction({
        source: "plugin.summary",
        summarizedMessageUids: [messageUid],
      }),
    });
  assert.deepEqual(await commit(assistant.messageUid), {
    committed: true,
    persistedCount: 1,
    markedCount: 1,
  });
  assert.deepEqual(await commit(accepted.userMessage.messageUid), {
    committed: true,
    persistedCount: 0,
    markedCount: 1,
  });
  assert.equal(runtime.summaryCheckpointRevision, 2);
  assert.deepEqual(runtime.currentTurnMessages.readPendingChanges().entries, []);
});

test("partition Bot persists and replays message timeline events without indexing them as artifacts", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const accepted = await bot.session.applyTurnLifecycleEvent(first);
  const version = await bot.session.readSessionAggregateVersion(identity);
  const { envelope } = await bot.session.commitMessageEvent({
    ...identity,
    turnScopeId: first.turnScopeId,
    executionId: first.executionId,
    commandId: first.commandId,
    correlationId: first.turnScopeId,
    producer: MESSAGE_RUNTIME_PRODUCER,
    payload: {
      eventType: MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED,
      presentationMessageId: first.presentationMessageId,
      dialogProcessId: accepted.dialogProcessId,
      parentSessionId: "",
      presentation: {
        userMessage: accepted.userMessage,
        assistantMessage: {
          role: "assistant",
          sessionId: first.sessionId,
          turnScopeId: first.turnScopeId,
          presentationMessageId: first.presentationMessageId,
          content: "",
          attachments: [],
        },
      },
    },
  });
  assert.equal(envelope.ordering.sequence, 1);

  const { bot: restarted } = await service.rebuildRuntimeConfig();
  assert.equal(await restarted.session.readSessionAggregateVersion(identity), version);
  const { events } = await restarted.session.getPendingAuthorityEvents({
    ...identity,
    consumerId: "service.websocket",
  });
  assert.deepEqual(
    events.find((item) => item.eventId === envelope.identity.eventId)?.envelope,
    envelope,
  );
  const { sessions } = await restarted.session.getSessionDisplayData(identity);
  assert.deepEqual(sessions[0].sessionArtifactEvents, []);
});

test("session detail restores a turn's complete event count and both file mutation references", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const { dialogProcessId } = await bot.session.applyTurnLifecycleEvent(first);
  const turn = {
    ...identity,
    dialogProcessId,
    turnScopeId: first.turnScopeId,
    presentationMessageId: first.presentationMessageId,
  };
  const ts = "2026-11-20T00:00:00.000Z";
  const tools = ["write_file", "patch_file", "read_file"];
  const path = { view: "workspace", path: "example.txt" };
  const mutations = ["create", "update"].map((operation) => ({
    mutationId: `mutation-${operation}`,
    operation,
    revision: 1,
    locator: path,
    fileName: "example.txt",
    beforeSha256: operation === "create" ? null : "before",
    afterSha256: "after",
    size: 3,
    additions: 1,
    deletions: 0,
    snapshot: "available",
  }));
  const toolTimeline = Array.from({ length: 6 }, (_, index) => {
    const tool = tools[Math.min(index, tools.length - 1)];
    const toolCallId = `tool-${index}`;
    return {
      key: `call:${toolCallId}`,
      toolCallId,
      tool,
      status: "completed",
      success: true,
      args: { filePath: "example.txt" },
      result: JSON.stringify(
        tool === "patch_file" ? { ok: true, changes: [{ path }] } : { ok: true, path },
      ),
      call: { eventId: `start-${index}`, sequence: index * 2 + 1 },
      resultEvent: {
        eventId: `result-${index}`,
        sequence: index * 2 + 2,
        ...(index === 0 ? { mutationRefs: [mutations[0]] } : {}),
      },
    };
  });
  const assistant = {
    ...turn,
    role: "assistant",
    type: "message",
    messageUid: "assistant-with-timeline",
    modelMessageId: "model-with-timeline",
    chatPresentation: true,
    content: "Files ready",
    activityTimeline: [canonicalActivity(turn)],
    toolTimeline,
    ts,
  };
  const patchResult = {
    ...turn,
    role: "tool",
    type: "tool_result",
    messageUid: "patch-result",
    tool_call_id: toolTimeline[1].toolCallId,
    toolName: "patch_file",
    content: toolTimeline[1].result,
    mutationRefs: [mutations[1]],
    ts,
  };
  const messages = [assistant, patchResult];
  const persister = new SessionTurnPersister({ session: bot.session, now: () => ts });
  await persister.appendAgentMessages({
    ...turn,
    messages,
    changes: { messages, messageContentAppends: [], messageMetadataUpdates: [] },
  });

  const { bot: restarted } = await service.rebuildRuntimeConfig();
  const { sessions } = await restarted.session.getSessionDisplayData(identity);
  const restored = sessions[0].messages.find(({ role }) => role === "assistant");
  assert.equal(restored.hasThinkingDetails, true);
  assert.equal(countCanonicalThinkingDetailEvents(restored), 13);
  assert.equal(restored.toolTimeline[1].resultEvent.eventId, "result-1");
  assert.equal(restored.toolTimeline[1].resultEvent.sequence, 4);
  assert.deepEqual(
    restored.toolTimeline
      .slice(0, 2)
      .map(({ tool, resultEvent }) => [tool, resultEvent.mutationRefs[0].mutationId]),
    [
      ["write_file", "mutation-create"],
      ["patch_file", "mutation-update"],
    ],
  );
});

test("execution reads observe lifecycle-only partition commits without metadata changes", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const accepted = await bot.session.applyTurnLifecycleEvent(first);
  const query = { userId: identity.userId, executionId: first.executionId };
  const initial = await bot.session.getExecution(query);
  assert.equal(initial.execution.state, TURN_STATE.ACTION_REQUESTING);
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const { userId, sessionId } = identity;
  const persistenceContext = bot.sessionRuntime.createSessionPersistenceContext(identity);
  const open = () => repo.requireSessionReader(userId, sessionId, { persistenceContext });
  await using before = await open();
  const started = await bot.session.applyTurnLifecycleEvent({
    ...identity,
    turnScopeId: first.turnScopeId,
    dialogProcessId: accepted.dialogProcessId,
    presentationMessageId: first.presentationMessageId,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    commandId: "processing-started",
    causationId: "processing-started",
    expectedRevision: accepted.turn.revision,
    phase: TURN_PHASE.PROCESSING,
  });
  assert.equal(started.applied, true);
  await using after = await open();
  assert.ok(after.generation > before.generation);
  assert.deepEqual(await after.readMetadata(), await before.readMetadata());
  const persisted = await after.readTurnState(first.turnScopeId);
  assert.equal(persisted.state, TURN_STATE.PROCESSING);
  const oldSource = await before.readExecutionSource();
  assert.deepEqual(
    oldSource.turns.map(({ state }) => state),
    [TURN_STATE.ACTION_REQUESTING],
  );
  const refreshed = await bot.session.getExecution(query);
  assert.equal(refreshed.execution.state, persisted.state);
  assert.equal(refreshed.execution.revision, persisted.revision);
});

test("execution queries traverse multiple sessions and release leases with one resident journal", async (t) => {
  const { service, budget } = await createPartitionBotFixture(t, {
    pluginRootDir: fileURLToPath(new URL("../../plugin/", import.meta.url)),
  });
  assert.equal(budget.maxJournals, 1);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const otherIdentity = { ...identity, sessionId: "other-session" };
  const turnScopeId = "other-turn";
  const other = {
    ...firstSend(otherIdentity),
    ...createAcceptedAgentExecution(turnScopeId, otherIdentity.sessionId),
    turnScopeId,
  };
  const allowedRoot = resolvePluginDataRelativePath("workflow", "session");
  const childIdentity = { ...identity, sessionId: "workflow-child" };
  const childScope = "workflow-child-turn";
  const child = {
    ...firstSend(childIdentity),
    ...createAcceptedAgentExecution(childScope, childIdentity.sessionId),
    turnScopeId: childScope,
    parentSessionId: first.sessionId,
    parentExecutionId: first.executionId,
    rootExecutionId: first.executionId,
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:workflow:workflow-child",
      parentSessionId: first.sessionId,
      allowedRoot,
      relativeDir: `${allowedRoot}/workflow-child`,
    }),
  };
  assert.equal((await bot.session.applyTurnLifecycleEvent(first)).applied, true);
  assert.equal((await bot.session.applyTurnLifecycleEvent(other)).applied, true);
  assert.equal((await bot.session.applyTurnLifecycleEvent(child)).applied, true);
  for (const event of [first, other, child, first]) {
    const result = await bot.session.getExecution({
      userId: event.userId,
      executionId: event.executionId,
    });
    assert.equal(result.found, true);
    assert.equal(result.execution.sessionId, event.sessionId);
    assert.equal(Object.hasOwn(result, "unreadableSessions"), false);
  }
  const selection = { userId: first.userId, executionId: first.executionId };
  const children = await bot.session.getExecutionChildren(selection);
  assert.deepEqual(
    children.children.map(({ executionId }) => executionId),
    [child.executionId],
  );
  const tree = await bot.session.getExecutionTree(selection);
  assert.deepEqual(Object.keys(tree.tree.executions), [first.executionId, child.executionId]);
});

for (const allowedRoot of [
  AGENT_SCOPED_SESSION_ROOTS[0],
  resolvePluginDataRelativePath("workflow", "session"),
]) {
  test(`execution discovery excludes recorded deletion directories before reading authority: ${allowedRoot}`, async (t) => {
    const { service, workspaceRoot } = await createPartitionBotFixture(t, {
      pluginRootDir: fileURLToPath(new URL("../../plugin/", import.meta.url)),
    });
    const { bot } = await service.rebuildRuntimeConfig();
    const first = firstSend();
    const sessionId = "deleted-child";
    const relativeDir = `${allowedRoot}/physical-node`;
    const child = {
      ...firstSend({ ...identity, sessionId }),
      ...createAcceptedAgentExecution("child-turn", sessionId),
      turnScopeId: "child-turn",
      parentSessionId: first.sessionId,
      parentExecutionId: first.executionId,
      rootExecutionId: first.executionId,
      persistenceScope: createSessionPersistenceScope({
        scopeId: "agent:workflow:deleted-child",
        parentSessionId: first.sessionId,
        allowedRoot,
        relativeDir:
          allowedRoot === AGENT_SCOPED_SESSION_ROOTS[0]
            ? `${allowedRoot}/${sessionId}`
            : relativeDir,
      }),
    };
    assert.equal((await bot.session.applyTurnLifecycleEvent(first)).applied, true);
    assert.equal((await bot.session.applyTurnLifecycleEvent(child)).applied, true);
    await bot.close();
    const directory = child.persistenceScope.relativeDir.split("/");
    await writeFile(join(workspaceRoot, identity.userId, ...directory, "CURRENT"), "broken head");
    const { bot: restarted } = await service.rebuildRuntimeConfig();
    const selection = { userId: identity.userId, executionId: first.executionId };
    const incomplete = await restarted.session.getExecution(selection);
    assert.equal(incomplete.reason, "execution_query_incomplete");
    assert.equal(incomplete.scopeDiscoveryFailure.code, "SESSION_STORAGE_CORRUPT");
    await restarted.sessionRuntime.repositories.sessionRepository.recordSessionBranchDeletion(
      identity.userId,
      sessionBranchDeletionKey([sessionId]),
      [{ sessionId, directory }],
      [],
    );
    const result = await restarted.session.getExecution(selection);
    assert.equal(result.found, true);
    assert.equal(result.execution.sessionId, first.sessionId);
    const children = await restarted.session.getExecutionChildren(selection);
    assert.equal(children.found, true);
    assert.deepEqual(children.children, []);
    const tree = await restarted.session.getExecutionTree(selection);
    assert.equal(tree.found, true);
    assert.deepEqual(Object.keys(tree.tree.executions), [first.executionId]);
    const deleted = await restarted.session.getExecution({
      userId: identity.userId,
      executionId: child.executionId,
    });
    assert.equal(deleted.found, false);
    assert.notEqual(deleted.reason, "execution_query_incomplete");
    const repo = restarted.sessionRuntime.repositories.sessionRepository;
    await repo.removeDeletedSessionDirectory(identity.userId, directory);
    await repo.advanceSessionBranchDeletion(
      identity.userId,
      sessionBranchDeletionKey([sessionId]),
      SESSION_DELETION_STAGE.DIRECTORIES,
    );
    if (allowedRoot === AGENT_SCOPED_SESSION_ROOTS[0]) return;
    const replacementId = "replacement-child";
    const replacement = {
      ...child,
      sessionId: replacementId,
      ...createAcceptedAgentExecution("replacement-turn", replacementId),
      turnScopeId: "replacement-turn",
      persistenceScope: createSessionPersistenceScope({
        scopeId: "agent:workflow:replacement-child",
        parentSessionId: first.sessionId,
        allowedRoot,
        relativeDir,
      }),
    };
    assert.equal((await restarted.session.applyTurnLifecycleEvent(replacement)).applied, true);
    const reused = await restarted.session.getExecution({
      userId: identity.userId,
      executionId: replacement.executionId,
    });
    assert.equal(reused.found, true);
    assert.equal(reused.execution.sessionId, replacementId);
    assert.deepEqual(
      (await restarted.session.getExecutionChildren(selection)).children.map(
        ({ sessionId }) => sessionId,
      ),
      [replacementId],
    );
  });
}
