/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import {
  createTestSessionServices,
  submitTestSessionRequest,
} from "../helpers/session-services.js";
import { createSessionFacade } from "../../src/session/index.js";
import { createAuthorityEventDispatcher } from "../../../service/ws/chat-websocket/authority-event-dispatcher.js";
import {
  ts,
  outboxIdentity,
  artifactRequest,
  fixture,
  seedEvents,
} from "./immutable-session-repository.test-helpers.js";

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
    runNewOperation: (operation) => operation(),
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
    runNewOperation: (operation) => operation(),
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
  await submitTestSessionRequest(
    repository,
    "u1",
    "s1",
    await reader.prepareRequest({
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
    }),
    persistenceContext,
  );
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
    runNewOperation: (operation) => operation(),
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
  const original = repository.sessionReaderAccess;
  let failAcknowledgement = true;
  repository.sessionReaderAccess = {
    ...original,
    withOutboxMutation: (scope, plan) =>
      original.withOutboxMutation(scope, async (reader) => {
        const complete = await plan(reader);
        return (commit) =>
          complete((input) => {
            if (
              failAcknowledgement &&
              input.input.changes.deliveries?.some((item) => item.type === "acknowledge")
            )
              throw new Error("ack write failed");
            return commit(input);
          });
      }),
  };
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    runNewOperation: (operation) => operation(),
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

test("production delivery resumes after a publisher exception without resending its acknowledged prefix", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  await seedEvents(repository, persistenceContext);
  const bot = { session: createSessionFacade(runtime) };
  const first = [];
  const dispatch = createAuthorityEventDispatcher({
    runNewOperation: (operation) => operation(),
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
    runNewOperation: (operation) => operation(),
    resolveBot: () => bot,
    consumerId: "service.websocket",
    sendEvent: async () => {
      if (++sends === 2) return false;
      await using reader = await repository.requireSessionReader("u1", "s1", {
        persistenceContext,
      });
      await submitTestSessionRequest(
        repository,
        "u1",
        "s1",
        await reader.prepareRequest({
          operationId: "during-send",
          changes: { sessionMetadata: { customTitle: "updated during external send" } },
          committedAt: ts,
        }),
        persistenceContext,
      );
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
    runNewOperation: (operation) => operation(),
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
      runNewOperation: (operation) => operation(),
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

test("authority delivery commits use the enclosing lifecycle scope and retain persisted attempts", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  const session = createSessionFacade(runtime);
  const created = await session.commitAuthorityEvent({ ...outboxIdentity, ...artifactRequest() });
  const scoped = t.mock.method(repository, "withSessionOutboxMutation");
  const locate = t.mock.method(repository, "locateSessionScope");
  const attempted = await session.prepareAuthorityEventDelivery({
    ...outboxIdentity,
    consumerId: "service.websocket",
  });
  assert.equal(attempted.found, true);
  assert.equal(scoped.mock.callCount(), 1, "delivery must not open a nested mutation scope");

  assert.equal(
    locate.mock.callCount(),
    1,
    "delivery resolves placement once under the lifecycle lock",
  );
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const item = await current.readOutboxEvent(created.envelope.identity.eventId);
  assert.equal(item.deliveries["service.websocket"].attempts, 1);
});
