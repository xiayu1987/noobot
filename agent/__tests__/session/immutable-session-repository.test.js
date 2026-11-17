/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createTurnArtifactRevision } from "@noobot/session-protocol/turn-lookup-key";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { migrateSessionImmutableStorage } from "../../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { createSessionFacade } from "../../src/session/index.js";
import { createPluginArtifactCommitRequest } from "@noobot/event-protocol/plugin-artifact-event";
import { createAuthorityEventDispatcher } from "../../../service/ws/chat-websocket/authority-event-dispatcher.js";
import {
  registerImmutableContextRepositoryTests,
  registerImmutableLifecycleRepositoryTests,
} from "../helpers/immutable-repository-cases.js";
import { registerImmutableAttachmentRepositoryTests } from "../helpers/immutable-repository-attachment-cases.js";
import { registerImmutableTurnIdentityTests } from "../helpers/immutable-repository-turn-identity-cases.js";

const ts = "2026-01-01T00:00:00.000Z";
const outboxIdentity = { userId: "u1", sessionId: "s1", persistenceScope: null };

registerImmutableTurnIdentityTests({ fixture, message, ts });

registerImmutableAttachmentRepositoryTests({ fixture, message, ts });

function artifactRequest(operation = "created", baseRevision = null) {
  return createPluginArtifactCommitRequest({
    pluginId: "example",
    artifactType: "document",
    artifactId: "one",
    sessionId: "s1",
    turnScopeId: "t1",
    data: { text: "result" },
    operation,
    baseRevision,
  });
}
function message(uid) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "user",
    type: "message",
    messageOrigin: "natural",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
  };
}
async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-repository-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => ts });
  const repository = runtime.repositories.sessionRepository;
  await provisionTestSession(runtime, {
    userId: "u1",
    sessionId: "s1",
    caller: SESSION_CALLER.USER,
  });
  const persistenceContext = repository.treePersistenceContext("u1", "s1");
  const scope = await repository.requireSessionScope("u1", "s1", persistenceContext);
  await migrateSessionImmutableStorage({
    storageService: repository.storageService,
    sessionDir: scope.sessionDir,
  });
  return { runtime, repository, persistenceContext, scope, workspaceRoot };
}

test("display reads use immutable authority without reading legacy artifacts", async (t) => {
  const { repository, scope, persistenceContext } = await fixture(t);
  const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  await repository.commitChanges("u1", "s1", {
    persistenceContext,
    expectedGeneration: reader.generation,
    operationId: "seed-display",
    committedAt: ts,
    changes: { messages: [message("display-message")] },
  });
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  await writeFile(path.join(scope.sessionDir, "session-summary.json"), "invalid legacy cache");
  const direct = await repository.readSessionDisplaySummary("u1", "s1", { persistenceContext });
  assert.equal(direct.messages[0].content, "display-message");
  await writeFile(path.join(scope.sessionDir, "head.json"), "invalid immutable head");
  await assert.rejects(repository.readSessionDisplaySummary("u1", "s1", { persistenceContext }));
});

test("production event submission, partial delivery and restart use only the immutable authority", async (t) => {
  const { runtime, repository, scope, workspaceRoot, persistenceContext } = await fixture(t);
  const session = createSessionFacade(runtime);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  repository.readSessionEventManifest = () => assert.fail("must not read old event manifest");
  repository.saveSessionArtifactEvents = () => assert.fail("must not save old event manifest");
  const first = await session.commitAuthorityEvent({ ...outboxIdentity, ...artifactRequest() });
  const second = await session.commitAuthorityEvent({
    ...outboxIdentity,
    ...artifactRequest("replaced", 1),
  });
  assert.equal(first.aggregateVersion, 1);
  assert.equal(second.aggregateVersion, 2);
  assert.equal(second.envelope.ordering.sequence, 2);
  assert.equal(
    (await session.commitAuthorityEvent({ ...outboxIdentity, ...artifactRequest("replaced", 1) }))
      .reason,
    "revision_conflict",
  );
  const bot = { session };
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      sent.push(envelope.identity.eventId);
      return sent.length !== 2;
    },
  });
  assert.deepEqual(await dispatch(outboxIdentity), {
    dispatched: false,
    reason: "authority_event_send_failed",
    delivered: 1,
  });
  assert.deepEqual(sent, [first.envelope.identity.eventId, second.envelope.identity.eventId]);
  const restarted = createTestSessionServices({ workspaceRoot }, { now: () => ts });
  const resumed = [];
  const retry = createAuthorityEventDispatcher({
    resolveBot: () => ({ session: createSessionFacade(restarted) }),
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      resumed.push(envelope.identity.eventId);
      return true;
    },
  });
  assert.deepEqual(await retry(outboxIdentity), { dispatched: true, delivered: 1 });
  assert.deepEqual(resumed, [second.envelope.identity.eventId]);
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const result = await session.compactAuthorityEvents({
    ...outboxIdentity,
    retainDeliveredAfter: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(result.removed, 2);
  assert.equal(result.scanned, 2);
  assert.equal(
    (await pinned.readOutboxEvent(first.envelope.identity.eventId)).eventId,
    first.envelope.identity.eventId,
  );
  const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal(await current.readOutboxEvent(first.envelope.identity.eventId), null);
  assert.equal((await current.readPluginArtifact(artifactRequest().payload)).revision, 2);
});

test("production dispatcher crosses compacted empty pages and maintenance respects its batch budget", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  const session = createSessionFacade(runtime);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  const envelopes = [];
  for (let index = 0; index < 65; index += 1) {
    const result = await session.commitAuthorityEvent({
      ...outboxIdentity,
      ...artifactRequest(index ? "replaced" : "created", index || null),
    });
    envelopes.push(result.envelope);
  }
  const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  await repository.commitChanges("u1", "s1", {
    persistenceContext,
    expectedGeneration: reader.generation,
    operationId: "ack-prefix-without-cursor",
    committedAt: ts,
    changes: {
      deliveries: envelopes.slice(0, 64).map((envelope) => ({
        type: "acknowledge",
        eventId: envelope.identity.eventId,
        consumerId: "service.websocket",
        orderingDomain: envelope.ordering.domain,
        orderingScopeId: envelope.ordering.scopeId,
        sequence: envelope.ordering.sequence,
        deliveredAt: ts,
      })),
    },
  });
  const compactRequest = { ...outboxIdentity, retainDeliveredAfter: "2026-01-02T00:00:00.000Z" };
  const retentionRequest = { ...outboxIdentity, retainDeliveredAfter: ts };
  assert.deepEqual(await session.compactAuthorityEvents(retentionRequest), {
    compacted: false,
    removed: 0,
    scanned: 64,
    hasMore: true,
    nextRetainedDeliveryAt: ts,
  });
  assert.deepEqual(await session.compactAuthorityEvents(retentionRequest), {
    compacted: false,
    removed: 0,
    scanned: 1,
    hasMore: false,
    nextRetainedDeliveryAt: null,
  });
  assert.deepEqual(await session.compactAuthorityEvents(compactRequest), {
    compacted: true,
    removed: 64,
    scanned: 64,
    hasMore: true,
    nextRetainedDeliveryAt: null,
  });
  assert.deepEqual(await session.compactAuthorityEvents(compactRequest), {
    compacted: false,
    removed: 0,
    scanned: 1,
    hasMore: false,
    nextRetainedDeliveryAt: null,
  });
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => ({ session }),
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      sent.push(envelope.identity.eventId);
      return true;
    },
  });
  assert.deepEqual(await dispatch(outboxIdentity), { dispatched: true, delivered: 1 });
  assert.deepEqual(sent, [envelopes[64].identity.eventId]);
});

test("production delivery retries a stable event after acknowledgement failure", async (t) => {
  const { runtime, repository } = await fixture(t);
  const session = createSessionFacade(runtime);
  const event = await session.commitAuthorityEvent({ ...outboxIdentity, ...artifactRequest() });
  const original = repository.withSessionReader.bind(repository);
  let failAcknowledgement = true;
  repository.withSessionReader = (userId, sessionId, run, options) =>
    original(
      userId,
      sessionId,
      (reader, scope, commit) =>
        run(reader, scope, (input) => {
          if (
            failAcknowledgement &&
            input.changes.deliveries?.some((item) => item.type === "acknowledge")
          )
            throw new Error("ack write failed");
          return commit(input);
        }),
      options,
    );
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => ({ session }),
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      sent.push(envelope.identity.eventId);
      return true;
    },
  });
  await assert.rejects(dispatch(outboxIdentity), /ack write failed/);
  failAcknowledgement = false;
  assert.deepEqual(await dispatch(outboxIdentity), { dispatched: true, delivered: 1 });
  assert.deepEqual(sent, [event.envelope.identity.eventId, event.envelope.identity.eventId]);
  const pending = await session.getPendingAuthorityEvents({
    ...outboxIdentity,
    consumerId: "service.websocket",
  });
  assert.equal(pending.events.length, 0);
});

test("repository delta commit and pinned queries work without a readable legacy manifest", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  const before = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const input = {
    persistenceContext,
    expectedGeneration: before.generation,
    operationId: "append",
    changes: { messages: [message("m1")] },
    committedAt: ts,
  };
  const committed = await repository.commitChanges("u1", "s1", input);
  assert.equal(committed.generation, before.generation + 1);
  assert.equal((await repository.commitChanges("u1", "s1", input)).replayed, true);
  assert.equal(await before.readMessage("m1"), null);
  const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await current.readMessage("m1")).message.content, "m1");
  assert.equal((await current.readFacts()).messageCount, 1);
  assert.equal((await current.readTurnPage({ turnScopeId: "t1" })).records.length, 1);
  assert.equal((await current.exportSession()).messages.length, 1);
  await assert.rejects(repository.commitChanges("u1", "s1", { ...input, operationId: "stale" }), {
    code: "SESSION_GENERATION_CONFLICT",
  });
});

test("registered sessions require their head even without a format marker", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  const query = { userId: "u1", sessionId: "s1", persistenceContext };
  const sources = () =>
    runtime.sessionMessageService.getSessionMessageSources({
      ...query,
      turnScopeIds: ["t1"],
      messageUids: ["m1"],
    });
  const checkpoint = () =>
    runtime.sessionMessageService.getTurnSummaryCheckpointState({
      ...query,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    });
  t.mock.method(repository, "requireTurnView", () => assert.fail("query must not switch readers"));
  await rm(path.join(scope.sessionDir, "immutable-session.format"), { force: true });
  await rm(path.join(scope.sessionDir, "head.json"));
  for (const read of [
    () => repository.findImmutableSessionReader("u1", "s1", { persistenceContext }),
    () => repository.findTurnTerminalSource("u1", "s1", { persistenceContext, turnScopeId: "t1" }),
    sources,
    checkpoint,
  ]) {
    await assert.rejects(read(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  }
  await repository.markSessionsDeleted("u1", ["s1"]);
  await assert.rejects(sources(), { code: "SESSION_DELETED" });
  await assert.rejects(checkpoint(), { code: "SESSION_DELETED" });
});

test("required message queries reject an unregistered session", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  t.mock.method(repository, "locateSessionScope", async () => null);
  t.mock.method(repository, "requireTurnView", () => assert.fail("query must not switch readers"));
  assert.equal(
    await repository.findImmutableSessionReader("u1", "absent", { persistenceContext }),
    null,
  );
  const query = { userId: "u1", sessionId: "absent", persistenceContext };
  await assert.rejects(
    runtime.sessionMessageService.getSessionMessageSources({
      ...query,
      turnScopeIds: ["t1"],
      messageUids: ["m1"],
    }),
    { code: "SESSION_NOT_FOUND" },
  );
  await assert.rejects(
    runtime.sessionMessageService.getTurnSummaryCheckpointState({
      ...query,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    }),
    { code: "SESSION_NOT_FOUND" },
  );
});

test("repository rejects deleted sessions and does not fall back when an immutable head is missing", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  await rm(path.join(scope.sessionDir, "head.json"));
  await assert.rejects(repository.findImmutableSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(repository.requireSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await repository.markSessionsDeleted("u1", ["s1"]);
  await assert.rejects(repository.requireSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_DELETED",
  });
  await assert.rejects(
    repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: 1,
      operationId: "revive",
      changes: { messages: [message("m1")] },
      committedAt: ts,
    }),
    { code: "SESSION_DELETED" },
  );
});

async function seedEvents(repository, persistenceContext) {
  for (const event of [
    {
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      presentationMessageId: "p1",
      dialogProcessId: "d1",
      executionId: "agent:t1",
      executionKind: "agent",
      rootExecutionId: "agent:t1",
    },
    { eventType: "turn.processing_started", phase: "processing" },
  ]) {
    await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    const result = await repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: reader.generation,
      operationId: event.eventType,
      changes: {
        turnTransition: {
          ...event,
          sessionId: "s1",
          turnScopeId: "t1",
          commandId: event.eventType,
          causationId: event.eventType,
        },
      },
      committedAt: ts,
    });
    assert.equal(result.result.turnTransition.applied, true);
  }
}

test("production delivery resumes after a publisher exception without resending its acknowledged prefix", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  await seedEvents(repository, persistenceContext);
  const bot = { session: createSessionFacade(runtime) };
  const first = [];
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      first.push(envelope.identity.eventId);
      if (first.length === 2) throw new Error("send failed");
      return true;
    },
  });
  await assert.rejects(dispatch(outboxIdentity), /send failed/);
  await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const remaining = await reader.readOutboxPage({ consumerId: "service.websocket" });
  assert.equal(remaining.after, 1);
  assert.deepEqual(
    remaining.events.map((item) => item.eventId),
    [first[1]],
  );
  const retried = [];
  assert.deepEqual(
    await dispatch(outboxIdentity, async (_type, envelope) => {
      retried.push(envelope.identity.eventId);
      return true;
    }),
    { dispatched: true, delivered: 1 },
  );
  assert.deepEqual(retried, [first[1]]);
  assert.deepEqual(
    await dispatch(outboxIdentity, () => assert.fail("acknowledged prefix must not replay")),
    {
      dispatched: true,
      delivered: 0,
    },
  );
});

test("production sending releases session locks and does not acknowledge concurrent appended events", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  await seedEvents(repository, persistenceContext);
  const bot = { session: createSessionFacade(runtime) };
  let sends = 0;
  let appended;
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    consumerId: "service.websocket",
    sendEvent: async () => {
      if (++sends === 2) return false;
      await using reader = await repository.requireSessionReader("u1", "s1", {
        persistenceContext,
      });
      await repository.commitChanges("u1", "s1", {
        persistenceContext,
        expectedGeneration: reader.generation,
        operationId: "during-send",
        changes: { sessionMetadata: { customTitle: "updated during external send" } },
        committedAt: ts,
      });
      appended = await bot.session.commitAuthorityEvent({
        ...outboxIdentity,
        ...artifactRequest(),
      });
      return true;
    },
  });
  assert.deepEqual(await dispatch(outboxIdentity), {
    dispatched: false,
    reason: "authority_event_send_failed",
    delivered: 1,
  });
  await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await reader.readMetadata()).customTitle, "updated during external send");
  const pending = await reader.readOutboxPage({ consumerId: "service.websocket" });
  assert.equal(pending.after, 1);
  assert.equal(pending.events.length, 2);
  assert.equal(pending.events[1].eventId, appended.envelope.identity.eventId);
});

test("production concurrent connections deduplicate acknowledgements and resume the committed prefix", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  await seedEvents(repository, persistenceContext);
  const bot = { session: createSessionFacade(runtime) };
  const resolveBot = () => bot;
  const entered = Promise.withResolvers();
  const barrier = Promise.withResolvers();
  const staleIds = [];
  const slow = createAuthorityEventDispatcher({
    resolveBot,
    consumerId: "service.websocket",
    sendEvent: async (_type, envelope) => {
      staleIds.push(envelope.identity.eventId);
      if (staleIds.length === 2) return false;
      entered.resolve();
      await barrier.promise;
      return true;
    },
  });
  const inFlight = slow(outboxIdentity);
  await entered.promise;
  try {
    let sends = 0;
    const winner = createAuthorityEventDispatcher({
      resolveBot,
      consumerId: "service.websocket",
      sendEvent: async () => ++sends === 1,
    });
    assert.deepEqual(await winner(outboxIdentity), {
      dispatched: false,
      reason: "authority_event_send_failed",
      delivered: 1,
    });
  } finally {
    barrier.resolve();
  }
  assert.deepEqual(await inFlight, {
    dispatched: false,
    reason: "authority_event_send_failed",
    delivered: 1,
  });
  await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const pending = await reader.readOutboxPage({ consumerId: "service.websocket" });
  assert.equal(pending.after, 1);
  assert.deepEqual(
    pending.events.map((event) => event.eventId),
    [staleIds[1]],
  );
  const resumedIds = [];
  assert.deepEqual(
    await slow(outboxIdentity, async (_type, envelope) => {
      resumedIds.push(envelope.identity.eventId);
      return true;
    }),
    { dispatched: true, delivered: 1 },
  );
  assert.deepEqual(resumedIds, [staleIds[1]]);
});

test("selected immutable turn views pin messages and resolve a UID without expanding its historical turn", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  const initial = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  await repository.commitChanges("u1", "s1", {
    persistenceContext,
    expectedGeneration: initial.generation,
    operationId: "selected-view",
    committedAt: ts,
    changes: {
      messages: [
        message("m1"),
        message("m2"),
        { ...message("old1"), dialogProcessId: "old", turnScopeId: "history" },
        { ...message("old2"), dialogProcessId: "old", turnScopeId: "history" },
      ],
    },
  });
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const query = { turnScopeIds: ["t1"], messageUids: ["old1", "missing", "m1"] };
  const view = await repository.requireTurnView("u1", "s1", { ...query, persistenceContext });
  assert.deepEqual(
    view.session.messages.map((item) => item.messageUid),
    ["m1", "m2", "old1"],
  );
  assert.deepEqual(view.turnScopeIds, ["t1", "history"]);
  assert.equal(view.generation, pinned.generation);
  const detailQuery = {
    persistenceContext,
    lookupKey: { turnScopeId: "t1", dialogProcessId: "d1" },
  };
  const detail = await repository.readSessionTurn("u1", "s1", detailQuery);
  assert.deepEqual(
    detail.messages.map((item) => item.messageUid),
    ["m1", "m2"],
  );
  assert.match(createTurnArtifactRevision(detail), /^turn-objects:/);
  assert.equal(
    await repository.readSessionTurn("u1", "s1", {
      ...detailQuery,
      lookupKey: { turnScopeId: "t1", dialogProcessId: "wrong" },
    }),
    null,
  );
  await repository.commitChanges("u1", "s1", {
    persistenceContext,
    expectedGeneration: pinned.generation,
    operationId: "update-selected",
    committedAt: ts,
    changes: { messages: [{ ...message("m1"), content: "changed" }] },
  });
  assert.equal((await pinned.readTurnView(query)).session.messages[0].content, "m1");
  const updatedDetail = await repository.readSessionTurn("u1", "s1", detailQuery);
  assert.notEqual(createTurnArtifactRevision(updatedDetail), createTurnArtifactRevision(detail));
  assert.equal(
    (await repository.requireTurnView("u1", "s1", { ...query, persistenceContext })).session
      .messages[0].content,
    "changed",
  );
  await assert.rejects(pinned.readTurnView({ turnScopeIds: [""] }), /turnScopeId/);
  await repository.markSessionsDeleted("u1", ["s1"]);
  assert.equal(await repository.findTurnView("u1", "s1", { ...query, persistenceContext }), null);
});

test("metadata settings and user meta stay on the immutable authority after migration", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  const service = runtime.sessionMessageService;
  const identity = { userId: "u1", sessionId: "s1", persistenceContext };
  await service.appendTurns({ ...identity, turns: [message("m1")] });
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  repository.requireTurnView = () => assert.fail("user meta must resolve its named UID");
  repository.saveTurnView = () => assert.fail("user meta must commit only its changed message");
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const result = { sourceAttachmentRef: "attach://source", summary: "parsed source" };
  assert.deepEqual(
    await service.recordUserMetaParsedResult({
      ...identity,
      userMetaSourceMessageUid: "m1",
      result,
    }),
    { userMetaParsedResults: [result] },
  );
  await assert.rejects(
    service.recordUserMetaParsedResult({
      ...identity,
      userMetaSourceMessageUid: "missing",
      result,
    }),
    { code: "USER_META_SOURCE_NOT_FOUND" },
  );
  await repository.updateSessionSettings("u1", "s1", {
    persistenceContext,
    settings: { modelAlias: "example", customTitle: "new title", selectedConnectorIds: ["one"] },
  });
  assert.deepEqual(await repository.readSelectedConnectorIds("u1", "s1", { persistenceContext }), [
    "one",
  ]);
  const exported = await repository.requireById("u1", "s1", { persistenceContext });
  assert.equal(exported.customTitle, "new title");
  assert.equal(exported.modelAlias, "example");
  assert.deepEqual(exported.messages[0].userMetaParsedResults, [result]);
  assert.equal((await pinned.readMetadata()).customTitle, undefined);
  assert.equal((await pinned.readMessage("m1")).message.userMetaParsedResults, undefined);
});

test("business append and summary commit use immutable deltas without opening the legacy turn view", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  repository.requireTurnView = () => assert.fail("business delta must not materialize a turn view");
  repository.saveTurnView = () => assert.fail("business delta must not save a turn view");
  const appended = await runtime.sessionMessageService.appendTurns({
    userId: "u1",
    sessionId: "s1",
    persistenceContext,
    turns: [message("m1"), message("m2")],
  });
  assert.deepEqual(
    appended.messageReceipts.map((turn) => turn.messageUid),
    ["m1", "m2"],
  );
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const request = {
    userId: "u1",
    sessionId: "s1",
    persistenceContext,
    turnScopeId: "t1",
    dialogProcessId: "d1",
    checkpointId: "cp1",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m1", "m2"],
    summarizedMessageUids: ["m1"],
    retainedMessageUids: ["m2"],
    messages: [],
  };
  const result = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(request);
  assert.equal(result.committed, true);
  assert.equal(result.markedCount, 1);
  assert.equal(
    (await runtime.sessionMessageService.commitTurnSummaryCheckpoint(request)).deduplicated,
    true,
  );
  const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.notEqual((await pinned.readMessage("m1")).message.summarized, true);
  assert.equal((await current.readMessage("m1")).message.summarized, true);
  assert.notEqual((await current.readMessage("m2")).message.summarized, true);
  const service = runtime.sessionMessageService;
  const query = { userId: "u1", sessionId: "s1", persistenceContext };
  const sources = await service.getSessionMessageSources({
    ...query,
    turnScopeIds: ["t1"],
    messageUids: ["m2", "m1"],
  });
  assert.deepEqual(
    sources.map((item) => item.messageUid),
    ["m2", "m1"],
  );
  assert.equal(sources[1].summarized, true);
  await assert.rejects(
    service.getSessionMessageSources({ ...query, turnScopeIds: ["t1"], messageUids: ["absent"] }),
    /source is missing/,
  );
  const state = await service.getTurnSummaryCheckpointState({
    ...query,
    dialogProcessId: "d1",
    turnScopeId: "t1",
  });
  assert.equal(state.checkpointRevision, 1);
  assert.equal(state.receipts[0].checkpointId, "cp1");
  assert.equal(await pinned.readCheckpointState("t1"), null);
  assert.equal((await current.readCheckpointState("t1")).checkpointRevision, 1);
  await assert.rejects(
    service.getTurnSummaryCheckpointState({
      ...query,
      dialogProcessId: "other",
      turnScopeId: "t1",
    }),
    /another dialog process/,
  );
  assert.deepEqual(
    await service.getTurnSummaryCheckpointState({
      ...query,
      dialogProcessId: "d2",
      turnScopeId: "t2",
    }),
    { dialogProcessId: "d2", turnScopeId: "t2", checkpointRevision: 0, receipts: [] },
  );
});

test("scoped commits resolve identity once, preserve replay and reject escaped capabilities", async (t) => {
  const { repository, persistenceContext } = await fixture(t);
  const locate = t.mock.method(repository, "locateSessionScope");
  const open = t.mock.method(ImmutableSessionStore, "open");
  let escaped;
  let request;
  await repository.withSessionReader(
    "u1",
    "s1",
    async (reader, _scope, commit) => {
      escaped = commit;
      request = {
        expectedGeneration: reader.generation,
        operationId: "scoped-commit",
        changes: { sessionMetadata: { customTitle: "scoped" } },
        committedAt: ts,
      };
      const first = await commit(request);
      assert.equal(first.generation, reader.generation + 1);
      assert.equal((await reader.readMetadata()).customTitle, undefined);
      assert.equal((await commit(request)).replayed, true);
      await assert.rejects(commit({ ...request, operationId: "stale" }), {
        code: "SESSION_GENERATION_CONFLICT",
      });
    },
    { persistenceContext },
  );
  assert.equal(locate.mock.callCount(), 1);

  assert.equal(open.mock.callCount(), 1);
  await assert.rejects(escaped(request), { code: "SESSION_READER_CLOSED" });
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await current.readMetadata()).customTitle, "scoped");
});

test("authority delivery commits use the enclosing lifecycle scope and retain persisted attempts", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  const session = createSessionFacade(runtime);
  const created = await session.commitAuthorityEvent({ ...outboxIdentity, ...artifactRequest() });
  t.mock.method(repository, "commitChanges", () => assert.fail("nested repository mutation"));
  const locate = t.mock.method(repository, "locateSessionScope");
  const attempted = await session.recordAuthorityEventAttempts({
    ...outboxIdentity,
    consumerId: "service.websocket",
    eventIds: [created.envelope.identity.eventId],
  });
  assert.equal(attempted.recorded, true);

  assert.equal(locate.mock.callCount(), 2);
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const item = await current.readOutboxEvent(created.envelope.identity.eventId);
  assert.equal(item.deliveries["service.websocket"].attempts, 1);
});

registerImmutableContextRepositoryTests({ fixture, message, ts });
registerImmutableLifecycleRepositoryTests({ fixture, ts });
